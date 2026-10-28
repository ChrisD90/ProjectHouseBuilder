'use strict';
const $=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(value)||0);
let selected=null,list=[],overview=null,currentReceipt=null,assignmentEditing=false;
let receiptSearchText='';
const receiptDialog=$('receiptWorkflowDialog');
function showReceiptPreview(item){
 const pane=$('receiptPdfPane'),frame=$('receiptPdfFrame'),image=$('receiptImagePreview');
 const name=item?.original_name||item?.filename||'';
 const isPdf=/\.pdf$/i.test(name),isImage=/\.(png|jpe?g|webp)$/i.test(name);
 pane.hidden=!item||(!isPdf&&!isImage);
 if(pane.hidden){frame.removeAttribute('src');image.removeAttribute('src');return;}
 const url='/api/receipts/'+encodeURIComponent(item.id)+'/preview';
 frame.hidden=!isPdf;image.hidden=!isImage;
 if(isPdf&&frame.getAttribute('src')!==url)frame.src=url;
 if(isImage)image.src=url;
 $('receiptPdfDownload').href='/api/receipts/'+item.id+'/download';
}

let uploading=false,receiptBusy=false,paymentBusy=false;
const receiptFlow=PHBFlow.manage({
 dialog:'receiptWorkflowDialog',
 forms:['upload','review','receiptPaymentForm'],
 dismiss:['closeReceiptWorkflow'],
 steps:['Erfassen','Prüfen & buchen','Bezahlen'],
 isBusy:()=>uploading||receiptBusy||paymentBusy
});
function openReceiptDialog(review=false){
  receiptDialog.classList.toggle('is-reviewing',Boolean(review));
  if(!review)$('receiptWorkflowTitle').textContent='Beleg hochladen und prüfen';
  $('receiptUploadAgain').hidden=!review;
  if(!receiptDialog.open)receiptFlow.open({step:review?1:0});
  else receiptFlow.stage(review?1:0);
  if(review){
    requestAnimationFrame(()=>$('review').querySelector('input:not(:disabled)')?.focus({preventScroll:true}));
  } else {
    requestAnimationFrame(()=>$('upload').querySelector('input[type=file]')?.focus({preventScroll:true}));
  }
}
$('openReceiptWorkflow').onclick=()=>{
  selected=null;
  $('review').hidden=true;$('placeholder').hidden=false;showReceiptPreview(null);
  openReceiptDialog(false);
};
$('receiptUploadAgain').onclick=()=>{
  selected=null;
  $('review').hidden=true;$('placeholder').hidden=false;showReceiptPreview(null);
  openReceiptDialog(false);
};
$('closeReceiptWorkflow').onclick=()=>{if(!uploading&&!receiptBusy)receiptDialog.close();};
receiptDialog.addEventListener('cancel',event=>{if(uploading||receiptBusy)event.preventDefault();});
receiptDialog.addEventListener('click',event=>{
  if(event.target===receiptDialog&&!uploading&&!receiptBusy)receiptDialog.close();
});
const navigation=new URLSearchParams(window.location.search);
const linkOffer=Number(navigation.get('offer_id'))||null;
const linkReceipt=Number(navigation.get('receipt_id'))||null;
let linkedCostItem=null;
function assignmentLabel(r){
  if(r.assignment_type==='Eigenleistung')return 'Eigenleistung';
  if(r.assignment_type==='Betrieb'){
    const contractor=(overview?.contractors||[]).find(c=>c.id===r.contractor_id);
    return 'Betrieb: '+(contractor?.name||'Unbekannt');
  }
  if(r.assignment_type==='Angebot'){
    const offer=(overview?.offers||[]).find(o=>o.id===r.offer_id);
    return 'Angebot: '+(offer?.vendor||'Angenommen');
  }
  if(r.assignment_type==='Kostenposition')return 'Bisherige Kostenposition';
  return 'Zuordnung noch offen';
}
function renderCostItems(){
  const accepted=new Map((overview?.offers||[]).filter(o=>['Angenommen','Beauftragt'].includes(o.status)).map(o=>[o.id,o]));
  const itemList=overview?.items||[];
  const offered=itemList.filter(x=>x.offer_id&&accepted.has(x.offer_id)&&x.selected);
  $('costItems').innerHTML='<option value="">Angebot wählen</option>'+offered.map(x=>{
    const o=accepted.get(x.offer_id);
    return `<option value="${x.id}">${safe(o.vendor)} · ${safe(o.number||'ohne Nummer')} · ${money(o.agreed_gross??o.gross)}</option>`;
  }).join('');
  const contractors=overview?.contractors||[];
  $('receiptContractor').innerHTML='<option value="">Betrieb wählen</option>'+
    contractors.map(x=>`<option value="${x.id}">${safe(x.name)} · ${safe(x.trade||'Betrieb')}</option>`).join('');
  linkedCostItem=offered.find(x=>x.offer_id===linkOffer)?.id||null;
}
function normalizedSearch(value){
 return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de-DE').trim();
}
function receiptMatchesSearch(receipt){
 if(!receiptSearchText)return true;
 const values=[receipt.supplier,receipt.invoice_number,receipt.filename,receipt.document_date,
  receipt.due_date,receipt.category,receipt.kind,receipt.billing_type,receipt.status,
  receipt.notes,assignmentLabel(receipt),receipt.gross_amount,receipt.counted_amount,
  receipt.paid_amount,money(receipt.gross_amount),money(receipt.counted_amount)];
 const haystack=normalizedSearch(values.join(' '));
 return receiptSearchText.split(/\s+/).every(term=>haystack.includes(term));
}
function renderReceiptList(){
 const visible=list.filter(receiptMatchesSearch);
 $('receiptSearchResult').textContent=receiptSearchText
  ?`${visible.length} von ${list.length} Belegen gefunden`
  :`${list.length} Belege insgesamt`;
 $('list').innerHTML=visible.map(x=>`<button type="button" data-id="${x.id}" class="entry ${selected===x.id?'active':''}"><span class="status ${x.status==='Gebucht'?'booked':''}">${safe(x.status)}</span>${x.status==='Gebucht'&&x.paid_amount>0?`<span class="receipt-payment-badge">${safe(x.payment_assignment)}${x.unassigned_amount>0?' · '+money(x.unassigned_amount):''}</span>`:''}<strong>${safe(x.supplier||x.filename)}</strong><small>${safe(x.document_date||'Ohne Datum')} · ${money(x.counted_amount)} ${x.status==='Storniert'?'Originalbetrag':'neu abgerechnet'} · ${safe(x.category)} · ${safe(assignmentLabel(x))}</small>${x.labor_amount!==null?`<small class="receipt-labor-preview">Arbeits-/Lohnkosten brutto: <strong>${money(x.labor_amount)}</strong></small>`:''}</button>`).join('')||(receiptSearchText?'<p>Keine Belege entsprechen der Suche.</p>':'<p>Du hast noch keine Belege erfasst.</p>');
 $('list').querySelectorAll('.entry').forEach(b=>b.onclick=()=>open(Number(b.dataset.id)));
}
$('receiptSearch').addEventListener('input',event=>{
 receiptSearchText=normalizedSearch(event.currentTarget.value);
 renderReceiptList();
});
function grossToTaxParts(gross,rate){
  const cents=Math.round(Number(gross)*100);
  if(!Number.isSafeInteger(cents)||cents<0)return null;
  const tax=Number(rate);
  if(![0,7,19].includes(tax))return null;
  const netCents=Math.round(cents*100/(100+tax));
  return {net:(netCents/100).toFixed(2),vat:((cents-netCents)/100).toFixed(2)};
}
function calculateReceiptTax(){
  const gross=$('receiptGross').value;
  const rate=$('receiptTaxRate').value;
  if(!gross||rate==='manual')return;
  const calculated=grossToTaxParts(PHBUI.currency.parse(gross),rate);
  if(!calculated)return;
  $('receiptNet').value=PHBUI.currency.format(calculated.net);
  $('receiptVat').value=PHBUI.currency.format(calculated.vat);
  $('receiptTaxHint').textContent='Berechnet mit '+rate+' % USt: Netto '+calculated.net+
    ' € + USt '+calculated.vat+' € = Brutto '+Number(PHBUI.currency.parse(gross)).toFixed(2)+
    ' €. Bitte mit dem Originalbeleg abgleichen.';
}
function detectReceiptTaxRate(x){
  if(x.net_amount==null||x.vat_amount==null)return '19';
  const gross=Math.round(Number(x.gross_amount)*100);
  const net=Math.round(Number(x.net_amount)*100);
  const vat=Math.round(Number(x.vat_amount)*100);
  if(!Number.isSafeInteger(gross)||!Number.isSafeInteger(net)||!Number.isSafeInteger(vat))return 'manual';
  if(Math.abs(gross-(net+vat))>1)return 'manual';
  for(const rate of [19,7,0]){
    if(Math.abs(vat-(gross-Math.round(gross*100/(100+rate))))<=1)return String(rate);
  }
  return 'manual';
}
$('receiptGross').addEventListener('input',calculateReceiptTax);
$('receiptTaxRate').addEventListener('change',calculateReceiptTax);

function updateLaborHint(source,amount){
 const badge=$('receiptLaborSource');
 if(amount!==null&&amount!==undefined&&amount!==''){
   badge.textContent=source==='Manuell'?'Manuell eingetragen'
     :source==='Erkannt'?'Automatisch erkannt – prüfen':'Lohnkosten erfasst';
   badge.classList.toggle('recognized',source==='Erkannt');
 }else{
   badge.textContent='Noch nicht erfasst';
   badge.classList.remove('recognized');
 }
}
$('receiptLabor').addEventListener('input',()=>{
 updateLaborHint('Manuell',$('receiptLabor').value);
});
function updateInvoiceControls(){
 const mode=$('receiptAssignmentType').value;
 const frozen=false;
 $('receiptOfferWrap').hidden=mode!=='Angebot'&&mode!=='Kostenposition';
 $('receiptContractorWrap').hidden=mode!=='Betrieb';
 $('receiptContractorHint').hidden=mode!=='Betrieb';
 $('costItems').disabled=frozen||(mode!=='Angebot'&&mode!=='Kostenposition');
 $('receiptContractor').disabled=frozen||mode!=='Betrieb';
 $('receiptAssignmentType').disabled=frozen;
 const cost=overview?.items?.find(x=>x.id===Number($('costItems').value));
 const offer=(overview?.offers||[]).find(o=>o.id===cost?.offer_id);
 const isAccepted=mode==='Angebot'&&!!(offer&&['Angenommen','Beauftragt'].includes(offer.status));
 if(isAccepted&&!frozen){
   $('budgetLines').value=cost.budget_line_id||'';
   $('categories').value=cost.category;
 }
 $('budgetLines').disabled=isAccepted||frozen;
 $('advanceDeduction').disabled=frozen||$('billingType').value!=='Schlussrechnung'||!isAccepted;
 $('advanceDeductionWrap').hidden=$('billingType').value!=='Schlussrechnung';
 $('deductionHint').hidden=$('billingType').value!=='Schlussrechnung';
 $('billingTypeHint').textContent=$('billingType').value==='Schlussrechnung'
   ? 'Die letzte Rechnung zu einem Auftrag. Bereits gebuchte Abschläge werden nur verrechnet, wenn sie im Gesamtbetrag dieser Rechnung enthalten sind. Das verhindert doppelte Kosten.'
   : $('billingType').value==='Abschlagsrechnung'
   ? 'Eine Teilrechnung während des laufenden Auftrags. Sie zählt zunächst vollständig und kann später in einer Schlussrechnung verrechnet werden.'
   : 'Eine einzelne Lieferung oder Leistung ohne Verrechnung früherer Teilrechnungen. Für die meisten Rechnungen und Kassenbons passend.';
 const hint=$('billableHint');
 hint.textContent=isAccepted
   ? `Mit dem angenommenen Angebot „${offer.vendor}“ verknüpft. Abschläge und Schlussrechnung werden zum Vertragsbetrag von ${money(offer.agreed_gross??offer.gross)} addiert, ohne verrechnete Abschläge doppelt zu zählen.`
   : mode==='Betrieb'?'Direkt einem Betrieb zugeordnet; keine automatische Verknüpfung zu einem Angebot. Die Rechnung wird nur einmal als Ausgabe berücksichtigt.'
   : mode==='Eigenleistung'?'Eigenleistung/Material: Keine Verknüpfung zu einem Handwerker oder Angebot. Falls vorhanden, die passende Budgetposition auswählen.'
   : mode==='Kostenposition'?'Historische Kostenpositionszuordnung. Für Änderungen kann ein regulärer Zuordnungstyp ausgewählt werden.'
   : 'Wähle Angebot, Betrieb oder Eigenleistung. Nur angenommene Angebote erscheinen in der Angebotsauswahl.';
}
$('receiptAssignmentType').addEventListener('change',()=>{
  if($('receiptAssignmentType').value!=='Angebot'&&$('receiptAssignmentType').value!=='Kostenposition'){$('costItems').value='';$('advanceDeduction').value='0';}
  if($('receiptAssignmentType').value!=='Betrieb')$('receiptContractor').value='';
  updateInvoiceControls();
});
$('costItems').addEventListener('change',updateInvoiceControls);
$('billingType').addEventListener('change',()=>{if($('billingType').value!=='Schlussrechnung')$('advanceDeduction').value='0';updateInvoiceControls();});
$('receiptAnalysisMode').addEventListener('change',()=>{
 const ai=$('receiptAnalysisMode').value==='ai';
 $('receiptAIHint').hidden=!ai;
 $('receiptUploadButton').textContent=ai?'Mit ChatGPT analysieren':'Datei lokal analysieren';
});

async function api(path,opts={}){const res=await fetch(path,opts);let data=await res.json();if(!res.ok)throw new Error(data.error||'Anfrage fehlgeschlagen');return data}
function notice(msg,err=false){for(const id of ['message','receiptSaveStatus']){$(id).textContent=msg;$(id).classList.toggle('error',err)}}
function inputs({booking=false}={}){
 PHBUI.currency.normalizeForm($('review'));
  const result=Object.fromEntries(new FormData($('review')));
  // Payment is always recorded separately after booking.
  delete result.paid_amount;
 if($('book').hidden)return result;
 const mode=$('receiptAssignmentType').value;
 if(booking&&!mode)throw Error('Bitte die Rechnung einem Angebot, Betrieb oder der Eigenleistung zuordnen.');
 if(booking&&mode==='Angebot'&&!$('costItems').value)throw Error('Bitte ein angenommenes Angebot auswählen.');
 if(booking&&mode==='Betrieb'&&!$('receiptContractor').value)throw Error('Bitte einen Betrieb auswählen.');
 result.assignment_type=mode;
 result.cost_item_id=(mode==='Angebot'||mode==='Kostenposition')?$('costItems').value:null;
 result.contractor_id=mode==='Betrieb'?$('receiptContractor').value:null;
 result.advance_deduction=$('billingType').value==='Schlussrechnung'?$('advanceDeduction').value:'0';
 result.reviewed=booking;
 return result;
}
function fillSelect(node,values,getTitle){node.innerHTML='<option value="">Keine Zuordnung</option>'+values.map(x=>`<option value="${x.id}">${safe(getTitle(x))}</option>`).join('')}
async function reload(keepId=selected){
 const [r,c]=await Promise.all([api('/api/receipts'),api('/api/costs')]);overview=c;list=r.receipts;
 $('stats').innerHTML=`<span>Entwürfe: <b>${r.drafts}</b></span><span>Gebucht brutto: <b>${money(r.booked_gross)}</b></span><span>Bezahlt: <b>${money(r.paid)}</b></span><span>Lohnanteil erfasst: <b>${list.filter(x=>x.labor_amount!==null).length} Belege</b></span>`;
 $('categories').innerHTML=r.categories.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');
 fillSelect($('budgetLines'),c.budget_lines.filter(x=>x.active&&!x.is_group),x=>x.category+' · '+x.title);
 renderCostItems();
 if(keepId&&list.some(x=>x.id===keepId))selected=keepId;
 renderReceiptList();
 if(keepId&&list.some(x=>x.id===keepId))await open(keepId);
 else if(linkReceipt&&list.some(x=>x.id===linkReceipt))await open(linkReceipt);
 else if(!list.length){$('review').hidden=true;$('placeholder').hidden=false;showReceiptPreview(null);}
 if(linkOffer&&!selected){$('uploadStatus').textContent='Angebot ausgewählt: Lade die Rechnung hoch und prüfe danach die Verknüpfung im Entwurf.';}
}
async function open(id){
 try{let x=await api('/api/receipts/'+id);selected=id;currentReceipt=x;assignmentEditing=false;document.querySelectorAll('.entry').forEach(b=>b.classList.toggle('active',Number(b.dataset.id)===id));
 $('review').hidden=false;$('placeholder').hidden=true;$('editorTitle').textContent=x.filename;
 $('receiptReviewLayout').hidden=false;
 $('receiptReviewStage').hidden=false;
 openReceiptDialog(true);showReceiptPreview(x);
 const legacy=x.assignment_type==='Kostenposition';
 const legacyOption=$('receiptAssignmentType').querySelector('option[value="Kostenposition"]');
 if(legacyOption)legacyOption.remove();
 if(legacy){
   $('receiptAssignmentType').add(new Option('Bisherige Kostenposition (Bestand)','Kostenposition'));
   if(x.cost_item_id&&!Array.from($('costItems').options).some(o=>o.value===String(x.cost_item_id))){
     const item=(overview?.items||[]).find(i=>i.id===x.cost_item_id);
     $('costItems').add(new Option(item?item.title:'Bisherige Kostenposition',String(x.cost_item_id)));
   }
 }
 for(let [k,v] of Object.entries(x)){const input=$('review').elements.namedItem(k);if(input&&v!==undefined){input.value=v??'';if(input instanceof HTMLInputElement)PHBUI.currency.prepare(input);}}
 $('receiptAssignmentType').value=x.assignment_type||'';
 $('receiptTaxRate').value=detectReceiptTaxRate(x);
 updateLaborHint(x.labor_source,x.labor_amount);
 $('book').hidden=x.status!=='Entwurf';$('unbook').hidden=x.status!=='Gebucht';$('delete').hidden=x.status!=='Entwurf';
 $('editReceiptAssignment').hidden=true;
 $('saveReceiptAssignment').hidden=true;$('cancelReceiptAssignment').hidden=true;
 $('cancelReceipt').hidden=x.status!=='Gebucht';$('reopenCancelledReceipt').hidden=x.status!=='Storniert';$('markReceiptPaid').hidden=x.status!=='Gebucht'||x.paid_amount>=x.counted_amount;
 for(const button of $('review').querySelectorAll('button[type=submit]')){
   button.hidden=false;
   button.textContent=x.status==='Entwurf'?'Entwurf zwischenspeichern':'Änderungen speichern';
 }
 $('receiptCreateCompany').hidden=x.status!=='Entwurf';
 $('review').querySelector('.receipt-draft-toolbar').hidden=false;
 $('receiptReviewState').textContent=x.status;
 $('receiptReviewTitle').textContent=x.status==='Entwurf'?'Rechnungsdaten prüfen':x.status==='Gebucht'?'Gebuchte Rechnung':'Stornierte Rechnung';
 $('receiptReviewHelp').textContent=x.status==='Entwurf'?'Unvollständige Daten kannst du jederzeit zwischenspeichern. Erst „Verbindlich buchen“ übernimmt die Rechnung in Kosten und Abrechnung; die Zahlung erfasst du danach separat.':x.status==='Gebucht'?'Alle Rechnungsdaten bleiben bearbeitbar. Änderungen an Betrag, Zuordnung und Abrechnungsart werden vor dem Speichern gegen Zahlungen und Angebotsabrechnung geprüft.':'Auch ein stornierter Beleg kann fachlich korrigiert werden. Originaldatei, Stornogrund und Historie bleiben erhalten.';
 $('receiptWorkflowTitle').textContent=x.status==='Entwurf'?'Rechnung prüfen':x.status==='Gebucht'?'Gebuchte Rechnung':'Stornierte Rechnung';
 $('payReceipt').hidden=x.status!=='Gebucht';
 const cancellationInfo=x.cancellation
  ? 'Storniert am '+new Date(x.cancellation.date).toLocaleDateString('de-DE')+' · zurückgenommene Zahlungsvermerke: '+money(x.cancellation.previous_paid)+(x.cancellation.reason?' · Grund: '+x.cancellation.reason:'')
  : x.cancellation_reversal?'Storno zurückgenommen am '+new Date(x.cancellation_reversal.date).toLocaleDateString('de-DE')+' · wiederhergestellter Zahlungsstand: '+money(x.cancellation_reversal.restored_paid)+(x.cancellation_reversal.reason?' · Grund: '+x.cancellation_reversal.reason:''):'';
 $('receiptCancellationInfo').hidden=!cancellationInfo;$('receiptCancellationInfo').textContent=cancellationInfo;
 $('receiptPaymentsPanel').hidden=true;
 $('receiptReviewLayout').hidden=false;
 $('receiptReviewStage').hidden=false;
 for(let node of $('review').querySelectorAll('input,select,textarea'))node.disabled=false;
 $('review').elements.namedItem('paid_amount').disabled=true;
 $('receiptTaxRate').disabled=false;
 $('receiptTaxHint').textContent='Wenn du den Bruttobetrag bearbeitest, werden Netto und USt mit dem gewählten Satz automatisch berechnet. Bei gemischten Steuersätzen „manuell“ auswählen. Originalbeleg prüfen.';
 if(linkedCostItem&&x.status==='Entwurf'&&!x.cost_item_id&&!x.assignment_type){
   $('receiptAssignmentType').value='Angebot';
   $('costItems').value=String(linkedCostItem);
 }
 updateInvoiceControls();
 const address=new URL(location.href);address.searchParams.set('receipt_id',String(id));history.replaceState(null,'',address);
 $('original').href='/api/receipts/'+id+'/download';$('raw').textContent=x.ocr_text||'Keine Textdaten erkannt. Manuelle Eingabe erforderlich.';
 receiptFlow.snapshot(); // Automatically filled invoice fields form the clean baseline.
 $('rawDetails').hidden=!x.ocr_text; $('warnings').textContent=(x.warnings||[]).join(' · ');notice(x.status==='Storniert'?'Storniert: Daten bleiben bearbeitbar; Original und Historie bleiben erhalten. '+(x.cancellation?.reason||''):x.status==='Gebucht'?'Gebucht: Rechnungsdaten können weiterhin geprüft und korrigiert werden.':'Entwurf: Du kannst jederzeit zwischenspeichern, auch ohne Firma, Betrag oder Zahlungsziel.');
 }catch(e){notice(e.message,true)}
}

function setAssignmentEditing(enabled){
 assignmentEditing=enabled;
 $('editReceiptAssignment').hidden=enabled;
 $('saveReceiptAssignment').hidden=!enabled;
 $('cancelReceiptAssignment').hidden=!enabled;
 for(const id of ['receiptAssignmentType','costItems','receiptContractor','budgetLines'])$(id).disabled=!enabled;
 updateInvoiceControls();
 if(enabled){
  $('receiptReviewHelp').textContent='Korrigiere nur die Zuordnung. Rechnungsbetrag, Zahlungsstand und Stornonachweis bleiben unverändert.';
  $('receiptAssignmentType').focus();
 }
}
$('editReceiptAssignment').onclick=()=>setAssignmentEditing(true);
$('cancelReceiptAssignment').onclick=()=>{if(currentReceipt)open(currentReceipt.id);};
$('saveReceiptAssignment').onclick=async()=>{
 if(!selected||!currentReceipt||receiptBusy)return;
 const mode=$('receiptAssignmentType').value;
 if(!mode){notice('Bitte eine Zuordnungsart auswählen.',true);return;}
 const fields={assignment_type:mode,
   cost_item_id:(mode==='Angebot'||mode==='Kostenposition')?$('costItems').value:null,
   contractor_id:mode==='Betrieb'?$('receiptContractor').value:null,
   budget_line_id:$('budgetLines').value||null};
 await receiptAction(()=>api('/api/receipts/'+selected+'/assignment',{
   method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)
 }),$('saveReceiptAssignment'),'Zuordnung korrigiert. Betrag, Zahlungsstand und Nachweis blieben unverändert.');
};
let paymentState=null,assigningPayment=null;
const paymentForm=$('receiptPaymentForm');
const currentPaymentReceipt=()=>paymentState?.receipts.find(r=>r.id===selected);
function assignmentLimit(){
 if(!assigningPayment)return 0;
 if(assigningPayment==='legacy'){
  const all=paymentState.payments.filter(p=>p.receipt_id===selected);
  return Math.max(0,Number(currentPaymentReceipt().paid)-all.reduce((sum,p)=>sum+Number(p.amount),0));
 }
 return Number(paymentState.payments.find(p=>p.id===assigningPayment)?.amount||0);
}
function paymentAccountOptions(){
 if(!paymentState)return;
 const source=$('receiptPaymentSource').value,receipt=currentPaymentReceipt();
 const deferred=source==='unassigned';
 $('receiptPaymentAccountWrap').hidden=deferred;$('receiptPaymentAccount').required=!deferred;
 const accounts=source==='loan'?paymentState.loans:source==='equity'?paymentState.equity:[];
 const available=a=>Number(source==='loan'?a.balance?.unallocated_drawn:a.balance?.available)||0;
 const usable=accounts.filter(a=>available(a)>0.005);
 $('receiptPaymentAccount').innerHTML=usable.map(a=>'<option value="'+a.id+'">'+safe(a.name)+' · frei '+money(available(a))+'</option>').join('');
 const limit=assigningPayment?assignmentLimit():Number(receipt?.open||0);
 const maximum=deferred?limit:Math.min(limit,available(usable[0]||{}));
 $('receiptPaymentAmount').value=maximum>0?PHBUI.currency.format(maximum):'';
 $('submitReceiptPayment').disabled=!receipt||maximum<=0||(assigningPayment&&deferred);
 $('submitReceiptPayment').textContent=assigningPayment?'Bestehende Zahlung zuordnen':'Zahlung verbindlich verbuchen';
 $('receiptPaymentMessage').textContent=deferred?'Die Rechnung wird bezahlt markiert. Die Finanzierungsquelle kannst du später zuordnen.':
  usable.length?(assigningPayment?'Nur die Finanzierungsquelle wird ergänzt; der bezahlte Betrag bleibt unverändert.':''):'Keine frei verfügbaren Mittel. Konto/Kredit anlegen oder „Später zuordnen“ wählen.';
}
async function showReceiptPayments(){
 if(!selected||list.find(r=>r.id===selected)?.status!=='Gebucht')return;
 paymentState=await api('/api/financing');assigningPayment=null;
 const receipt=currentPaymentReceipt();if(!receipt)throw Error('Gebuchte Rechnung nicht gefunden.');
 const allocations=paymentState.payments.filter(p=>p.receipt_id===selected);
 const legacy=Math.max(0,Number(receipt.paid)-allocations.reduce((sum,p)=>sum+Number(p.amount),0));
 $('receiptPaymentsPanel').hidden=false;receiptFlow.stage(2);$('receiptReviewLayout').hidden=true;$('receiptReviewStage').hidden=true;
 $('receiptPaymentTotals').innerHTML='<span>Rechnungsbetrag: <b>'+money(receipt.gross)+'</b></span><span>Bereits bezahlt: <b>'+money(receipt.paid)+'</b></span><span>Noch offen: <b>'+money(receipt.open)+'</b></span><span>Nicht zugewiesen: <b>'+money(receipt.unassigned)+'</b></span>';
 paymentForm.hidden=receipt.open<=0;paymentForm.elements.namedItem('payment_date').disabled=false;paymentForm.elements.namedItem('notes').disabled=false;$('receiptPaymentSource').value='unassigned';
 $('receiptPaymentSource').querySelector('[value=unassigned]').disabled=false;
 $('receiptPaymentHistory').innerHTML='<h4>Erfasste Zahlungen</h4>'+allocations.map(p=>{
  const unassigned=p.source==='unassigned';
  const title=unassigned?'Nicht zugewiesen':(p.source==='loan'?paymentState.loans:paymentState.equity).find(a=>a.id===(p.loan_id||p.equity_id))?.name||p.source;
  return '<div class="receipt-payment-history-row"><span>'+money(p.amount)+' · '+safe(p.payment_date)+' · '+safe(title)+(p.notes?' · '+safe(p.notes):'')+'</span><div>'+
   (unassigned?'<button type="button" data-assign-payment="'+p.id+'">Finanzierung zuordnen</button>':'<button type="button" data-unassign-payment="'+p.id+'">Zuordnung lösen</button>')+
   '<button type="button" data-undo-finance-payment="'+p.id+'">Zahlung zurücknehmen</button></div></div>';
 }).join('')+(legacy>0.005?'<div class="receipt-payment-history-row"><span>'+money(legacy)+' · Nicht zugewiesen (bisherige Zahlung)</span><button type="button" data-assign-payment="legacy">Finanzierung zuordnen</button></div>':'')+
 (!allocations.length&&legacy<=0.005?'<p class="note">Noch keine Zahlungen erfasst.</p>':'');
 paymentForm.elements.namedItem('payment_date').value=new Date().toLocaleDateString('sv-SE');paymentAccountOptions();receiptFlow.snapshot();
}
$('payReceipt').onclick=async()=>{try{await showReceiptPayments();}catch(error){notice(error.message,true);}};
$('closeReceiptPayment').onclick=()=>{if(paymentBusy)return;$('receiptPaymentsPanel').hidden=true;receiptFlow.stage(1);$('receiptReviewLayout').hidden=false;$('receiptReviewStage').hidden=false;};
$('receiptPaymentSource').onchange=paymentAccountOptions;
$('receiptPaymentAccount').onchange=()=>{
 if(!paymentState)return;
 const source=$('receiptPaymentSource').value;
 const accounts=source==='loan'?paymentState.loans:paymentState.equity;
 const account=accounts.find(a=>String(a.id)===$('receiptPaymentAccount').value);
 const available=Number(source==='loan'?account?.balance?.unallocated_drawn:account?.balance?.available)||0;
 const maximum=Math.min(assigningPayment?assignmentLimit():Number(currentPaymentReceipt()?.open||0),available);
 $('receiptPaymentAmount').value=maximum>0?PHBUI.currency.format(maximum):'';
 $('submitReceiptPayment').disabled=maximum<=0;
};
$('markReceiptPaid').onclick=async()=>{
 if(receiptBusy||paymentBusy||!selected)return;
 paymentBusy=true;const button=$('markReceiptPaid');button.disabled=true;
 try{
  const state=await api('/api/financing'),receipt=state.receipts.find(r=>r.id===selected);
  if(!receipt||receipt.open<=0)return;
  if(!await PHBUI.confirm('Offenen Betrag von '+money(receipt.open)+' als bezahlt markieren? Finanzierung zunächst „Nicht zugewiesen“.'))return;
  await api('/api/financing/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt_id:selected,source:'unassigned',amount:receipt.open,payment_date:new Date().toLocaleDateString('sv-SE')})});
  await reload(selected);notice('Als bezahlt markiert · Finanzierung nicht zugewiesen.');
 }catch(error){notice(error.message,true);}finally{paymentBusy=false;button.disabled=false;}
};
$('receiptPaymentHistory').addEventListener('click',async event=>{
 if(paymentBusy)return;
 const assign=event.target.closest('[data-assign-payment]');
 if(assign){
  assigningPayment=assign.dataset.assignPayment==='legacy'?'legacy':Number(assign.dataset.assignPayment);
  paymentForm.hidden=false;
  const existing=paymentState.payments.find(p=>p.id===assigningPayment);
  paymentForm.elements.namedItem('payment_date').disabled=!!existing;
  if(existing)paymentForm.elements.namedItem('payment_date').value=existing.payment_date;
  paymentForm.elements.namedItem('notes').disabled=true;
  $('receiptPaymentSource').querySelector('[value=unassigned]').disabled=true;
  $('receiptPaymentSource').value=paymentState.loans.length?'loan':'equity';paymentAccountOptions();return;
 }
 const undo=event.target.closest('[data-undo-finance-payment]'),unassign=event.target.closest('[data-unassign-payment]');
 if(!undo&&!unassign)return;
 if(!await PHBUI.confirm(unassign?'Nur die Finanzierungszuordnung lösen? Die Rechnung bleibt bezahlt.':'Diese Zahlung zurücknehmen? Der offene Betrag und die verfügbaren Mittel werden neu berechnet.'))return;
 paymentBusy=true;
 try{
  const id=undo?.dataset.undoFinancePayment||unassign.dataset.unassignPayment;
  await api('/api/financing/payments/'+id+(unassign?'/unassign':''),{method:unassign?'POST':'DELETE'});
  await reload(selected);await showReceiptPayments();
 }catch(error){notice(error.message,true);}finally{paymentBusy=false;}
});
paymentForm.onsubmit=async event=>{
 event.preventDefault();if(!selected||!paymentState||paymentBusy)return;
 try{
  const data=Object.fromEntries(new FormData(paymentForm));data.amount=PHBUI.currency.parse(data.amount);
  if(!Number.isFinite(data.amount)||data.amount<=0)throw Error('Gültigen Zahlungsbetrag eingeben.');
  if(data.source!=='unassigned'){
   const account=$('receiptPaymentAccount').value;if(!account)throw Error('Finanzierungsquelle wählen oder später zuordnen.');
   data[data.source==='loan'?'loan_id':'equity_id']=account;
  }
  data.receipt_id=selected;if(assigningPayment&&assigningPayment!=='legacy')data.payment_id=assigningPayment;
  if(!await PHBUI.confirm(assigningPayment?money(data.amount)+' einer Finanzierungsquelle zuordnen? Keine erneute Zahlung.':money(data.amount)+' als Zahlung erfassen'+(data.source==='unassigned'?' – Finanzierung nicht zugewiesen':'')+'?'))return;
  paymentBusy=true;$('submitReceiptPayment').disabled=true;
  await api('/api/financing/payments'+(assigningPayment?'/assign':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  await reload(selected);await showReceiptPayments();$('receiptPaymentMessage').textContent='Gespeichert. Zahlungsstand aktualisiert.';
 }catch(error){$('receiptPaymentMessage').textContent=error.message;}
 finally{paymentBusy=false;$('submitReceiptPayment').disabled=false;}
};

$('upload').onsubmit=async e=>{
 e.preventDefault();
 if(uploading)return;
 const ai=$('receiptAnalysisMode').value==='ai';
 const button=$('receiptUploadButton');
 uploading=true;button.disabled=true;
 $('uploadStatus').textContent='Dateien werden für die Analyse hochgeladen …';
 try{
   let model='';
   if(ai)model=window.PHBAI?.selection()?.model||'';
   const result=await window.PHBImports.run({
     form:$('upload'),kind:'receipts',files:$('upload').elements.namedItem('files').files,
     analysisMode:ai?'ai':'local',model
   });
   $('upload').reset();
   $('receiptAIHint').hidden=true;
   button.textContent='Dateien analysieren';
   receiptFlow.finish();
   if(result.background)notice('Die Belege werden in der Warteschlange analysiert.');else window.PHBImports.review(result.jobs);
 }catch(error){$('uploadStatus').textContent='Import/Analyse fehlgeschlagen: '+error.message;}
 finally{uploading=false;window.PHBImports.release(button);}
};
document.addEventListener('phb-import-updated',event=>{
 if(event.detail.kind==='receipts'&&!receiptDialog.open)reload().catch(()=>{});
});

async function receiptAction(action,button,success){
 if(!selected||receiptBusy)return false;
 const states=[...$('review').querySelectorAll('input,select,textarea,button')].map(node=>[node,node.disabled]);
 receiptBusy=true;button.disabled=true;
 for(const [node] of states)node.disabled=true;
 let ok=false;
 try{
  await action();
  await reload(selected);
  ok=true;
  if(success)notice(success);
 }catch(error){notice(error.message,true);}
 finally{
  receiptBusy=false;
  for(const [node,disabled] of states)if(!ok||node.tagName==='BUTTON')node.disabled=disabled;
  button.disabled=false;
 }
 return ok;
}
$('review').onsubmit=async e=>{
 e.preventDefault();
 if(receiptBusy)return;
 let fields;try{fields=inputs();}catch(error){notice(error.message,true);return;}
 const draft=$('book').hidden===false;
 await receiptAction(async()=>{
  await api('/api/receipts/'+selected,{
   method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(fields)
  });
 },e.submitter||$('saveReceiptDraft'),draft?'Entwurf gespeichert. Du kannst später weiterprüfen oder eine Firma anlegen.':'Änderungen gespeichert.');
};
$('receiptCreateCompany').onclick=async event=>{
 event.preventDefault();
 if(!selected||receiptBusy)return;
 let fields;try{fields=inputs();}catch(error){notice(error.message,true);return;}
 const id=selected;
 const saved=await receiptAction(()=>api('/api/receipts/'+id,{
  method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)
 }),$('saveReceiptDraftTop'),'Entwurf gespeichert.');
 if(saved)location.assign('/stammdaten?receipt_id='+id+'&new_company=1#firmen');
};
$('book').onclick=async()=>{
 if(!selected||receiptBusy)return;
 if(!$('review').reportValidity())return;
 let fields;try{fields=inputs({booking:true});}catch(error){notice(error.message,true);return;}
 // A cancelled confirmation must never mutate the draft.
 if(!await PHBUI.confirm('Rechnungsdaten speichern und den Beleg verbindlich buchen? Unbezahlte Rechnungen bleiben offen.'))return;
 await receiptAction(async()=>{
  await api('/api/receipts/'+selected,{
   method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({...fields,book_now:true})
  });
 },$('book'),'Rechnung gebucht. Zahlungen kannst du anschließend separat erfassen.');
};
$('unbook').onclick=async()=>{
 if(!selected||receiptBusy||!await PHBUI.confirm('Buchung zurücknehmen? Die Belegausgaben werden aus der Übersicht entfernt.'))return;
 await receiptAction(()=>api('/api/receipts/'+selected+'/unbook',{method:'POST'}),$('unbook'),'Buchung zurückgenommen.');
};
$('delete').onclick=async()=>{
 if(!selected||receiptBusy||!await PHBUI.confirm('Diesen Entwurf einschließlich Originaldatei dauerhaft löschen?'))return;
 const button=$('delete');receiptBusy=true;button.disabled=true;
 try{
  await api('/api/receipts/'+selected,{method:'DELETE'});
  selected=null;await reload(null);
  notice('Entwurf gelöscht.');
 }catch(error){notice(error.message,true);}
 finally{receiptBusy=false;button.disabled=false;}
};

reload().catch(e=>notice(e.message,true));

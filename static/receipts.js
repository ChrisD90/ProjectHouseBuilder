'use strict';
const $=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(value)||0);
let selected=null,list=[],overview=null;
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
 const frozen=$('book').hidden;
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
 $('deductionHint').hidden=$('billingType').value!=='Schlussrechnung';
 const hint=$('billableHint');
 hint.textContent=isAccepted
   ? `Mit dem angenommenen Angebot „${offer.vendor}“ verknüpft. Abschläge und Schlussrechnung werden zum Vertragsbetrag von ${money(offer.agreed_gross??offer.gross)} addiert, ohne verrechnete Abschläge doppelt zu zählen.`
   : mode==='Betrieb'?'Direkt einem Betrieb zugeordnet; keine automatische Verknüpfung zu einem Angebot. Die Rechnung wird nur einmal als Ausgabe berücksichtigt.'
   : mode==='Eigenleistung'?'Eigenleistung/Material: Keine Verknüpfung zu einem Handwerker oder Angebot. Falls vorhanden, die passende Budgetposition auswählen.'
   : mode==='Kostenposition'?'Historische Kostenpositionszuordnung. Für Änderungen kann ein regulärer Zuordnungstyp ausgewählt werden.'
   : 'Wähle Angebot, Betrieb oder Eigenleistung. Nur angenommene Angebote erscheinen in der Angebotsauswahl.';
}
$('receiptAssignmentType').addEventListener('change',()=>{
  if($('receiptAssignmentType').value!=='Angebot'&&$('receiptAssignmentType').value!=='Kostenposition')$('costItems').value='';
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
function notice(msg,err=false){$('message').textContent=msg;$('message').classList.toggle('error',err)}
function inputs(){
 PHBUI.currency.normalizeForm($('review'));
  const result=Object.fromEntries(new FormData($('review')));
  // Payment is always recorded separately, with a financing source, after booking.
  delete result.paid_amount;
 const mode=$('receiptAssignmentType').value;
 if(!mode)throw Error('Bitte die Rechnung einem Angebot, Betrieb oder der Eigenleistung zuordnen.');
 if(mode==='Angebot'&&!$('costItems').value)throw Error('Bitte ein angenommenes Angebot auswählen.');
 if(mode==='Betrieb'&&!$('receiptContractor').value)throw Error('Bitte einen Betrieb auswählen.');
 result.assignment_type=mode;
 result.cost_item_id=(mode==='Angebot'||mode==='Kostenposition')?$('costItems').value:null;
 result.contractor_id=mode==='Betrieb'?$('receiptContractor').value:null;
 result.reviewed=true; // Explicitly saved and confirmed in the editor.
 return result;
}
function fillSelect(node,values,getTitle){node.innerHTML='<option value="">Keine Zuordnung</option>'+values.map(x=>`<option value="${x.id}">${safe(getTitle(x))}</option>`).join('')}
async function reload(keepId=selected){
 const [r,c]=await Promise.all([api('/api/receipts'),api('/api/costs')]);overview=c;list=r.receipts;
 $('stats').innerHTML=`<span>Entwürfe: <b>${r.drafts}</b></span><span>Gebucht brutto: <b>${money(r.booked_gross)}</b></span><span>Bezahlt: <b>${money(r.paid)}</b></span><span>Lohnanteil erfasst: <b>${list.filter(x=>x.labor_amount!==null).length} Belege</b></span>`;
 $('categories').innerHTML=r.categories.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');
 fillSelect($('budgetLines'),c.budget_lines.filter(x=>x.active&&!x.is_group),x=>x.category+' · '+x.title);
 renderCostItems();
 $('list').innerHTML=list.map(x=>`<button type="button" data-id="${x.id}" class="entry ${keepId===x.id?'active':''}"><span class="status ${x.status==='Gebucht'?'booked':''}">${safe(x.status)}</span><strong>${safe(x.supplier||x.filename)}</strong><small>${safe(x.document_date||'Ohne Datum')} · ${money(x.counted_amount)} neu abgerechnet · ${safe(x.category)} · ${safe(assignmentLabel(x))}</small>${x.labor_amount!==null?`<small class="receipt-labor-preview">Arbeits-/Lohnkosten brutto: <strong>${money(x.labor_amount)}</strong></small>`:''}</button>`).join('')||'<p>Du hast noch keine Belege erfasst.</p>';
 document.querySelectorAll('.entry').forEach(b=>b.onclick=()=>open(Number(b.dataset.id)));
 if(keepId&&list.some(x=>x.id===keepId))await open(keepId);
 else if(linkReceipt&&list.some(x=>x.id===linkReceipt))await open(linkReceipt);
 else if(!list.length){$('review').hidden=true;$('placeholder').hidden=false;showReceiptPreview(null);}
 if(linkOffer&&!selected){$('uploadStatus').textContent='Angebot ausgewählt: Lade die Rechnung hoch und prüfe danach die Verknüpfung im Entwurf.';}
}
async function open(id){
 try{let x=await api('/api/receipts/'+id);selected=id;document.querySelectorAll('.entry').forEach(b=>b.classList.toggle('active',Number(b.dataset.id)===id));
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
 $('book').hidden=x.status==='Gebucht';$('unbook').hidden=x.status!=='Gebucht';$('delete').hidden=x.status==='Gebucht';
 $('payReceipt').hidden=x.status!=='Gebucht';
 $('receiptPaymentsPanel').hidden=true;
 $('receiptReviewLayout').hidden=false;
 $('receiptReviewStage').hidden=false;
 for(let node of $('review').querySelectorAll('input,select,textarea'))node.disabled=x.status==='Gebucht'&&node.name!=='notes'&&node.name!=='paid_amount'&&node.name!=='due_date';
 $('review').elements.namedItem('paid_amount').disabled=true;
 $('receiptTaxRate').disabled=x.status==='Gebucht';
 $('receiptTaxHint').textContent='Wenn du den Bruttobetrag bearbeitest, werden Netto und USt mit dem gewählten Satz automatisch berechnet. Bei gemischten Steuersätzen „manuell“ auswählen. Originalbeleg prüfen.';
 if(linkedCostItem&&x.status==='Entwurf'&&!x.cost_item_id&&!x.assignment_type){
   $('receiptAssignmentType').value='Angebot';
   $('costItems').value=String(linkedCostItem);
 }
 updateInvoiceControls();
 $('original').href='/api/receipts/'+id+'/download';$('raw').textContent=x.ocr_text||'Keine Textdaten erkannt. Manuelle Eingabe erforderlich.';
 receiptFlow.snapshot(); // Automatically filled invoice fields form the clean baseline.
 $('rawDetails').hidden=!x.ocr_text; $('warnings').textContent=(x.warnings||[]).join(' · ');notice(x.status==='Gebucht'?'Gebucht: Für Betragsänderungen zuerst Buchung zurücknehmen.':'Bitte Daten prüfen, dann speichern und buchen.');
 }catch(e){notice(e.message,true)}
}
let paymentState=null;
const paymentForm=$('receiptPaymentForm');
function paymentAccountOptions(){
 if(!paymentState)return;
 const source=$('receiptPaymentSource').value;
 const accounts=source==='loan'?paymentState.loans:paymentState.equity;
 const available=a=>Number(source==='loan'?a.balance?.unallocated_drawn:a.balance?.available)||0;
 const usable=accounts.filter(x=>available(x)>0.005);
 $('receiptPaymentAccount').innerHTML=usable.map(a=>
   '<option value="'+a.id+'">'+safe(a.name)+' · frei '+money(available(a))+'</option>').join('');
 const receipt=paymentState.receipts.find(x=>x.id===selected);
 const account=usable[0];
 const max=Math.min(Number(receipt?.open||0),available(account||{}));
 $('receiptPaymentAmount').value=max>0?PHBUI.currency.format(max):'';
 $('submitReceiptPayment').disabled=!usable.length||!receipt||receipt.open<=0;
 $('receiptPaymentMessage').textContent=usable.length?'':'Keine frei verfügbaren Mittel aus dieser Finanzierungsart. Konten und Kreditabrufe unter Finanzierung prüfen.';
}
async function showReceiptPayments(){
 if(!selected)return;
 const current=list.find(r=>r.id===selected);
 if(!current||current.status!=='Gebucht')return;
 paymentState=await api('/api/financing');
 const receipt=paymentState.receipts.find(x=>x.id===selected);
 if(!receipt)throw Error('Gebuchte Rechnung wurde nicht in der Finanzierungsübersicht gefunden.');
 const allocations=paymentState.payments.filter(x=>x.receipt_id===selected);
 $('receiptPaymentsPanel').hidden=false;
  receiptFlow.stage(2);
 $('receiptReviewLayout').hidden=true;
 $('receiptReviewStage').hidden=true;
 $('receiptPaymentTotals').innerHTML='<span>Rechnungsbetrag: <b>'+money(receipt.gross)+'</b></span>'+
   '<span>Bereits bezahlt: <b>'+money(receipt.paid)+'</b></span>'+
   '<span>Noch offen: <b>'+money(receipt.open)+'</b></span>';
 $('receiptPaymentMessage').textContent='';
 $('receiptPaymentForm').hidden=receipt.open<=0;
 $('receiptPaymentHistory').innerHTML='<h4>Erfasste Zahlungen</h4>'+
   (allocations.length?allocations.map(p=>'<div class="receipt-payment-history-row"><span>'+
     money(p.amount)+' · '+safe(p.payment_date)+' · '+
     safe((p.source==='loan'?paymentState.loans:paymentState.equity).find(a=>a.id===(p.loan_id||p.equity_id))?.name||p.source)+
     (p.notes?' · '+safe(p.notes):'')+
     '</span><button type="button" data-undo-finance-payment="'+p.id+'">Zahlung stornieren</button></div>').join(''):'<p class="note">Noch keine zugeordneten Zahlungen erfasst.</p>');
 if(receipt.open>0&&receipt.paid>allocations.reduce((sum,p)=>sum+Number(p.amount),0)+0.005)
   $('receiptPaymentMessage').textContent='Für diesen Beleg existiert bereits eine manuell erfasste Zahlung ohne Finanzierungsquelle. Bitte den bisherigen Zahlbetrag im Beleg berichtigen, bevor du die Finanzierungsquelle zuordnest.';
 paymentForm.elements.namedItem('payment_date').value=new Date().toLocaleDateString('sv-SE');
 paymentAccountOptions();
 receiptFlow.snapshot(); // Auto-filled payment values are not user edits.
 requestAnimationFrame(()=>$('receiptPaymentsPanel').scrollIntoView({block:'nearest'}));
}
$('payReceipt').onclick=async()=>{
 try{await showReceiptPayments();}
 catch(err){notice(err.message,true);}
};
$('closeReceiptPayment').onclick=()=>{
  $('receiptPaymentsPanel').hidden=true;
  receiptFlow.stage(1);
  $('receiptReviewLayout').hidden=false;
  $('receiptReviewStage').hidden=false;
};
$('receiptPaymentSource').onchange=paymentAccountOptions;
paymentForm.onsubmit=async event=>{
 event.preventDefault();
 if(!selected||!paymentState||paymentBusy)return;
 const submit=$('submitReceiptPayment');
 PHBUI.currency.normalizeForm(paymentForm);
  const data=Object.fromEntries(new FormData(paymentForm).entries());
 const account=$('receiptPaymentAccount').value;
 if(!account){$('receiptPaymentMessage').textContent='Bitte eine Finanzierungsquelle auswählen.';return;}
 data.receipt_id=selected;
 data[data.source==='loan'?'loan_id':'equity_id']=account;
 if(!await PHBUI.confirm('Zahlung von '+money(PHBUI.currency.parse(data.amount))+' verbindlich aus '+(data.source==='loan'?'Kredit':'Eigenkapital')+' buchen?'))return;
 paymentBusy=true;
 submit.disabled=true;$('receiptPaymentMessage').textContent='Zahlung wird geprüft und verbucht …';
 try{
   await api('/api/financing/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
   await reload(selected);
   await showReceiptPayments();
   $('receiptPaymentMessage').textContent='Zahlung verbucht. Offener Rechnungsbetrag und verfügbare Mittel wurden aktualisiert.';
 }catch(error){$('receiptPaymentMessage').textContent='Zahlung fehlgeschlagen: '+error.message;}
 finally{paymentBusy=false;submit.disabled=false;}
};
$('receiptPaymentHistory').addEventListener('click',async event=>{
 const button=event.target.closest('[data-undo-finance-payment]');
 if(!button||paymentBusy)return;
 if(!await PHBUI.confirm('Diese Zahlung stornieren? Der offene Rechnungsbetrag und die verfügbaren Mittel werden neu berechnet.'))return;
 paymentBusy=true;button.disabled=true;
 try{
   await api('/api/financing/payments/'+button.dataset.undoFinancePayment,{method:'DELETE'});
   await reload(selected);await showReceiptPayments();
   $('receiptPaymentMessage').textContent='Zahlung storniert.';
 }catch(error){notice(error.message,true);}
 finally{paymentBusy=false;button.disabled=false;}
});

$('upload').onsubmit=async e=>{
 e.preventDefault();
 if(uploading)return;
 const ai=$('receiptAnalysisMode').value==='ai';
 const button=$('receiptUploadButton');
 uploading=true;button.disabled=true;
 $('uploadStatus').textContent='Dateien werden für die Hintergrundverarbeitung vorbereitet …';
 try{
   let model='';
   if(ai)model=window.PHBAI?.selection()?.model||'';
   const jobs=await window.PHBImports.enqueue({
     kind:'receipts',files:$('upload').elements.namedItem('files').files,
     analysisMode:ai?'ai':'local',model
   });
   $('upload').reset();
   $('receiptAIHint').hidden=true;
   button.textContent='Dateien im Hintergrund analysieren';
   $('uploadStatus').textContent=jobs.length+' Beleg(e) in der Warteschlange. Nach Abschluss zur Prüfung öffnen.';
   receiptDialog.close();
 }catch(error){$('uploadStatus').textContent='Import nicht gestartet: '+error.message;}
 finally{uploading=false;button.disabled=false;}
};
document.addEventListener('phb-import-updated',event=>{
 if(event.detail.kind==='receipts'&&!receiptDialog.open)reload().catch(()=>{});
});

async function receiptAction(action,button,success){
 if(!selected||receiptBusy)return;
 receiptBusy=true;button.disabled=true;
 try{
  await action();
  await reload(selected);
  if(success)notice(success);
 }catch(error){notice(error.message,true);}
 finally{receiptBusy=false;button.disabled=false;}
}
$('review').onsubmit=async e=>{
 e.preventDefault();
 await receiptAction(async()=>{
  await api('/api/receipts/'+selected,{
   method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(inputs())
  });
 },$('review').querySelector('button[type=submit]'),'Änderungen gespeichert. Die Rechnung ist noch nicht gebucht.');
};
$('book').onclick=async()=>{
 if(!selected||receiptBusy)return;
 // A cancelled confirmation must never mutate the draft.
 if(!await PHBUI.confirm('Rechnungsdaten speichern und den Beleg verbindlich buchen? Unbezahlte Rechnungen bleiben offen.'))return;
 await receiptAction(async()=>{
  const fields=inputs();
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

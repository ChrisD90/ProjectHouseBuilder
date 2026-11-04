'use strict';
const $=id=>document.getElementById(id);
// A running server or an already rendered dialog can still supply the older
// template after a static-script update. Upgrade this optional field before
// wiring listeners; a missing extension must never stop the receipt journal.
if(!$('receiptSelfWork')&&$('receiptAssignmentType')){
 const wrapper=document.createElement('label');
 wrapper.id='receiptSelfWorkWrap';wrapper.hidden=true;
 wrapper.append(document.createTextNode('Eigenleistung'));
 const select=document.createElement('select');
 select.id='receiptSelfWork';select.name='self_work_id';
 select.add(new Option('Keine konkrete Eigenleistung',''));
 wrapper.append(select);
 const container=$('receiptAssignmentType').closest('.receipt-assignment-fields')||$('receiptAssignmentType').parentElement.parentElement;
 container.append(wrapper);
}
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(value)||0);
let selected=null,list=[],overview=null,currentReceipt=null,assignmentEditing=false;
let receiptSearchText='',receiptLaborFilter='all',receiptYearFilter='';
const receiptDialog=$('receiptWorkflowDialog');
let uploadReceiptKind='Rechnung';
// Also support a still-rendered older template during an application update.
if(!$('openTillReceiptWorkflow')){
 const button=document.createElement('button');button.id='openTillReceiptWorkflow';button.type='button';
 button.className='primary';button.dataset.importKind='receipts';button.textContent='+ Kassenzettel erfassen';
 $('openReceiptWorkflow').after(button);
}
$('openReceiptWorkflow').textContent='+ Rechnung erfassen';
const tillInfo=document.createElement('p');tillInfo.className='note receipt-till-info';tillInfo.hidden=true;
tillInfo.textContent='Kassenzettel sind beim Einkauf bezahlt. Beim bestätigten Buchen wird der Gesamtbetrag als bezahlt erfasst und der gewählten Finanzierungsquelle zugeordnet.';
const tillFinance=document.createElement('label');tillFinance.className='receipt-till-financing';tillFinance.hidden=true;
tillFinance.append(document.createTextNode('Finanzierungsquelle'));
const tillFinanceSelect=document.createElement('select');tillFinanceSelect.id='tillFinancingSource';tillFinanceSelect.name='till_financing_choice';tillFinanceSelect.disabled=true;
const tillFinanceHint=document.createElement('small');tillFinanceHint.setAttribute('aria-live','polite');
const tillFinanceRetry=document.createElement('button');tillFinanceRetry.type='button';tillFinanceRetry.className='subtle';tillFinanceRetry.textContent='Quellen erneut laden';tillFinanceRetry.hidden=true;
tillFinance.append(tillFinanceSelect,tillFinanceHint,tillFinanceRetry);
let tillFinanceChoices=new Map();
const tillFinanceDraftSelections=new Map();
function tillFinanceKey(id){return 'phb-till-financing:'+(window.PHBProject?.id||1)+':'+id;}
function tillFinanceHelp(){
 const account=tillFinanceChoices.get(tillFinanceSelect.value);
 if(!account){tillFinanceHint.textContent='Als bezahlt erfassen, Finanzierungsquelle später zuordnen.';return;}
 const amount=PHBUI.currency.parse($('receiptGross').value)||0;
 tillFinanceHint.textContent='Verfügbar: '+money(account.available)+(amount>account.available?' · Der Betrag reicht nicht aus. Andere Quelle oder „Nicht zugewiesen“ wählen.':account.reserve>0&&account.available-amount<account.reserve?' · Hinweis: Die vorgesehene Reserve von '+money(account.reserve)+' würde unterschritten.':'. Die Zahlung wird beim Buchen dieser Quelle zugeordnet.');
}
tillFinanceSelect.onchange=()=>{
 if(selected)tillFinanceDraftSelections.set(tillFinanceKey(selected),tillFinanceSelect.value);
 if(selected)try{localStorage.setItem(tillFinanceKey(selected),tillFinanceSelect.value);}catch(_){}
 tillFinanceHelp();
};
$('receiptGross').addEventListener('input',()=>{if(!tillFinanceSelect.disabled)tillFinanceHelp();});
async function loadTillFinancing(receipt){
 if(!receipt||receipt.status!=='Entwurf')return;
 const ident=receipt.id;tillFinanceSelect.disabled=true;tillFinanceRetry.hidden=true;
 tillFinanceSelect.replaceChildren(new Option('Finanzierungsquellen werden geladen …',''));
 try{
   const finance=await api('/api/financing');
   if(selected!==ident)return;
   const equities=[...(finance.equity||[])].sort((a,b)=>a.id-b.id);
   tillFinanceChoices=new Map();tillFinanceSelect.replaceChildren(new Option('Nicht zugewiesen · später zuordnen','unassigned'));
   for(const [source,accounts] of [['equity',equities],['loan',finance.loans||[]]])for(const account of accounts){
     const available=Number(source==='equity'?account.balance?.available:account.balance?.unallocated_drawn)||0;
     const value=source+':'+account.id;tillFinanceChoices.set(value,{name:account.name,available,reserve:Number(account.reserve)||0});
     tillFinanceSelect.add(new Option((source==='equity'?'Eigenkapital':'Kredit')+' · '+account.name+' · verfügbar '+money(available),value));
   }
   let saved=tillFinanceDraftSelections.get(tillFinanceKey(ident))||null;try{saved=saved||localStorage.getItem(tillFinanceKey(ident));}catch(_){}
   tillFinanceSelect.value=saved&&(saved==='unassigned'||tillFinanceChoices.has(saved))?saved:saved?'unassigned':equities.length?'equity:'+equities[0].id:'unassigned';
   tillFinanceSelect.disabled=false;tillFinanceHelp();
 }catch(error){
   if(selected!==ident)return;
   tillFinanceHint.textContent='Finanzierungsquellen konnten nicht geladen werden: '+error.message;tillFinanceRetry.hidden=false;
 }
}
tillFinanceRetry.onclick=()=>loadTillFinancing(currentReceipt);
const tillExtras=document.createElement('button');tillExtras.type='button';tillExtras.className='subtle receipt-till-extras';tillExtras.textContent='Weitere Angaben anzeigen';tillExtras.hidden=true;
$('review').prepend(tillInfo);
($('review').querySelector('.receipt-billing-grid')||$('review')).append(tillFinance);
($('review').querySelector('.receipt-billing')||$('review')).append(tillExtras);
tillExtras.onclick=()=>{
 const expanded=receiptDialog.classList.toggle('show-till-extras');
 tillExtras.textContent=expanded?'Weitere Angaben ausblenden':'Weitere Angaben anzeigen';
 tillExtras.setAttribute('aria-expanded',String(expanded));
};
function applyTillMode(enabled){
 receiptDialog.classList.toggle('is-till-receipt',enabled);
 receiptDialog.classList.remove('show-till-extras');tillExtras.textContent='Weitere Angaben anzeigen';tillExtras.setAttribute('aria-expanded','false');
 tillInfo.hidden=!enabled||!receiptDialog.classList.contains('is-reviewing');tillExtras.hidden=tillInfo.hidden;
 tillFinance.hidden=tillInfo.hidden||currentReceipt?.status!=='Entwurf';
 for(const name of ['due_date','budget_line_id'])$('review').elements.namedItem(name)?.closest('label')?.setAttribute('data-till-extra','');
 for(const node of [$('billingType')?.closest('label'),$('review').querySelector('.receipt-labor')])node?.setAttribute('data-till-extra','');
 if(receiptDialog.classList.contains('is-reviewing')){
   const kind=enabled?'Kassenzettel':$('review').elements.namedItem('kind').value==='Gutschrift'?'Gutschrift':'Rechnung';
   const title=kind==='Kassenzettel'
     ? currentReceipt?.status==='Entwurf'?'Kassenzettel prüfen':currentReceipt?.status==='Storniert'?'Stornierter Kassenzettel':'Gebuchter Kassenzettel'
     : currentReceipt?.status==='Entwurf'?kind+' prüfen':currentReceipt?.status==='Storniert'?'Stornierte '+kind:'Gebuchte '+kind;
   $('receiptWorkflowTitle').textContent=title;
   $('receiptReviewTitle').textContent=$('receiptWorkflowTitle').textContent;
   if(currentReceipt?.status==='Entwurf')$('receiptReviewHelp').textContent=enabled?'Lieferant, Bonnummer, Datum und Beträge prüfen. Erst beim bestätigten Buchen wird der Kassenzettel als bezahlt erfasst.':'Rechnungsdaten und Zuordnung prüfen. Die Zahlung erfasst du nach dem Buchen separat.';
 }
 $('book').textContent=enabled?'Kassenzettel buchen':'Verbindlich buchen';
 $('payReceipt').textContent=enabled?'Finanzierung zuordnen (optional)':'Zahlung erfassen';
 const paymentStep=receiptDialog.querySelector('[data-flow-step="2"] .phb-flow-step-label');
 if(paymentStep)paymentStep.textContent=enabled?'Finanzierung (optional)':'Bezahlen';
}
function showReceiptPreview(item){
 const pane=$('receiptPdfPane'),frame=$('receiptPdfFrame'),image=$('receiptImagePreview');
 const name=item?.original_name||item?.filename||'';
 const isPdf=/\.pdf$/i.test(name),isImage=/\.(png|jpe?g|webp)$/i.test(name);
 pane.hidden=!item||(!isPdf&&!isImage);
 if(pane.hidden){frame.removeAttribute('src');image.removeAttribute('src');return;}
 const url=window.PHBProject?.url('/api/receipts/'+encodeURIComponent(item.id)+'/preview')||'/api/receipts/'+encodeURIComponent(item.id)+'/preview';
 frame.hidden=!isPdf;image.hidden=!isImage;
 if(isPdf&&frame.getAttribute('src')!==url)frame.src=url;
 if(isImage)image.src=url;
 $('receiptPdfDownload').href='/api/receipts/'+item.id+'/download';
}

let uploading=false,receiptBusy=false,paymentBusy=false,receiptNavigationVersion=0;
const receiptFlow=PHBFlow.manage({
 routeParams:['receipt_id','offer_id','upload','self_work_id','receipt_kind','new_company_id','financing'],
 onClose:()=>{if(!receiptDialog.open){receiptNavigationVersion++;selected=null;linkOffer=null;linkSelfWork=null;}},
 dialog:'receiptWorkflowDialog',
 forms:['upload','review','receiptPaymentForm'],
 dismiss:['closeReceiptWorkflow'],
 steps:['Erfassen','Prüfen & buchen','Bezahlen'],
 isBusy:()=>uploading||receiptBusy||paymentBusy
});
function openReceiptDialog(review=false){
  receiptDialog.classList.toggle('is-reviewing',Boolean(review));
  if(!review)$('receiptWorkflowTitle').textContent=uploadReceiptKind==='Kassenzettel'?'Kassenzettel hochladen':'Rechnung hochladen und prüfen';
  applyTillMode(review?currentReceipt?.kind==='Kassenzettel':uploadReceiptKind==='Kassenzettel');
  if(!receiptDialog.open)receiptFlow.open({step:review?1:0});
  else receiptFlow.stage(review?1:0);
  if(review){
    requestAnimationFrame(()=>[...$('review').querySelectorAll('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].find(node=>node.getClientRects().length)?.focus({preventScroll:true}));
  } else {
    requestAnimationFrame(()=>$('upload').querySelector('input[type=file]')?.focus({preventScroll:true}));
  }
}
$('openReceiptWorkflow').onclick=()=>{
  uploadReceiptKind='Rechnung';
  linkSelfWork=null;$('uploadStatus').textContent='';
  selected=null;
  $('review').hidden=true;$('placeholder').hidden=false;showReceiptPreview(null);
  openReceiptDialog(false);
};
$('openTillReceiptWorkflow').onclick=()=>{
  $('openReceiptWorkflow').onclick();uploadReceiptKind='Kassenzettel';openReceiptDialog(false);
  $('uploadStatus').textContent='Kassenzettel werden als Eigenleistung / Material vorbelegt. Prüfen und buchen erfolgt nach der Analyse; der Einkauf wird dann automatisch als bezahlt erfasst.';
};
$('closeReceiptWorkflow').onclick=()=>{if(!uploading&&!receiptBusy)receiptDialog.close();};
receiptDialog.addEventListener('cancel',event=>{if(uploading||receiptBusy)event.preventDefault();});

const navigation=new URLSearchParams(window.location.search);
let linkOffer=Number(navigation.get('offer_id'))||null;
let linkSelfWork=null;
async function activateReceiptNavigation(){
 const params=new URLSearchParams(location.search);
 if(params.get('upload')==='1'&&!params.get('receipt_id')){
   uploadReceiptKind=params.get('receipt_kind')==='Kassenzettel'?'Kassenzettel':'Rechnung';
   const ident=Number(params.get('self_work_id'))||null;
   let plan=null;
   if(ident){plan=(await api('/api/self-work/'+ident)).plan;}
   linkSelfWork=ident;selected=null;
   $('review').hidden=true;$('placeholder').hidden=false;showReceiptPreview(null);
   openReceiptDialog(false);
   $('uploadStatus').textContent='';
   if(plan){
     $('receiptWorkflowTitle').textContent='Beleg zur Eigenleistung erfassen';
     $('uploadStatus').textContent='Eigenleistung: '+plan.title+(plan.task_label?' · '+plan.task_label:'')+'. Zuordnung und verfügbare Kategorisierungsdaten werden im Entwurf vorausgefüllt.';
   }
   return;
 }
 linkSelfWork=null;
 const id=Number(params.get('receipt_id'));
 if(id&&!receiptDialog.open&&list.some(x=>x.id===id))return open(id);
}
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
  $('receiptSupplierCompany').innerHTML='<option value="">Lieferant manuell eingeben</option>'+contractors.map(x=>`<option value="${x.id}">${safe(x.name)}</option>`).join('');
  linkedCostItem=offered.find(x=>x.offer_id===linkOffer)?.id||null;
}
function normalizedSearch(value){
 return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de-DE').trim();
}
function receiptMatchesSearch(receipt){
 if(receiptLaborFilter==='labor'&&!(Number(receipt.labor_amount)>0))return false;
 if(receiptYearFilter&&String(receipt.document_date||'').slice(0,4)!==receiptYearFilter)return false;
 if(!receiptSearchText)return true;
 const values=[receipt.supplier,receipt.invoice_number,receipt.document_date,
  receipt.due_date,receipt.trade,receipt.category,receipt.kind,receipt.billing_type,receipt.status,
  assignmentLabel(receipt),receipt.gross_amount,receipt.counted_amount,
  receipt.paid_amount,money(receipt.gross_amount),money(receipt.counted_amount)];
 const fields=values.map(normalizedSearch);
 return receiptSearchText.split(/\s+/).every(term=>fields.some(field=>field.includes(term)));
}
function renderReceiptFilters(){
 const select=$('receiptYearFilter'),previous=receiptYearFilter;
 const years=[...new Set(list.map(row=>String(row.document_date||'').slice(0,4)).filter(value=>/^\d{4}$/.test(value)))].sort().reverse();
 select.innerHTML='<option value="">Alle Jahre</option>'+years.map(year=>`<option value="${year}">${year}</option>`).join('');
 if(years.includes(previous))select.value=previous;else receiptYearFilter='';
}
function renderLaborSummary(){
 const panel=$('receiptLaborSummary');panel.hidden=receiptLaborFilter!=='labor';
 if(panel.hidden)return;
 const rows=list.filter(row=>Number(row.labor_amount)>0&&row.status==='Gebucht'&&(!receiptYearFilter||String(row.document_date||'').slice(0,4)===receiptYearFilter));
 const total=rows.reduce((sum,row)=>sum+Number(row.labor_amount),0),link=$('receiptLaborExport');
 $('receiptLaborTotal').textContent=money(total);
 $('receiptLaborCount').textContent=rows.length===1?'1 gebuchter Beleg':rows.length+' gebuchte Belege';
 const available=Boolean(receiptYearFilter&&rows.length);
 link.setAttribute('aria-disabled',String(!available));link.tabIndex=available?0:-1;
 link.href=available?'/api/receipts/labor-export.zip?year='+encodeURIComponent(receiptYearFilter):'#';
 link.textContent=receiptYearFilter?'Steuerunterlagen '+receiptYearFilter+' als ZIP':'Jahr für Export wählen';
}
function renderReceiptList(){
 const visible=list.filter(receiptMatchesSearch);
 const filtered=Boolean(receiptSearchText||receiptLaborFilter!=='all'||receiptYearFilter);
 $('receiptSearchResult').textContent=filtered
  ?`${visible.length} von ${list.length} Belegen gefunden`
  :`${list.length} Belege insgesamt`;
 $('list').innerHTML=visible.map(x=>`<article class="receipt-entry-row ${selected===x.id?'active':''}" data-receipt-kind="${safe(x.kind||'Rechnung')}"><div class="receipt-entry-heading"><div class="receipt-entry-statuses"><span class="status ${x.status==='Gebucht'?'booked':x.status==='Storniert'?'cancelled':'draft'}">${safe(x.status)}</span><span class="receipt-kind-badge">${safe(x.kind||'Rechnung')}</span></div><div class="receipt-entry-tools">${x.status==='Gebucht'&&x.paid_amount>0?`<span class="receipt-payment-badge">${safe(x.payment_assignment)}${x.unassigned_amount>0?' · '+money(x.unassigned_amount):''}</span>`:''}${PHBWorkUI.button('receipt',x.id)}</div></div><button type="button" data-id="${x.id}" class="entry ${selected===x.id?'active':''}"><strong>${safe(x.supplier||x.filename)}</strong><small>${safe(x.document_date||'Ohne Datum')} · ${money(x.counted_amount)} ${x.status==='Storniert'?'Originalbetrag':'neu abgerechnet'} · ${safe(x.category)} · ${safe(assignmentLabel(x))}</small>${x.labor_amount!==null?`<small class="receipt-labor-preview">Arbeits-/Lohnkosten brutto: <strong>${money(x.labor_amount)}</strong></small>`:''}</button></article>`).join('')||(filtered?'<p>Keine Belege entsprechen der Suche oder dem Filter.</p>':'<p>Du hast noch keine Belege erfasst.</p>');
 $('list').querySelectorAll('.entry').forEach(b=>b.onclick=()=>open(Number(b.dataset.id)));
 renderLaborSummary();
}
$('receiptSearch').addEventListener('input',event=>{
 receiptSearchText=normalizedSearch(event.currentTarget.value);
 renderReceiptList();
});
$('receiptLaborFilter').addEventListener('change',event=>{receiptLaborFilter=event.currentTarget.value;renderReceiptList();});
$('receiptYearFilter').addEventListener('change',event=>{receiptYearFilter=event.currentTarget.value;renderReceiptList();});
$('receiptLaborExport').addEventListener('click',event=>{if(event.currentTarget.getAttribute('aria-disabled')==='true')event.preventDefault();});
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
 const till=$('review').elements.namedItem('kind').value==='Kassenzettel';
 const existingOwnWork=currentReceipt?.assignment_type==='Eigenleistung';
 const ownWork=$('receiptAssignmentType').querySelector('option[value="Eigenleistung"]');
 if(ownWork)ownWork.hidden=!till;
 $('receiptAssignmentType').required=!till;
 $('receiptAssignmentType').options[0].textContent=till?'Nur Kostenkategorie / noch offen':'Bitte auswählen';
 const legacy=$('receiptAssignmentType').querySelector('option[value="Kostenposition"]');
 if(legacy)legacy.hidden=true;
 if($('receiptSupplierCompanyWrap')){
  $('receiptSupplierCompanyWrap').hidden=mode!=='Betrieb'&&!till;
  $('receiptTradeWrap').hidden=mode!=='Betrieb'&&!till&&!(existingOwnWork&&mode==='Eigenleistung');
  $('receiptSupplierWrap').hidden=!till;
  $('receiptCategoryWrap').hidden=!till;
  $('receiptBudgetWrap').hidden=!till;
 }
 $('receiptSupplierCompany').required=!till&&mode==='Betrieb';
 $('costItems').required=!till&&mode==='Angebot';
 $('review').elements.namedItem('supplier').required=till;
 $('receiptSupplierCompany').options[0].textContent=till?'Lieferant manuell eingeben':'Firma auswählen';
 const frozen=false;
 $('receiptOfferWrap').hidden=mode!=='Angebot'&&mode!=='Kostenposition';
 $('receiptSelfWorkWrap').hidden=mode!=='Eigenleistung';
 $('receiptSelfWork').disabled=mode!=='Eigenleistung';
 $('receiptContractorWrap').hidden=true;
 $('receiptContractorHint').hidden=mode!=='Betrieb';
 $('costItems').disabled=frozen||(mode!=='Angebot'&&mode!=='Kostenposition');
 $('receiptContractor').disabled=frozen||mode!=='Betrieb';
 $('receiptSupplierCompany').disabled=mode==='Angebot';
 if(mode!=='Angebot')$('receiptSupplierCompany').value=till&&mode==='Eigenleistung'
   ? (overview?.contractors||[]).find(company=>normalizedSearch(company.name)===normalizedSearch($('review').elements.namedItem('supplier').value))?.id||''
   : $('receiptContractor').value;
 $('receiptAssignmentType').disabled=frozen;
 const cost=overview?.items?.find(x=>x.id===Number($('costItems').value));
 const offer=(overview?.offers||[]).find(o=>o.id===cost?.offer_id);
 const isAccepted=mode==='Angebot'&&!!(offer&&['Angenommen','Beauftragt'].includes(offer.status));
 if(isAccepted&&!frozen){
   $('receiptSupplierCompany').value=offer.contractor_id||'';
   $('review').elements.namedItem('supplier').value=(overview?.contractors||[]).find(c=>c.id===offer.contractor_id)?.name||offer.vendor;
   $('budgetLines').value=cost.budget_line_id||'';
   $('categories').value=cost.category;
   if(!currentReceipt?.trade)$('receiptTrade').value=(overview?.contractors||[]).find(c=>c.id===offer.contractor_id)?.trade||'';
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
   : mode==='Eigenleistung'?'Wähle das zugehörige Vorhaben. Gebuchte Belege zählen dort als Ist-Kosten; Entwürfe und stornierte Belege bleiben als Unterlagen sichtbar.'
   : mode==='Kostenposition'?'Historische Kostenpositionszuordnung. Für Änderungen kann ein regulärer Zuordnungstyp ausgewählt werden.'
   : 'Firma und Kostenkategorie lassen sich unabhängig zuordnen. Bei einem Angebot wird die Firma automatisch übernommen.';
}
$('receiptAssignmentType').addEventListener('change',()=>{
  if($('receiptAssignmentType').value!=='Eigenleistung')$('receiptSelfWork').value='';
  if($('receiptAssignmentType').value!=='Angebot'&&$('receiptAssignmentType').value!=='Kostenposition'){
    if($('costItems').value)$('budgetLines').value='';
    $('costItems').value='';$('advanceDeduction').value='0';
  }
  if($('receiptAssignmentType').value!=='Betrieb')$('receiptContractor').value='';
  updateInvoiceControls();
});
$('receiptSupplierCompany').addEventListener('change',()=>{
 const company=(overview?.contractors||[]).find(c=>String(c.id)===$('receiptSupplierCompany').value);
 const ownPurchase=$('review').elements.namedItem('kind').value==='Kassenzettel'&&$('receiptAssignmentType').value==='Eigenleistung';
 if(ownPurchase){
   $('receiptContractor').value='';
   if(company)$('review').elements.namedItem('supplier').value=company.name;
   updateInvoiceControls();return;
 }
 $('receiptContractor').value=company?String(company.id):'';
 if(company){$('review').elements.namedItem('supplier').value=company.name;$('receiptAssignmentType').value='Betrieb';}
 else if($('review').elements.namedItem('kind').value!=='Kassenzettel')$('review').elements.namedItem('supplier').value='';
 $('receiptTrade').value=company?.trade||'';
 updateInvoiceControls();
});
$('review').elements.namedItem('supplier').addEventListener('input',event=>{
 const company=(overview?.contractors||[]).find(c=>String(c.id)===$('receiptSupplierCompany').value);
 if(company&&normalizedSearch(event.target.value)!==normalizedSearch(company.name)&&$('receiptAssignmentType').value!=='Angebot'){
  $('receiptSupplierCompany').value='';$('receiptContractor').value='';
  if($('receiptAssignmentType').value==='Betrieb')$('receiptAssignmentType').value='';
  updateInvoiceControls();
 }
});
$('costItems').addEventListener('change',()=>{
 const item=overview?.items?.find(x=>x.id===Number($('costItems').value));
 const offer=overview?.offers?.find(x=>x.id===item?.offer_id);
 $('receiptTrade').value=overview?.contractors?.find(x=>x.id===offer?.contractor_id)?.trade||'';
 updateInvoiceControls();
});
$('receiptSelfWork').addEventListener('change',()=>{if($('receiptSelfWork').value)$('budgetLines').value='';updateInvoiceControls();});
$('billingType').addEventListener('change',()=>{if($('billingType').value!=='Schlussrechnung')$('advanceDeduction').value='0';updateInvoiceControls();});
$('review').elements.namedItem('kind').addEventListener('change',event=>{
 const till=event.currentTarget.value==='Kassenzettel';
 if(till){
  $('billingType').value='Normal';$('advanceDeduction').value='0';
  $('review').elements.namedItem('due_date').value='';
  if(!$('receiptAssignmentType').value){
   $('receiptAssignmentType').value='Eigenleistung';
   if([...$('categories').options].some(option=>option.value==='Eigenleistungen / Material'))$('categories').value='Eigenleistungen / Material';
  }
 }else if($('receiptAssignmentType').value==='Eigenleistung'&&(currentReceipt?.kind==='Kassenzettel'||currentReceipt?.assignment_type!=='Eigenleistung')){
  $('receiptAssignmentType').value='';$('receiptSelfWork').value='';
 }
 applyTillMode(till);
 updateInvoiceControls();
 if(till&&currentReceipt?.status==='Entwurf')void loadTillFinancing(currentReceipt);
});
$('receiptAnalysisMode').addEventListener('change',()=>{
 const ai=$('receiptAnalysisMode').value==='ai';
 $('receiptAIHint').hidden=!ai;
 $('receiptUploadButton').textContent=ai?'Mit ChatGPT analysieren':'Datei lokal analysieren';
});
function updateReceiptUploadMode(){
 const draft=$('receiptProcessingMode')?.value==='draft';
 $('receiptAnalysisMode').disabled=draft;
 $('receiptAIHint').hidden=draft||$('receiptAnalysisMode').value!=='ai';
 $('receiptUploadButton').textContent=draft?'Als Entwurf speichern':'Dateien analysieren';
}
$('receiptProcessingMode')?.addEventListener('change',updateReceiptUploadMode);
$('receiptAnalysisMode').addEventListener('change',updateReceiptUploadMode);

async function api(path,opts={}){const res=await fetch(path,opts);let data=await res.json();if(!res.ok){const error=new Error(data.error||'Anfrage fehlgeschlagen');error.status=res.status;error.code=data.code;throw error;}return data}
function notice(msg,err=false){for(const id of ['message','receiptSaveStatus']){$(id).textContent=msg;$(id).classList.toggle('error',err)}}
function inputs({booking=false}={}){
 PHBUI.currency.normalizeForm($('review'));
  const result=Object.fromEntries(new FormData($('review')));
  // The backend records till payment and funding together when booking.
  delete result.paid_amount;
 result.kind=$('review').elements.namedItem('kind').value;
 delete result.till_financing_choice;
 if(booking&&result.kind==='Kassenzettel'){
   if(tillFinanceSelect.disabled)throw Error('Bitte die Finanzierungsquellen zuerst laden.');
   const [source,ident]=tillFinanceSelect.value.split(':');
   result.till_financing={source,...(source==='equity'?{equity_id:Number(ident)}:source==='loan'?{loan_id:Number(ident)}:{})};
 }

 const mode=$('receiptAssignmentType').value;
 if(booking&&result.kind!=='Kassenzettel'&&!mode)throw Error('Bitte zuerst ein Angebot oder einen Betrieb zuordnen.');
 if(booking&&mode==='Angebot'&&!$('costItems').value)throw Error('Bitte ein angenommenes Angebot auswählen.');
 if(booking&&mode==='Betrieb'&&!$('receiptContractor').value)throw Error('Bitte einen Betrieb auswählen.');
 result.assignment_type=mode;
 result.self_work_id=mode==='Eigenleistung'?$('receiptSelfWork').value||null:null;
 result.cost_item_id=(mode==='Angebot'||mode==='Kostenposition')?$('costItems').value:null;
 result.contractor_id=mode==='Betrieb'?$('receiptContractor').value:null;
 result.advance_deduction=$('billingType').value==='Schlussrechnung'?$('advanceDeduction').value:'0';
 result.reviewed=booking;
 return result;
}
function fillSelect(node,values,getTitle){node.innerHTML='<option value="">Keine Zuordnung</option>'+values.map(x=>`<option value="${x.id}">${safe(getTitle(x))}</option>`).join('')}
window.PHBPageRefresh=()=>reload(selected,receiptDialog.open);
window.PHBPageActivate=()=>activateReceiptNavigation().catch(e=>notice(e.message,true));
async function reload(keepId=selected,reopen=true){
 const version=receiptNavigationVersion;
 const linkedReceipt=Number(new URLSearchParams(location.search).get('receipt_id'))||null;
 const [r,c]=await Promise.all([api('/api/receipts'),api('/api/costs')]);overview=c;list=r.receipts;
 $('receiptTrade').innerHTML='<option value="">Ohne Gewerk</option>'+(r.trades||[]).map(name=>`<option value="${safe(name)}">${safe(name)}</option>`).join('');
 $('stats').innerHTML=`<span>Entwürfe: <b>${r.drafts}</b></span><span>Gebucht brutto: <b>${money(r.booked_gross)}</b></span><span>Bezahlt: <b>${money(r.paid)}</b></span><span>Lohnanteil erfasst: <b>${list.filter(x=>x.labor_amount!==null).length} Belege</b></span>`;
 $('categories').innerHTML=r.categories.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');
 fillSelect($('receiptSelfWork'),r.self_work_plans||[],x=>x.title);
 fillSelect($('budgetLines'),c.budget_lines.filter(x=>x.active&&!x.is_group),x=>x.category+' · '+x.title);
 renderCostItems();
 renderReceiptFilters();
 if(version===receiptNavigationVersion&&keepId&&list.some(x=>x.id===keepId))selected=keepId;
 renderReceiptList();
 if(version!==receiptNavigationVersion)return;
 if(reopen&&keepId&&list.some(x=>x.id===keepId))await open(keepId);
 else if(reopen&&linkedReceipt&&list.some(x=>x.id===linkedReceipt))await open(linkedReceipt);
 else if(!list.length){$('review').hidden=true;$('placeholder').hidden=false;showReceiptPreview(null);}
 if(linkOffer&&!selected){$('uploadStatus').textContent='Angebot ausgewählt: Lade die Rechnung hoch und prüfe danach die Verknüpfung im Entwurf.';}
}
async function open(id){
 const version=++receiptNavigationVersion;
 try{let x=await api('/api/receipts/'+id);if(version!==receiptNavigationVersion)return;selected=id;currentReceipt=x;assignmentEditing=false;document.querySelectorAll('.entry').forEach(b=>b.classList.toggle('active',Number(b.dataset.id)===id));
 $('review').elements.namedItem('kind').value=x.kind||'Rechnung';
 if(x.kind==='Kassenzettel'&&x.status==='Entwurf')await loadTillFinancing(x);
 if(selected!==id||version!==receiptNavigationVersion)return;
 $('review').hidden=false;$('placeholder').hidden=true;$('editorTitle').textContent=x.filename;
 $('receiptReviewLayout').hidden=false;
 $('receiptReviewStage').hidden=true;
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
 $('receiptReviewStage').hidden=true;
 for(let node of $('review').querySelectorAll('input,select,textarea'))node.disabled=false;
 $('review').elements.namedItem('paid_amount').disabled=true;
 $('receiptTaxRate').disabled=false;
 $('receiptTaxHint').textContent='Wenn du den Bruttobetrag bearbeitest, werden Netto und USt mit dem gewählten Satz automatisch berechnet. Bei gemischten Steuersätzen „manuell“ auswählen. Originalbeleg prüfen.';
 if(linkedCostItem&&x.status==='Entwurf'&&!x.cost_item_id&&!x.assignment_type){
   $('receiptAssignmentType').value='Angebot';
   $('costItems').value=String(linkedCostItem);
 }
 updateInvoiceControls();
 applyTillMode(x.kind==='Kassenzettel');
 if(x.kind==='Kassenzettel'&&x.status==='Entwurf'&&!tillFinanceSelect.disabled)tillFinanceHelp();
 const address=new URL(location.href);address.searchParams.set('receipt_id',String(id));history.replaceState(null,'',address);window.PHBEmbed?.syncURL();
 $('raw').textContent=x.ocr_text||'Keine Textdaten erkannt. Manuelle Eingabe erforderlich.';
 receiptFlow.snapshot(); // Automatically filled invoice fields form the clean baseline.
 const returned=new URLSearchParams(location.search).get('new_company_id');
 if(returned && !x.supplier && !x.contractor_id && [...$('receiptSupplierCompany').options].some(option=>option.value===returned)){
  $('receiptSupplierCompany').value=returned;$('receiptSupplierCompany').dispatchEvent(new Event('change',{bubbles:true}));
  notice('Neue Firma als Lieferant vorgeschlagen. Bitte die Zuordnung prüfen und anschließend speichern.');
 }

 $('rawDetails').hidden=!x.ocr_text; $('warnings').textContent=(x.warnings||[]).join(' · ');notice('');
 if(version===receiptNavigationVersion&&new URLSearchParams(location.search).get('financing')==='1')await showReceiptPayments();
 }catch(e){notice(e.message,true)}
}

function setAssignmentEditing(enabled){
 assignmentEditing=enabled;
 $('editReceiptAssignment').hidden=enabled;
 $('saveReceiptAssignment').hidden=!enabled;
 $('cancelReceiptAssignment').hidden=!enabled;
 for(const id of ['receiptAssignmentType','costItems','receiptContractor','budgetLines','receiptSelfWork'])$(id).disabled=!enabled;
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
   self_work_id:mode==='Eigenleistung'?$('receiptSelfWork').value||null:null,
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
 const select=$('receiptPaymentAccount'),previous=select.value;
 select.innerHTML=accounts.map(a=>'<option value="'+a.id+'">'+safe(a.name)+' · bestätigt verfügbar '+money(available(a))+(available(a)>0.005?'':' · derzeit keine freien Mittel')+'</option>').join('');
 const selected=accounts.find(a=>String(a.id)===previous)||accounts.find(a=>available(a)>0.005)||accounts[0];
 if(selected)select.value=String(selected.id);
 const limit=assigningPayment?assignmentLimit():Number(receipt?.open||0);
 const maximum=deferred?limit:Math.min(limit,available(selected||{}));
 $('receiptPaymentAmount').value=maximum>0?PHBUI.currency.format(maximum):'';
 $('submitReceiptPayment').disabled=!receipt||maximum<=0||(assigningPayment&&deferred);
 $('submitReceiptPayment').textContent=assigningPayment?'Bestehende Zahlung zuordnen':'Zahlung verbindlich verbuchen';
 $('receiptPaymentMessage').textContent=deferred?'Die Rechnung wird bezahlt markiert. Die Finanzierungsquelle kannst du später zuordnen.':
  !accounts.length?(source==='loan'?'Noch kein Kredit angelegt. Unter Finanzierung kannst du einen Kredit erfassen.':'Noch kein Eigenkapitalkonto angelegt.'):
  maximum>0?(assigningPayment?'Nur die Finanzierungsquelle wird ergänzt; der bezahlte Betrag bleibt unverändert.':''):
  source==='loan'?'Der Kredit ist auswählbar. Eine Zahlung daraus ist möglich, sobald ein Mittelabruf von der Bank bestätigt wurde.':'Das Konto ist auswählbar, hat aber derzeit keine frei verfügbaren Mittel.';
}
async function showReceiptPayments(){
 if(!selected||list.find(r=>r.id===selected)?.status!=='Gebucht')return;
 const version=receiptNavigationVersion,receiptId=selected;
 const finance=await api('/api/financing');
 if(version!==receiptNavigationVersion||selected!==receiptId)return;
 paymentState=finance;assigningPayment=null;
 const receipt=currentPaymentReceipt();if(!receipt)throw Error('Gebuchte Rechnung nicht gefunden.');
 const allocations=paymentState.payments.filter(p=>p.receipt_id===selected);
 const legacy=Math.max(0,Number(receipt.paid)-allocations.reduce((sum,p)=>sum+Number(p.amount),0));
 $('receiptPaymentsPanel').hidden=false;receiptFlow.stage(2);$('receiptReviewLayout').hidden=true;$('receiptReviewStage').hidden=true;
 $('receiptPaymentTitle').textContent='Zahlung / Finanzierung verwalten';
 const unassigned=legacy+allocations.filter(p=>p.source==='unassigned').reduce((sum,p)=>sum+Number(p.amount),0);
 $('receiptPaymentTotals').innerHTML='<span>Rechnungsbetrag: <b>'+money(receipt.gross)+'</b></span><span>Bereits bezahlt: <b>'+money(receipt.paid)+'</b></span><span>Noch offen: <b>'+money(receipt.open)+'</b></span><span>Nicht zugewiesen: <b>'+money(unassigned)+'</b></span>';
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
$('closeReceiptPayment').onclick=()=>{if(paymentBusy)return;$('receiptPaymentsPanel').hidden=true;receiptFlow.stage(1);$('receiptReviewLayout').hidden=false;$('receiptReviewStage').hidden=true;};
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
 $('receiptPaymentMessage').textContent=maximum>0
  ?(assigningPayment?'Nur die Finanzierungsquelle wird ergänzt; der bezahlte Betrag bleibt unverändert.':'')
  :source==='loan'?'Für diesen Kredit sind noch keine bestätigten, freien Mittel verfügbar.':'Auf diesem Eigenkapitalkonto sind keine freien Mittel verfügbar.';
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
 const draft=$('receiptProcessingMode')?.value==='draft';
 const ai=!draft&&$('receiptAnalysisMode').value==='ai';
 const button=$('receiptUploadButton');
 uploading=true;button.disabled=true;
 $('uploadStatus').textContent='Dateien werden für die Analyse hochgeladen …';
 try{
   let model='';
   if(ai)model=window.PHBAI?.selection()?.model||'';
   const result=await window.PHBImports.run({
     form:$('upload'),kind:'receipts',files:$('upload').elements.namedItem('files').files,
     analysisMode:draft?'none':ai?'ai':'local',model,...(draft?{processingMode:'background'}:{}),fields:{...(linkSelfWork?{self_work_id:linkSelfWork}:{}),...(uploadReceiptKind==='Kassenzettel'?{receipt_kind:'Kassenzettel'}:{})}
   });
   $('upload').reset();
   updateReceiptUploadMode();
   $('receiptAIHint').hidden=true;
   button.textContent='Dateien analysieren';
   receiptFlow.finish();
   if(result.background)notice(draft?'Die Belege werden ohne Analyse als Entwürfe abgelegt. Du findest sie in der Belegübersicht und der Warteschlange.':'Die Verarbeitung läuft in der Warteschlange weiter.');else window.PHBImports.review(result.jobs);
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
 }),$('saveReceiptDraft'),'Entwurf gespeichert.');
 if(saved){const target='/stammdaten?receipt_id='+id+'&new_company=1#firmen';if(window.PHBEmbed)window.parent.PHBReactBridge.navigate(target);else location.assign(target);}
};
$('book').onclick=async()=>{
 if(!selected||receiptBusy)return;
 if(!$('review').reportValidity())return;
 let fields;try{fields=inputs({booking:true});}catch(error){notice(error.message,true);return;}
 // A cancelled confirmation must never mutate the draft.
 const till=fields.kind==='Kassenzettel';
 const sourceLabel=tillFinanceSelect.selectedOptions[0]?.textContent||'Nicht zugewiesen';
 if(!await PHBUI.confirm(till?'Kassenzettel verbindlich buchen und '+money(fields.gross_amount)+' als beim Einkauf bezahlt erfassen? Finanzierungsquelle: '+sourceLabel+'.':'Rechnungsdaten speichern und den Beleg verbindlich buchen? Unbezahlte Rechnungen bleiben offen.'))return;
 await receiptAction(async()=>{
  try{
   await api('/api/receipts/'+selected+(till?'/book-till':''),{
    method:till?'POST':'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...fields,book_now:true})
   });
  }catch(error){
   if(till&&error.code==='http_404')throw Error('Der laufende App-Server unterstützt die gemeinsame Kassenzettel- und Finanzierungsbuchung noch nicht. Bitte die App neu starten und erneut buchen. Es wurde nichts gebucht.');
   throw error;
  }
 },$('book'),till?'Kassenzettel gebucht und als bezahlt erfasst · '+sourceLabel+'.':'Rechnung gebucht. Zahlungen kannst du anschließend separat erfassen.');
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

reload().then(activateReceiptNavigation).catch(e=>notice(e.message,true));

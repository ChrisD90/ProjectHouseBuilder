/* Field help stays beside its input, in the top layer above the receipt dialog. */
(()=>{
 'use strict';
 const dialog=document.getElementById('receiptWorkflowDialog');
 if(!dialog)return;
 let sequence=0;
 const entries=new Map();
 function hint(source,anchor,title){
  if(!source||!anchor||source.dataset.receiptHint)return;
  source.dataset.receiptHint='true';
  if(entries.has(anchor)){entries.get(anchor).append(source);return;}
  let caption=anchor;
  if(anchor.matches('input,select,textarea')){
   const label=anchor.closest('label');if(!label)return;
   caption=label.querySelector('.receipt-field-caption');
   if(!caption){
    caption=document.createElement('span');caption.className='receipt-field-caption';
    const text=[...label.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim());
    if(text){caption.textContent=text.textContent.trim();text.replaceWith(caption);}else label.prepend(caption);
   }
   if(!anchor.hasAttribute('aria-label'))anchor.setAttribute('aria-label',caption.firstChild?.textContent?.trim()||title);
  }
  const button=document.createElement('button');button.type='button';button.className='receipt-info';
  button.setAttribute('aria-label','Hinweis: '+title);button.setAttribute('aria-expanded','false');
  button.innerHTML='<span aria-hidden="true">i</span>';
  const bubble=document.createElement('div');bubble.id='receipt-hint-'+(++sequence);
  bubble.className='receipt-info-bubble';bubble.setAttribute('popover','auto');bubble.setAttribute('role','note');
  bubble.setAttribute('aria-label',title);button.setAttribute('aria-controls',bubble.id);
  bubble.append(source);dialog.append(bubble);caption.append(button);
  entries.set(anchor,bubble);
  function position(){
   const rect=button.getBoundingClientRect(),box=bubble.getBoundingClientRect();
   const left=Math.max(10,Math.min(rect.left-12,innerWidth-box.width-10));
   const below=rect.bottom+10+box.height<=innerHeight-10;
   bubble.style.left=left+'px';
   bubble.style.top=Math.max(10,below?rect.bottom+10:rect.top-box.height-10)+'px';
   bubble.dataset.placement=below?'below':'above';
   bubble.style.setProperty('--receipt-info-arrow',Math.max(14,Math.min(rect.left+rect.width/2-left,box.width-18))+'px');
  }
  button.onclick=event=>{
   event.preventDefault();event.stopPropagation();
   if(bubble.matches(':popover-open'))bubble.hidePopover();else{bubble.showPopover();position();}
  };
  bubble.addEventListener('toggle',()=>{
   const open=bubble.matches(':popover-open');button.setAttribute('aria-expanded',String(open));
   if(open)position();
  });
  window.addEventListener('resize',()=>{if(bubble.matches(':popover-open'))position();});
  dialog.addEventListener('scroll',()=>{if(bubble.matches(':popover-open'))position();},true);
  dialog.addEventListener('close',()=>{if(bubble.matches(':popover-open'))bubble.hidePopover();});
 }
 const byID=id=>document.getElementById(id);
 const field=name=>dialog.querySelector('[name="'+name+'"]');
 const mapping=[
  ['receiptAIHint',byID('receiptAnalysisMode'),'Analyseart'],
  ['receiptLocalHint',byID('receiptAnalysisMode'),'Lokale Analyse'],
  ['receiptProcessingHint',byID('receiptProcessingMode'),'Verarbeitung'],
  ['receiptReviewHelp',field('kind'),'Prüfen und buchen'],
  ['billingTypeHint',byID('billingType'),'Abrechnungsart'],
  ['deductionHint',byID('advanceDeduction'),'Verrechnete Abschläge'],
  ['receiptTaxHint',byID('receiptTaxRate'),'Umsatzsteuer berechnen'],
  ['receiptLaborHint',byID('receiptLabor'),'Lohnkosten erfassen'],
  ['receiptLaborTaxHint',byID('receiptLabor'),'Lohnkosten für die Steuer'],
  ['billableHint',byID('receiptAssignmentType'),'Zuordnung und Abrechnung'],
  ['receiptContractorHint',byID('receiptSupplierCompany'),'Firma anlegen'],
  ['receiptBookingHint',field('kind'),'Buchung und Zahlung'],
 ];
 for(const [id,anchor,title] of mapping)hint(byID(id),anchor,title);
 for(const [selector,anchor,title] of [
  ['#receiptSupplierCompany ~ small',byID('receiptSupplierCompany'),'Firma aus Stammdaten'],
  ['[name="supplier"] ~ small',field('supplier'),'Lieferant oder Händler'],
  ['[name="due_date"] ~ small',field('due_date'),'Optionales Zahlungsziel'],
  ['.receipt-assignment > .note',byID('receiptAssignmentType'),'Fachliche Zuordnung'],
  ['.receipt-labor-heading p',byID('receiptLabor'),'Lohnanteil und Rechnungssumme'],
  ['.receipt-till-info',byID('tillFinancingSource'),'Kassenzettel bezahlen'],
  ['.receipt-till-financing small',byID('tillFinancingSource'),'Verfügbare Finanzierung'],
  ['#receiptPaymentsPanel .receipt-stage-label p',byID('receiptPaymentSource'),'Zahlungen erfassen'],
  ['.receipt-payment-heading p',byID('receiptPaymentSource'),'Finanzierung zuordnen'],
  ['#receiptPaymentsPanel > .note',byID('receiptPaymentAccount'),'Kreditmittel und Kosten'],
 ])hint(dialog.querySelector(selector),anchor,title);
})();

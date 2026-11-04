/* Shared visual contracts, project-local view state and non-mutating change previews. */
(()=>{
 const contracts=[['.offer-card-head,.receipt-entry-heading,.docs-card-head','phb-card-heading'],
  ['.actions,.offer-form-actions,.phb-dialog-actions','phb-action-bar'],
  ['.linked-work-button','phb-source-button'],['aside.phb-inline-pdf,.offer-inline-pdf','phb-document-preview']];
 const fields=new Set(['receiptSearch','receiptLaborFilter','receiptYearFilter','filter','phase','workType','scale','offerSearch','documentSearch']);
 const applied=new WeakSet();
 const prefix=()=>`phb-view:${window.PHBProject?.id||1}:${location.pathname}:`;
 function decorate(){
  for(const [selector,cls] of contracts)for(const node of document.querySelectorAll(selector))node.classList.add(cls);
  for(const node of document.querySelectorAll('input[id],select[id]')){
   if(!fields.has(node.id)||applied.has(node))continue;
   let saved;try{saved=JSON.parse(localStorage.getItem(prefix()+node.id));}catch{}
   if(saved!==null&&saved!==undefined&&node.tagName==='SELECT'&&![...node.options].some(option=>option.value===saved))continue;
   applied.add(node);
   const keep=()=>{try{localStorage.setItem(prefix()+node.id,JSON.stringify(node.value));}catch{}};
   node.addEventListener('input',keep);node.addEventListener('change',keep);
   if(saved!==null&&saved!==undefined){node.value=saved;node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));}
  }
 }
 const start=()=>{decorate();new MutationObserver(decorate).observe(document.body,{childList:true,subtree:true});};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 const monetary=new Set(['gross','net','vat','gross_amount','net_amount','vat_amount','paid_amount','estimate','offer','committed','principal','amount','opening_balance','agreed_gross','contractor_id','budget_line_id','cost_item_id','assignment_type']);
 const previews=new WeakMap();
 function snapshot(form){
  if(!form)return;
  previews.set(form,window.PHBFlow?.signature(form));
  form.querySelector('.phb-change-impact')?.remove();
 }
 function changed(event){
  const form=event.target.closest?.('form');if(!form||form.dataset.changePreview==='off'||!previews.has(form))return;
  let before,current;
  try{before=new Map(JSON.parse(previews.get(form)));current=JSON.parse(window.PHBFlow.signature(form));}catch{return;}
  const changes=current.filter(([key,value])=>monetary.has(key)&&before.has(key)&&JSON.stringify(before.get(key))!==JSON.stringify(value));
  form.querySelector('.phb-change-impact')?.remove();if(!changes.length)return;
  const preview=document.createElement('details');preview.className='phb-change-impact';
  const title=document.createElement('summary');title.textContent=changes.length+' Änderungen prüfen';preview.append(title);
  const hint=document.createElement('p');hint.textContent='Diese Änderungen werden erst beim Speichern übernommen. Bestehende Buchungen und Zuordnungen werden dabei geprüft.';preview.append(hint);
  const list=document.createElement('ul');for(const [key,value] of changes){const item=document.createElement('li');const field=[...form.elements].find(node=>node.name===key);const caption=field?.labels?.[0]?.cloneNode(true);caption?.querySelectorAll('input,select,textarea,small').forEach(node=>node.remove());const label=caption?.textContent?.trim()||key;const show=value=>field?.tagName==='SELECT'?([...field.options].find(option=>option.value===String(value))?.textContent||'Nicht zugeordnet'):String(value??'leer');item.textContent=label+': '+show(before.get(key))+' → '+show(value);list.append(item);}preview.append(list);
  const actions=form.querySelector('.actions,.phb-action-bar');if(actions)actions.before(preview);else form.append(preview);
 }
 document.addEventListener('input',changed);document.addEventListener('change',changed);
 window.PHBComponents={snapshot,decorate};
})();

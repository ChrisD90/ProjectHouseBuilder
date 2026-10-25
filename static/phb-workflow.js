/* Shared workflow contract: dialogs, dirty forms, async locks and progress.
   Page modules own business validation/API effects; this module owns interaction. */
(() => {
 'use strict';
 const registry=new Map();
 const $=id=>typeof id==='string'?document.getElementById(id):id;
 const feedback=(message)=>window.PHBUI?.alert?.(message);

 function signature(form){
  if(!form)return '';
  const data=[];
  for(const field of form.querySelectorAll('input,select,textarea')){
   if(!field.name||field.dataset.phbIgnoreDirty==='true')continue;
   if(field.type==='checkbox'||field.type==='radio'){
    data.push([field.name,field.value,field.checked]);
   }else if(field.type==='file'){
    data.push([field.name,[...(field.files||[])].map(f=>[f.name,f.size,f.lastModified])]);
   }else if(field.tagName==='SELECT'&&field.multiple){
    data.push([field.name,[...field.selectedOptions].map(o=>o.value)]);
   }else{
    const euro=field.dataset.euro==='true'||field.dataset.phbCurrency==='true'
      ||new Set(['amount','gross','net','vat','gross_amount','net_amount','vat_amount',
        'unit_price','labor_amount','paid_amount','estimate','offer','committed',
        'principal','monthly_payment','opening_balance','reserve','agreed_gross']).has(field.name);
    const value=euro?window.PHBUI?.currency?.parse?.(field.value):undefined;
    data.push([field.name,euro&&value!==undefined&&Number.isFinite(value)?value:field.value]);
   }
  }
  return JSON.stringify(data);
 }
 function manage(config){
  const dialog=$(config.dialog);
  if(!dialog||!(dialog instanceof HTMLDialogElement)){
   throw Error('PHBFlow: Dialog nicht gefunden: '+config.dialog);
  }
  if(registry.has(dialog.id))return registry.get(dialog.id);
  const forms=(config.forms||[]).map($).filter(Boolean);
  const dismiss=(config.dismiss||[]).map($).filter(Boolean);
  const titles=(config.steps||[]).map(String);
  let baseline='',busy=false,closing=false,stageIndex=0;
  let opener=null;
  const current=()=>JSON.stringify(forms.map(signature));
  const isBusy=()=>busy||Boolean(config.isBusy?.());
  const dirty=()=>Boolean(config.track!==false&&forms.length&&baseline!==current());
  const snapshot=()=>{baseline=current();};
  let steps=null;
  if(titles.length>1){
   steps=document.createElement('nav');
   steps.className='phb-flow-steps';
   steps.setAttribute('aria-label','Bearbeitungsschritte');
   steps.innerHTML=titles.map((name,index)=>
    '<span class="phb-flow-step" data-flow-step="'+index+'"><span class="phb-flow-index">'+(index+1)+
    '</span><span class="phb-flow-step-label"></span></span>').join('');
   steps.querySelectorAll('.phb-flow-step-label').forEach((node,index)=>{node.textContent=titles[index];});
   const header=dialog.querySelector(':scope > :is(.phb-workflow-head,.modal-head,.dialog-head,.docs-dialog-head)');
   if(header)header.after(steps);
   else dialog.prepend(steps);
  }
  function stage(index){
   if(!titles.length)return;
   stageIndex=Math.min(Math.max(Number(index)||0,0),titles.length-1);
   steps?.querySelectorAll('[data-flow-step]').forEach((node,n)=>{
    node.classList.toggle('is-current',n===stageIndex);
    node.classList.toggle('is-complete',n<stageIndex);
    if(n===stageIndex)node.setAttribute('aria-current','step');
    else node.removeAttribute('aria-current');
   });
   dialog.dataset.phbStage=String(stageIndex);
  }
  function setBusy(next){
   busy=Boolean(next);
   dialog.classList.toggle('phb-flow-busy',busy);
   dialog.setAttribute('aria-busy',String(busy));
   // Do not indiscriminately disable form fields: users must be able to copy
   // information and pending form-state must remain intact.
   for(const btn of dismiss)btn.disabled=busy;
  }
  function open({step=0}={}){
   if(!dialog.open){
    opener=document.activeElement;
    dialog.showModal();
   }
   stage(step);
   snapshot();
   return dialog;
  }
  function finish(returnValue=''){
   snapshot();
   if(dialog.open)dialog.close(returnValue);
  }
  async function cancel(){
   if(!dialog.open||closing)return false;
   if(isBusy()){
    if(typeof config.busyMessage==='string'&&config.busyMessage)feedback(config.busyMessage);
    return false;
   }
   closing=true;
   try{
    if(dirty()&&!await window.PHBUI.confirm(
      'Es gibt ungespeicherte Änderungen. Möchtest du sie wirklich verwerfen?'))return false;
    finish('cancel');
    return true;
   }finally{closing=false;}
  }
  async function run(callback,{button=null}={}){
   if(isBusy())return {ok:false};
   const target=$(button);
   setBusy(true);
   if(target)target.disabled=true;
   try{
    const value=await callback();
    snapshot();
    return {ok:true,value};
   }catch(error){
    if(config.onError)config.onError(error);
    else feedback(error.message||String(error));
    return {ok:false,error};
   }finally{
    if(target)target.disabled=false;
    setBusy(false);
   }
  }
  dialog.classList.add('phb-flow-dialog');
  dialog.addEventListener('cancel',event=>{
   event.preventDefault();
   void cancel();
  },true);
  dialog.addEventListener('click',event=>{
   if(event.target!==dialog)return;
   event.preventDefault();
   event.stopImmediatePropagation();
   void cancel();
  },true);
  for(const btn of dismiss)btn.addEventListener('click',event=>{
   event.preventDefault();
   event.stopImmediatePropagation();
   void cancel();
  },true);
  dialog.addEventListener('close',()=>{
   setBusy(false);
   config.onClose?.();
   if(opener instanceof HTMLElement&&opener.isConnected&&!dialog.contains(opener)){
    opener.focus({preventScroll:true});
   }
   opener=null;
  });
  stage(0);
  const controller={dialog,open,finish,cancel,stage,run,setBusy,snapshot,dirty,isBusy};
  registry.set(dialog.id,controller);
  return controller;
 }
 window.addEventListener('beforeunload',event=>{
  if(![...registry.values()].some(flow=>flow.dialog.open&&flow.dirty())){
   return;
  }
  event.preventDefault();
  event.returnValue='';
 });
 window.PHBFlow={manage,get:id=>registry.get($(id)?.id)};
})();

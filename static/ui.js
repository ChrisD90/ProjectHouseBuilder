'use strict';
// Einheitliche, lokale Dialoge und Euro-Eingaben statt Browser-alert/confirm/prompt.
window.AppUI=(()=>{
 const formatEuro=value=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(Number(value)||0);
 function formatAmountInput(input){
   const old=input.value, caret=input.selectionStart??old.length;
   const beforeDigits=(old.slice(0,caret).match(/[0-9]/g)||[]).length;
   const hasComma=old.includes(',');
   let [whole,decimal='']=old.replace(/[^0-9,.]/g,'').replace(/\./g,'').split(',');
   whole=(whole||'').replace(/^0+(?=\d)/,'');
   decimal=decimal.replace(/\D/g,'').slice(0,2);
   const result=whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(hasComma?',':'')+decimal;
   input.value=result;
   if(document.activeElement===input){
     let pos=0,count=0;
     while(pos<result.length && count<beforeDigits){if(/[0-9]/.test(result[pos]))count++;pos++}
     // Der Cursor hinter einem gerade eingegebenen Dezimalkomma bleibt dahinter.
     if(hasComma && caret>old.indexOf(',') && beforeDigits<=whole.length)pos=Math.max(pos,result.indexOf(',')+1);
     input.setSelectionRange(pos,pos);
   }
 }
 function amount(value){
   const s=String(value??'').trim().replace(/\./g,'').replace(',','.');
   if(!/^\d+(?:\.\d{1,2})?$/.test(s))return NaN;
   return Number(s);
 }
 function bindMoney(root=document){
   root.querySelectorAll('input[data-money]').forEach(input=>{
     if(input.dataset.moneyBound)return;
     input.dataset.moneyBound='1';
     input.addEventListener('input',()=>formatAmountInput(input));
     if(input.value!=='')input.value=formatEuro(amount(input.value));
   });
 }
 function box({title,message,ok='OK',cancel,initial}){
   return new Promise(resolve=>{
     const dialog=document.createElement('dialog'); dialog.className='app-messagebox';
     const heading=document.createElement('h3');heading.textContent=title;
     const text=document.createElement('p');text.textContent=message;
     const actions=document.createElement('div');actions.className='app-message-actions';
     dialog.append(heading,text);
     let input,error;
     if(initial!==undefined){
       input=document.createElement('input');input.type='text';input.inputMode='decimal';
       input.dataset.money='true';input.setAttribute('aria-label','Betrag in Euro');
       input.value=formatEuro(initial);input.className='app-money-entry';
       error=document.createElement('small');error.className='app-dialog-error';
       dialog.append(input,error);
     }
     if(cancel){
       const no=document.createElement('button');no.type='button';no.textContent=cancel;
       no.onclick=()=>dialog.close('cancel');actions.append(no);
     }
     const yes=document.createElement('button');yes.type='button';yes.className='primary';yes.textContent=ok;
     yes.onclick=()=>{
       if(input){
         const n=amount(input.value);
         if(!Number.isFinite(n)||n<0){error.textContent='Bitte einen gültigen, nicht-negativen Euro-Betrag eingeben.';input.focus();return}
         dialog._answer=n;
       }else dialog._answer=true;
       dialog.close('ok');
     };
     actions.append(yes);dialog.append(actions);document.body.append(dialog);
     bindMoney(dialog);
     dialog.addEventListener('close',()=>{const result=dialog.returnValue==='ok'?dialog._answer:(input?null:false);dialog.remove();resolve(result)},{once:true});
     dialog.showModal();(input||yes).focus();
   });
 }
 return {
   amount,formatEuro,bindMoney,
   confirm:(message,title='Bitte bestätigen')=>box({title,message,ok:'Bestätigen',cancel:'Abbrechen'}),
   alert:(message,title='Hinweis')=>box({title,message,ok:'OK'}),
   money:(message,initial=0,title='Euro-Betrag')=>box({title,message,ok:'Übernehmen',cancel:'Abbrechen',initial})
 };
})();

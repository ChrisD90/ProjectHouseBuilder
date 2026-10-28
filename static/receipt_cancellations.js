/* One preview and one confirmation reverse booking and payment records together. */
(()=>{
 'use strict';
 const dialog=document.getElementById('receiptCancelDialog'),form=document.getElementById('receiptCancelForm');
 let preview=null,busy=false;
 const flow=PHBFlow.manage({dialog:'receiptCancelDialog',forms:['receiptCancelForm'],dismiss:['closeReceiptCancel'],isBusy:()=>busy});
 document.getElementById('cancelReceipt').onclick=async()=>{
  if(receiptBusy||paymentBusy||!selected)return;
  try{
   preview=await api('/api/receipts/'+selected+'/cancel-preview');
   document.getElementById('receiptCancelSummary').textContent=(preview.supplier||'Rechnung')+' '+(preview.number||'')+
    ': '+money(preview.counted)+' aus dem Rechnungsstand entfernen. Zahlungsvermerke über '+money(preview.paid)+
    ' und '+preview.allocation_count+' Finanzierungszuordnung(en) gemeinsam zurücknehmen. Original und Stornohistorie bleiben erhalten.';
   form.reset();document.getElementById('receiptCancelMessage').textContent='';flow.open();
  }catch(error){notice(error.message,true);}
 };
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!preview)return;
  busy=true;receiptBusy=true;const controls=[...form.querySelectorAll('textarea,button')];controls.forEach(n=>n.disabled=true);
  try{
   await api('/api/receipts/'+preview.receipt_id+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({confirm:true,plan_digest:preview.plan_digest,reason:document.getElementById('receiptCancelReason').value})});
   flow.finish();await reload(selected);notice('Rechnung storniert. Zahlungsvermerke und Finanzierungszuordnungen zurückgenommen. Original bleibt erhalten.');
  }catch(error){document.getElementById('receiptCancelMessage').textContent=error.message;}
  finally{busy=false;receiptBusy=false;controls.forEach(n=>n.disabled=false);}
 };
 document.getElementById('reopenCancelledReceipt').onclick=async()=>{
  if(receiptBusy||paymentBusy||!selected)return;
  const button=document.getElementById('reopenCancelledReceipt');
  try{
   const state=await api('/api/receipts/'+selected+'/cancel-reversal-preview');
   const confirmed=await PHBUI.confirm(
    'Storno zurücknehmen und die Rechnung wieder verbindlich buchen? '+money(state.restore_paid)+
    ' Zahlungsstand und '+state.allocation_count+' Finanzierungszuordnung(en) werden gemeinsam wiederhergestellt.');
   if(!confirmed)return;
   await receiptAction(()=>api('/api/receipts/'+selected+'/cancel-reversal',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({confirm:true,plan_digest:state.plan_digest})
   }),button,'Storno zurückgenommen. Rechnung, Zahlungsvermerke und Finanzierungszuordnungen wurden wiederhergestellt.');
  }catch(error){notice(error.message,true);}
 };
})();

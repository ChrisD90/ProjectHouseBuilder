/* Read-only projection over existing financing records; no inferred fund allocation. */
(function(root){
 'use strict';
 const activeStatuses=['Eingereicht','Ausgezahlt','Bestätigt'];
 function build(state){
  const drawdowns=state.drawdowns||[],events=state.events||[],usages=state.usages||[],payments=state.payments||[];
  const linkedEvents=new Set(drawdowns.map(d=>d.event_id).filter(id=>id!=null));
  const claimedPayments=new Set();
  const rows=drawdowns.map(d=>{
   const applications=['Ausgezahlt','Bestätigt'].includes(d.status)?(d.applications||[]):[];
   for(const application of applications)for(const id of application.payment_ids||[])claimedPayments.add(id);
   return {key:'drawdown:'+d.id,type:'drawdown',loan_id:d.loan_id,date:d.requested_date,data:d,applications};
  });
  const counts=new Map();
  for(const d of drawdowns)if(activeStatuses.includes(d.status))counts.set(d.loan_id,(counts.get(d.loan_id)||0)+1);
  for(const e of events)if(e.kind==='loan_drawdown'&&!linkedEvents.has(e.id)){
   counts.set(e.loan_id,(counts.get(e.loan_id)||0)+1);
   rows.push({key:'event:'+e.id,type:'payout',loan_id:e.loan_id,date:e.event_date,data:e});
  }
  for(const usage of usages){
   if(usage.status==='Aktiv')for(const id of usage.payment_ids||[])claimedPayments.add(id);
   rows.push({key:'usage:'+usage.id,type:'usage',loan_id:usage.loan_id,date:usage.usage_date,data:usage});
  }
  for(const payment of payments)if(payment.source==='loan'&&!claimedPayments.has(payment.id)){
   rows.push({key:'payment:'+payment.id,type:'payment',loan_id:payment.loan_id,date:payment.payment_date,data:payment});
  }
  rows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||b.data.id-a.data.id||a.key.localeCompare(b.key));
  return {rows,counts};
 }
 const api={build,activeStatuses};root.PHBCreditActivity=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);

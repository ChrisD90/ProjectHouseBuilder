const assert=require('node:assert/strict');
const {build}=require('../static/credit_activity.js');
const state={drawdowns:[
 {id:1,loan_id:1,event_id:10,status:'Ausgezahlt',requested_date:'2026-11-01',applications:[{receipt_id:1,amount:40,payment_ids:[30]}]},
 {id:2,loan_id:1,event_id:null,status:'Eingereicht',requested_date:'2026-11-02'},
 {id:3,loan_id:1,event_id:null,status:'Entwurf'},
 {id:4,loan_id:1,event_id:null,status:'Abgelehnt'},
 {id:5,loan_id:2,event_id:12,status:'Bestätigt'},
 {id:6,loan_id:1,event_id:null,status:'Zurückgenommen',applications:[{payment_ids:[99]}]}
 ],events:[{id:10,loan_id:1,kind:'loan_drawdown'},{id:11,loan_id:1,kind:'loan_drawdown',event_date:'2026-11-03'},{id:12,loan_id:2,kind:'loan_drawdown'},{id:13,loan_id:1,kind:'loan_interest'}],
 usages:[{id:1,loan_id:1,status:'Aktiv',payment_ids:[31]},{id:2,loan_id:1,status:'Zurückgenommen',payment_ids:[32]}],
 payments:[{id:30,loan_id:1,source:'loan'},{id:31,loan_id:1,source:'loan'},{id:32,loan_id:1,source:'loan'},{id:33,loan_id:null,source:'equity'}]};
const before=JSON.stringify(state),result=build(state);
assert.equal(result.counts.get(1),3);assert.equal(result.counts.get(2),1);
assert.equal(result.rows.filter(row=>row.type==='payout').length,1);
assert.deepEqual(result.rows.filter(row=>row.type==='payment').map(row=>row.data.id),[32]);
assert.equal(result.rows.find(row=>row.key==='drawdown:1').applications.length,1);
assert.equal(result.rows.find(row=>row.key==='drawdown:6').applications.length,0);
assert.equal(result.rows.filter(row=>row.type==='usage').length,2);
assert.equal(JSON.stringify(state),before,'Projection must not mutate persisted inputs');
assert.equal(build({}).rows.length,0);
console.log('PASS counts include manual payouts, avoid linked event/payment duplicates, preserve legacy/reversed rows and never mutate input.');

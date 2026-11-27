/* Financial scenario integrity: cents, agreed totals, no double counting or writes. */
const assert=require('node:assert/strict');
const {summarize}=require('../static/offer-selection.js');
const offers=[
  {id:1,status:'Angenommen',gross:999,agreed_gross:119.10},
  {id:2,status:'Angebot',gross:200.20},
  {id:3,status:'Beauftragt',gross:10.30},
  {id:4,status:'Abgelehnt',gross:25.40},
  {id:5,status:'Entwurf',gross:1000},
  {id:6,status:'Angebot',gross:null},
];
const snapshot=JSON.stringify(offers);
const result=summarize(offers,[1,2,2,5,987]);
assert.deepEqual(result,{count:2,selected:319.30,accepted:129.40,projected:329.60,missingSelected:0,missingProjected:0});
assert.equal(summarize(offers,[]).projected,129.40);
assert.equal(summarize(offers,[4]).projected,154.80);
assert.equal(summarize(offers,[6]).missingProjected,1);
assert.equal(summarize([{id:9,status:'Angenommen',gross:null}],[]).missingProjected,1);
assert.equal(summarize([{id:1,status:'Angebot',gross:0.1},{id:2,status:'Angebot',gross:0.2}],[1,2]).selected,0.3);
assert.equal(JSON.stringify(offers),snapshot);
console.log('PASS agreed amounts, cents, accepted deduplication, drafts/missing IDs, missing values and no mutations.');

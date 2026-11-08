// Exercise the actual editor calculation without a browser or network access.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('static/offers.js','utf8'),ui=fs.readFileSync('static/ui.js','utf8');
const context=vm.createContext({Intl,Number,Math});
vm.runInContext(ui.slice(ui.indexOf('  function parseMoney('),ui.indexOf('  function moneyEdit('))+'\nthis.PHBUI={currency:{parse:parseMoney,format:formatMoney}};',context);
vm.runInContext(source.slice(source.indexOf('  function offerTaxRate('),source.indexOf("  document.addEventListener('input',event=>{",source.indexOf('  function offerTaxRate('))),context);
const fields=Object.fromEntries(['gross','net','vat'].map(name=>[name,{value:''}])),tax={value:'19'};
const form={elements:{namedItem:name=>fields[name]},dataset:{},querySelector:()=>tax};
fields.gross.value='1.190';context.calculateOfferAmounts(form,'gross');assert.equal(fields.net.value,'1.000');assert.equal(fields.vat.value,'190');
fields.net.value='1000';tax.value='7';context.calculateOfferAmounts(form,'net');assert.equal(fields.gross.value,'1.070');assert.equal(fields.vat.value,'70');
tax.value='0';context.calculateOfferAmounts(form,'net');assert.equal(fields.gross.value,'1.000');assert.equal(fields.vat.value,'0');
tax.value='19';fields.net.value='0,03';context.calculateOfferAmounts(form,'net');assert.equal(fields.gross.value,'0,04');assert.equal(fields.vat.value,'0,01');
tax.value='manual';fields.gross.value='1234';context.calculateOfferAmounts(form,'gross');assert.equal(fields.net.value,'0,03');
tax.value='19';fields.gross.value='';context.calculateOfferAmounts(form,'gross');assert.equal(fields.net.value,'');assert.equal(fields.vat.value,'');
assert.equal(context.offerTaxRate({net:1000,gross:1190}),19);assert.equal(context.offerTaxRate({net:1000,gross:1070}),7);assert.equal(context.offerTaxRate({net:1000,gross:1050}),'manual');assert.equal(context.offerTaxRate({net:1000,gross:1000}),0);
console.log('PASS actual offer amount calculation: gross/net, 19/7/0%, cent rounding, manual mode, clearing and inferred tax.');

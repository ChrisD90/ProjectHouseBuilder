/* Manual completion changes a marker, never receipt payments; six equal KPIs. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1600,height:1050}});
 try{
  const base=process.env.PHB_TEST_URL,errors=[];page.on('pageerror',e=>errors.push(e.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Zahlungsabschluss'}})).json()).project.id,headers={'X-PHB-Project':String(owner)};
  const tour=await(await page.request.get(base+'/api/project-onboarding',{headers})).json();
  assert((await page.request.put(base+'/api/project-onboarding',{headers,data:{action:'skip',token:tour.token}})).ok());
  const created=await page.request.post(base+'/api/offers/manual',{headers,data:{vendor:'Testbetrieb',gross:119,net:100,vat:19,category:'Sonstiges'}});assert(created.ok(),await created.text());const id=(await created.json()).id;
  assert((await page.request.post(base+'/api/offers/'+id+'/accept',{headers,form:{confirm:'true',mode:'offer'}})).ok());
  await page.goto(base+'/p/'+owner+'/angebote');const f=page.frameLocator('iframe[title="Angebote"]'),card=f.locator('[data-offer-card="'+id+'"]');
  await expect(f.locator('#offersOpenTotal')).toContainText('119,00');await expect(f.locator('#offersPaidTotal')).toContainText('0,00');
  const boxes=await f.locator('.offers-stats>div').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,top:n.getBoundingClientRect().top})));
  assert.equal(boxes.length,6);assert(boxes.every(box=>Math.abs(box.width-boxes[0].width)<1&&Math.abs(box.top-boxes[0].top)<1));
  await expect(card.locator('.offer-tile-actions a')).toHaveCount(0);
  await card.getByRole('button',{name:'Angebot als vollständig bezahlt markieren',exact:true}).evaluate(n=>n.click());
  let dialog=f.locator('.phb-messagebox[open]');await expect(dialog).toContainText('Rechnungen und Finanzierungsbuchungen bleiben unverändert');
  await dialog.getByRole('button',{name:'Bestätigen',exact:true}).evaluate(n=>n.click());
  await expect(card.locator('.offer-payment-completed')).toHaveText('Vollständig bezahlt');await expect(f.locator('#offersOpenTotal')).toContainText('0,00');await expect(f.locator('#offersPaidTotal')).toContainText('0,00');
  await page.reload();await expect(card.locator('.offer-payment-completed')).toHaveText('Vollständig bezahlt');
  await card.getByRole('button',{name:'Zahlungsabschluss zurücknehmen',exact:true}).evaluate(n=>n.click());dialog=f.locator('.phb-messagebox[open]');await dialog.getByRole('button',{name:'Bestätigen',exact:true}).evaluate(n=>n.click());
  await expect(f.locator('#offersOpenTotal')).toContainText('119,00');await expect(card.locator('.offer-payment-completed')).toHaveCount(0);
  const result=await(await page.request.get(base+'/api/offers',{headers})).json();assert.equal(result.offers[0].status,'Angenommen');assert.equal(result.offers[0].billing.paid,0);assert.equal(result.offers[0].gross,119);assert.deepEqual(errors,[]);
  console.log('PASS six equal KPIs, removed old actions, explicit completion, reload persistence, undo and unchanged payments/order value.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

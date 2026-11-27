/* One read-only journey: selection, filters, sorting, accepted totals and closing. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1440,height:1050}});
 try {
  const base=process.env.PHB_TEST_URL,errors=[];page.on('pageerror',e=>errors.push(e.message));
  const project=await page.request.post(base+'/api/projects',{data:{title:'Angebotssummen'}}),owner=(await project.json()).project.id,headers={'X-PHB-Project':String(owner)};
  const state=await(await page.request.get(base+'/api/project-onboarding',{headers})).json();
  assert((await page.request.put(base+'/api/project-onboarding',{headers,data:{action:'skip',token:state.token}})).ok());
  async function list(){const r=await page.request.get(base+'/api/offers',{headers});assert(r.ok(),await r.text());return r.json();}
  const categories=(await list()).categories;
  const category=categories.find(c=>c!=='Sonstiges');assert(category);
  const ids=[];
  for(const [vendor,net,group] of [['Fixierter Betrieb',100,'Sonstiges'],['Betrieb A',200,category],['Betrieb B',300,'Sonstiges']]){
   const r=await page.request.post(base+'/api/offers/manual',{headers,data:{vendor,net,vat:19,gross:net*1.19,category:group}});assert(r.ok(),await r.text());const row=await r.json();ids.push(row.id||row.offer.id);
  }
  const accepted=await page.request.post(base+'/api/offers/'+ids[0]+'/accept',{headers,form:{confirm:'true',mode:'offer'}});assert(accepted.ok(),await accepted.text());
  const before=JSON.stringify((await list()).offers);
  await page.goto(base+'/p/'+owner+'/angebote');const frame=page.frameLocator('iframe[title="Angebote"]');
  await expect(frame.locator('#toggleOfferSum')).toBeEnabled();await expect(frame.locator('#offerSelectionSummary')).toBeHidden();
  const writes=[];page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method())&&new URL(r.url()).pathname.includes('/api/offers'))writes.push(r.url());});
  await frame.locator('#toggleOfferSum').evaluate(n=>n.click());
  await frame.locator('[data-offer-sum="'+ids[0]+'"]').evaluate(n=>n.click());await frame.locator('[data-offer-sum="'+ids[1]+'"]').evaluate(n=>n.click());
  const text=locator=>locator.innerText().then(value=>value.replace(/\s+/g,' '));
  assert.match(await text(frame.locator('#offerSelectionTotal')),/2 Angebote · 357,00/);
  assert.match(await text(frame.locator('#offerSelectionProjected')),/357,00/);
  await frame.locator('#offerCategoryFilter').selectOption('Sonstiges');
  assert.match(await text(frame.locator('#offerSelectionTotal')),/2 Angebote · 357,00/);
  await expect(frame.locator('#offerSelectionNote')).toContainText('1 ausgewähltes Angebot außerhalb des Filters');
  await frame.locator('#offerCategoryFilter').selectOption('');await frame.locator('#offerSort').selectOption('amount-desc');
  await expect(frame.locator('[data-offer-sum="'+ids[1]+'"]')).toBeChecked();
  await frame.locator('[data-offer-details="'+ids[2]+'"]').evaluate(n=>n.click());
  assert.match(await text(frame.locator('#offerSelectionTotal')),/3 Angebote · 714,00/);
  assert.match(await text(frame.locator('#offerSelectionProjected')),/714,00/);
  await expect(page).toHaveURL(new RegExp('/angebote$'));
  await frame.locator('#closeOfferSum').evaluate(n=>n.click());await expect(frame.locator('#offerSelectionSummary')).toBeHidden();await expect(frame.locator('[data-offer-sum]')).toHaveCount(0);
  await frame.locator('#toggleOfferSum').evaluate(n=>n.click());assert.match(await text(frame.locator('#offerSelectionTotal')),/0 Angebote · 0,00/);
  assert.equal(JSON.stringify((await list()).offers),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('PASS offer sums, filter retention, sorting, accepted deduplication, close/reset and no offer writes.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let connected=false,requests=0;
  await page.route('**/api/ai/status*',route=>route.fulfill({json:{connected,sharing:connected,credits_acknowledged:connected}}));
  await page.route('**/api/ai/models*',route=>route.fulfill({json:{models:[{slug:'test',name:'Testmodell'}]}}));
  await page.route('**/api/ai/offers/compare*',route=>{requests++;return route.fulfill({json:{analysis:'Vergleich erfolgreich'}});});
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Angebotspanels'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  for(const vendor of ['Firma A','Firma B']){
   const response=await page.request.post(base+'/api/offers/manual',{headers,data:{vendor,gross:100,category:'Elektro'}});
   assert(response.ok(),await response.text());
  }
  await page.goto(base+'/p/'+owner+'/angebote');
  const frame=page.frameLocator('iframe[title="Angebote"]:not([hidden])');
  await expect(frame.locator('.offers-heading')).toContainText('Erst wenn du');
  await expect(frame.locator('.offers-how,.offers-clarity')).toHaveCount(0);
  await expect(frame.locator('#angebotsliste [data-offer-card]')).toHaveCount(2);
  const panel=frame.locator('#ki-angebotsvergleich'),summary=panel.locator(':scope > summary');
  await expect(panel).not.toHaveAttribute('open');
  await summary.click();await expect(panel).toHaveAttribute('open','');
  await expect(frame.locator('#aiCompareConnectionHint')).toBeVisible();
  await frame.locator('#aiOfferChoices input').nth(0).check();await frame.locator('#aiOfferChoices input').nth(1).check();
  await expect(frame.locator('#aiCompareOffers')).toBeDisabled();assert.equal(requests,0);
  const opened=await summary.evaluate(node=>getComputedStyle(node,'::before').transform);
  await summary.focus();await summary.press('Enter');await expect(panel).not.toHaveAttribute('open');
  const closed=await summary.evaluate(node=>getComputedStyle(node,'::before').transform);
  assert.notEqual(opened,closed);
  await summary.press('Enter');await expect(panel).toHaveAttribute('open','');
  connected=true;await page.evaluate(()=>window.PHBReactBridge.ai.refresh());
  await expect(frame.locator('#aiCompareConnectionHint')).toBeHidden();
  await expect(frame.locator('#aiCompareOffers')).toBeEnabled();
  await frame.locator('#aiCompareOffers').click();
  await expect(frame.locator('#aiCompareResult')).toHaveText('Vergleich erfolgreich');assert.equal(requests,1);
  connected=false;await page.evaluate(()=>window.PHBReactBridge.ai.refresh());
  await expect(frame.locator('#aiCompareOffers')).toBeDisabled();
  await expect(frame.locator('#aiCompareConnectionHint')).toBeVisible();
  const rejected=frame.locator('#rejectedOffersSection');
  await expect(rejected).not.toContainText('Nur bei Bedarf anzeigen');
  await rejected.locator(':scope > summary').click();await expect(rejected).toHaveAttribute('open','');
  await page.setViewportSize({width:390,height:844});
  await expect(summary).toBeVisible();
  const fits=await summary.evaluate(node=>node.getBoundingClientRect().right<=innerWidth+1);assert(fits);
  await panel.screenshot({path:'/tmp/phb-offer-comparison.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS compact offer introduction, collapsed comparison, keyboard disclosure arrows, live connection guard and mobile panels.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

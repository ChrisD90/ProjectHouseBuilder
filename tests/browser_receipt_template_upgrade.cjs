/* Existing invoices must load with both current and previously rendered markup. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const seed=await browser.newPage();
  const owner=(await(await seed.request.post(base+'/api/projects',{data:{title:'Belegliste nach Update'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  const uploaded=await seed.request.post(base+'/api/receipts',{headers,multipart:{analysis_mode:'local',file:{name:'Bestandsbeleg.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nBestandsbeleg')}}});
  assert.equal(uploaded.status(),201,await uploaded.text());
  const rid=(await uploaded.json()).id;
  for(const legacy of [false,true]) {
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR: '+e.message);});
    if(legacy)await page.route('**/belege?**',async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:(await response.text()).replace(/<label id="receiptSelfWorkWrap"[^]*?<\/label>/,'')});
    });
    await page.goto(base+'/p/'+owner+'/belege');
    const frame=page.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');
    await expect(frame.locator('.entry[data-id="'+rid+'"]')).toBeVisible();
    await frame.locator('.entry[data-id="'+rid+'"]').click();
    await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible();
    await expect(frame.locator('#receiptSelfWork')).toHaveCount(1);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS existing receipt list and review survive current and older HTML after script updates.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

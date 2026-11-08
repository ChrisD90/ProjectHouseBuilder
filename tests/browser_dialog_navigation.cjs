const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Dialognavigation'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  const path=p=>base+'/p/'+owner+p;
  async function post(url,data){const response=await page.request.post(base+url,{headers,data});assert(response.ok(),await response.text());return response.json();}
  const offer=(await post('/api/offers/manual',{vendor:'Navigation GmbH',gross:100,category:'Elektro'})).offer;
  const plan=(await post('/api/self-work',{title:'Navigation testen'})).plan;
  const task=(await post('/api/tasks',{code:'N1',name:'Dialogtest',trade:'Elektro',duration:1})).id;
  const phase=(await post('/api/phases',{title:'Testphase',start_date:'2026-11-01'})).phase.id;
  const loan=(await post('/api/financing/loans',{name:'Testkredit',principal:1000,interest_rate:3,monthly_payment:10,initial_repayment_rate:2,extra_repayment_pct:0})).id;
  const funding=(await post('/api/funding',{name:'Testförderung',expected:50})).id;
  const upload=await page.request.post(base+'/api/receipts',{headers,multipart:{analysis_mode:'local',file:{name:'navigation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nNavigation')}}});
  assert.equal(upload.status(),201,await upload.text());const rid=(await upload.json()).id;
  await page.goto(path('/belege'));
  const receipts=page.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');
  await receipts.locator('.entry[data-id="'+rid+'"]').click();
  await expect(page).toHaveURL(path('/belege?receipt_id='+rid));
  await receipts.locator('#review [name=notes]').fill('Gespeicherte Firma');
  await receipts.locator('#saveReceiptDraft').click();
  await expect(receipts.locator('#receiptSaveStatus')).toContainText('Entwurf gespeichert.');
  await receipts.locator('#review').evaluate(()=>{window.navigationSentinel='preserve-frame';});
  await receipts.locator('#closeReceiptWorkflow').click();
  await expect(page).toHaveURL(path('/belege'));
  // A response arriving after the close must not reopen its former editor.
  await receipts.locator('.entry[data-id="'+rid+'"]').click();
  let release;const held=new Promise(resolve=>{release=resolve;});
  const receiptListURL=/\/api\/receipts(?:\?.*)?$/;
  await page.route(receiptListURL,async route=>{
   if(route.request().method()==='GET'){await held;await route.continue();}else await route.continue();
  });
  const refreshRequest=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/receipts'&&r.method()==='GET');
  const refreshed=receipts.locator('#review').evaluate(()=>window.PHBPageRefresh());
  await refreshRequest;await receipts.locator('#closeReceiptWorkflow').click();
  await expect(page).toHaveURL(path('/belege'));release();await refreshed;
  await page.unroute(receiptListURL);
  await expect(receipts.locator('#receiptWorkflowDialog')).not.toBeVisible();
  assert.equal(await receipts.locator('#review').evaluate(()=>window.navigationSentinel),'preserve-frame');
  await page.getByRole('link',{name:'Eigenleistungen',exact:true}).click();
  await page.getByRole('link',{name:'Rechnungen & Belege',exact:true}).click();
  await expect(receipts.locator('.entry[data-id="'+rid+'"]')).toBeVisible();
  await expect(receipts.locator('#receiptWorkflowDialog')).not.toBeVisible();
  await expect(page).toHaveURL(path('/belege'));
  // A deliberate deep link still opens, including repeated links to the same cached source.
  await page.goto(path('/belege?receipt_id='+rid));
  await expect(receipts.locator('#receiptWorkflowDialog')).toBeVisible();
  await receipts.locator('#closeReceiptWorkflow').click();await expect(page).toHaveURL(path('/belege'));
  await page.evaluate(rid=>window.PHBReactBridge.navigate('/belege?receipt_id='+rid),rid);
  await expect(receipts.locator('#receiptWorkflowDialog')).toBeVisible();
  await expect(page).toHaveURL(path('/belege?receipt_id='+rid));
  await receipts.locator('#closeReceiptWorkflow').click();await expect(page).toHaveURL(path('/belege'));
  // Declining the dirty guard must retain the URL and editor.
  await receipts.locator('.entry[data-id="'+rid+'"]').click();
  await receipts.locator('#review [name=notes]').fill('Ungespeichert');
  await receipts.locator('#closeReceiptWorkflow').click();
  const confirm=receipts.locator('dialog.phb-messagebox');
  await confirm.getByRole('button',{name:'Abbrechen',exact:true}).click();
  await expect(page).toHaveURL(path('/belege?receipt_id='+rid));
  await expect(receipts.locator('#review [name=notes]')).toHaveValue('Ungespeichert');
  await receipts.locator('#closeReceiptWorkflow').click();await confirm.getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(page).toHaveURL(path('/belege'));
  await receipts.locator('.entry[data-id="'+rid+'"]').click();
  await page.getByRole('link',{name:'Eigenleistungen',exact:true}).click();
  await page.getByRole('link',{name:'Rechnungen & Belege',exact:true}).click();
  await expect(receipts.locator('.entry[data-id="'+rid+'"]')).toBeVisible();
  await expect(receipts.locator('#receiptWorkflowDialog')).not.toBeVisible();
  await expect(page).toHaveURL(path('/belege'));
  for(const [route,title,dialog,close,key,id] of [
   ['/angebote','Angebote','#offerEditDialog','#closeOfferEdit','offer_id',offer.id],
   ['/finanzierung','Kredite & Eigenkapital','#loanDialog','#closeLoan','loan_id',loan],
   ['/','Bauzeitenplan','#overlay','#closeTask','task_id',task],
   ['/','Bauzeitenplan','#phaseDialog','#closePhaseDialog','phase_id',phase],
  ]){
   await page.goto(path(route+'?'+key+'='+id));
   const frame=page.frameLocator('iframe[title="'+title+'"]:not([hidden])');
   await expect(frame.locator(dialog)).toBeVisible();await frame.locator(close).click();
   await expect(page).toHaveURL(route==='/'?base+'/p/'+owner:path(route));await expect(frame.locator(dialog)).not.toBeVisible();
   await page.reload();await expect(frame.locator(dialog)).not.toBeVisible();
  }
  for(const [route,key,id] of [['/eigenleistungen','plan_id',plan.id],['/energieplanung','funding_id',funding],['/stammdaten','new_company',1],['/dokumente','upload',1]]){
   await page.goto(path(route+'?'+key+'='+id));
   const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
   await dialog.getByRole('button',{name:'Schließen',exact:true}).click();
   await expect(page).toHaveURL(path(route));await page.reload();await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.goto(path('/stammdaten?new_company=1&receipt_id='+rid+'#firmen'));
  await page.getByRole('dialog').getByRole('button',{name:'Schließen',exact:true}).click();
  await expect(page).toHaveURL(path('/stammdaten#firmen'));
  await page.goto(path('/stammdaten?new_company=1&receipt_id='+rid+'#firmen'));
  const company=page.getByRole('dialog');
  await company.getByRole('textbox',{name:'Firmenname',exact:true}).fill('Neue Lieferfirma');
  await company.getByRole('button',{name:'Speichern',exact:true}).click();
  await expect(receipts.locator('#receiptWorkflowDialog')).toBeVisible();
  await expect(page).toHaveURL(new RegExp('/belege\\?receipt_id='+rid));
  await expect(receipts.locator('#receiptAssignmentType')).toHaveValue('Betrieb');
  await receipts.locator('#saveReceiptDraft').click();
  await expect(receipts.locator('#receiptSaveStatus')).toContainText('Entwurf gespeichert.');
  await receipts.locator('#closeReceiptWorkflow').click();
  await expect(page).toHaveURL(path('/belege'));
  assert.deepEqual(errors,[]);
  console.log('PASS dialog URL cleanup, saved receipt navigation, cached frame reuse, repeated deep links, dirty cancellation and all primary page entry points.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

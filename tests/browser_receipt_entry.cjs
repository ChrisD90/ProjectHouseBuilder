/* Isolated regression for receipt entry, field help and import handoff. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Belege erfassen'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  const receipts=async()=>(await(await page.request.get(base+'/api/receipts',{headers})).json()).receipts;
  await page.goto(base+'/p/'+owner+'/belege');
  const frame=page.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');
  await frame.locator('#openTillReceiptWorkflow').click();
  await expect(frame.locator('.receipt-upload-panel h2')).toHaveCount(0);
  const file=await frame.locator('.receipt-upload-file').boundingBox();
  const hint=await frame.locator('.receipt-upload-file-hint').boundingBox();
  const button=await frame.locator('#receiptUploadButton').boundingBox();
  const upload=await frame.locator('#upload').boundingBox();
  assert(hint.y>=file.y+file.height-1&&hint.width>upload.width-2);
  assert(Math.abs(button.x+button.width-upload.x-upload.width)<2);
  assert.equal(await frame.locator('#receiptUploadButton').evaluate(n=>getComputedStyle(n).backgroundColor),await frame.locator('#receiptUploadButton').evaluate(n=>{const probe=document.createElement('span');probe.style.color='var(--brand-button)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;}));
  await frame.getByRole('button',{name:'Hinweis: Verarbeitung',exact:true}).click();
  await expect(frame.locator('.receipt-info-bubble:popover-open')).toContainText('Ohne Analyse');
  await page.keyboard.press('Escape');
  await expect(frame.locator('.receipt-info-bubble:popover-open')).toHaveCount(0);
  await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible();
  await frame.locator('#receiptProcessingMode').selectOption('draft');
  await expect(frame.locator('#receiptAnalysisMode')).toBeDisabled();
  await frame.locator('#upload input[type=file]').setInputFiles({name:'Bon-ohne-Analyse.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nNur ablegen')});
  await frame.locator('#receiptUploadButton').click();
  await expect(frame.locator('#receiptWorkflowDialog')).not.toBeVisible();
  await expect.poll(async()=>(await receipts()).length).toBe(1);
  const draft=(await receipts())[0];
  const detail=await(await page.request.get(base+'/api/receipts/'+draft.id,{headers})).json();
  assert.equal(detail.source,'Ohne Analyse');assert.equal(detail.kind,'Kassenzettel');
  assert.equal(detail.status,'Entwurf');assert.equal(detail.paid_amount,0);assert.equal(detail.gross_amount,null);

  // Keep the browser waiting while the real server retains exactly one job/file.
  let delay=true,submissions=0;
  let releaseStatus;
  const heldStatus=new Promise(resolve=>{releaseStatus=resolve;});
  let finishStatus;
  const statusFinished=new Promise(resolve=>{finishStatus=resolve;});
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/import-jobs'&&r.method()==='POST')submissions++;});
  await page.route('**/api/import-jobs/batches/*',async route=>{
   const response=await route.fetch(),body=await response.json();
   if(delay)await heldStatus;
   if(delay)for(const job of body.jobs){job.status='Läuft';job.stage='Analyse läuft im Test';}
   await route.fulfill({response,json:body});
   finishStatus();
  });
  await frame.locator('#openReceiptWorkflow').click();
  await frame.locator('#upload input[type=file]').setInputFiles({name:'Rechnung-Hintergrund.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nHintergrundwechsel')});
  const statusRequested=page.waitForRequest(request=>request.url().includes('/api/import-jobs/batches/'));
  await frame.locator('#receiptUploadButton').click();
  await statusRequested;
  const background=page.getByRole('button',{name:'Im Hintergrund fortsetzen',exact:true});
  await expect(background).toBeEnabled();await background.click();
  await expect(background).not.toBeVisible();
  await expect(frame.locator('#receiptWorkflowDialog')).not.toBeVisible();
  delay=false;releaseStatus();await statusFinished;await page.unroute('**/api/import-jobs/batches/*');
  await expect.poll(async()=>(await receipts()).length).toBe(2);
  assert.equal(submissions,1,'Handoff must not upload or start the document twice');
  await expect(page.getByRole('button',{name:'Warteschlange',exact:true})).toBeEnabled();
  await page.reload();
  await frame.locator('.entry[data-id="'+draft.id+'"]').click();
  await expect(frame.locator('#review .receipt-form-heading')).toHaveText(['1. Zuordnung','3. Rechnungsdaten']);
  const order=await frame.locator('#review').evaluate(form=>{
   const y=selector=>form.querySelector(selector).getBoundingClientRect().top;
   return [y('#receiptAssignmentType'),y('[name=kind]'),y('[name=invoice_number]'),y('#receiptGross')];
  });
  assert(order.every((y,i)=>i===0||y>=order[i-1]),'Attribution, kind, dates and amounts follow the intended order');
  await expect(frame.locator('[name=kind]')).toBeVisible();
  await frame.getByRole('button',{name:'Hinweis: Zuordnung und Abrechnung',exact:true}).click();
  await expect(frame.locator('.receipt-info-bubble:popover-open')).toContainText('Ist-Kosten');
  await page.screenshot({path:'/tmp/phb-receipt-entry.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('textbox',{name:'Darstellung',exact:true}).click();
  await page.getByRole('option',{name:'Dunkel',exact:true}).click();
  await frame.getByRole('button',{name:'Hinweis: Prüfen und buchen',exact:true}).click();
  await expect(frame.locator('.receipt-info-bubble:popover-open')).toContainText('Kassenzettel');
  await page.screenshot({path:'/tmp/phb-receipt-entry-dark.png'});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>frame.locator('.receipt-info-bubble:popover-open').evaluate(node=>{
   const rect=node.getBoundingClientRect();return rect.x>=0&&rect.y>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1;
  })).toBe(true);
  assert(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'/tmp/phb-receipt-entry-mobile.png'});
  // The retained classic UI offers the same foreground handoff.
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/belege?_classic=1&project_id='+owner);
  await page.locator('#phbImportToast').getByRole('button',{name:'Schließen',exact:true}).click();
  await page.locator('#openReceiptWorkflow').click();
  delay=true;
  await page.route('**/api/import-jobs/batches/*',async route=>{
   const response=await route.fetch(),body=await response.json();
   if(delay)for(const job of body.jobs){job.status='Läuft';job.stage='Klassische Analyse';}
   await route.fulfill({response,json:body});
  });
  await page.locator('#upload input[type=file]').setInputFiles({name:'Klassischer-Upload.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nKlassischer Wechsel')});
  await page.locator('#receiptUploadButton').click();
  await expect(page.locator('#phbImportBackground')).toBeEnabled();
  await page.locator('#phbImportBackground').click();
  await expect(page.locator('#phbImportWait')).not.toBeVisible();
  await expect(page.locator('#receiptWorkflowDialog')).not.toBeVisible();
  delay=false;await page.unroute('**/api/import-jobs/batches/*');
  await expect.poll(async()=>(await receipts()).length).toBe(3);
  assert.deepEqual(errors,[]);
  console.log('PASS compact upload, contextual help in light/dark/mobile, ordered fields, no-analysis drafts and React/classic background handoff without duplicate imports.');
 }catch(error){await page.screenshot({path:'/tmp/phb-receipt-entry-failure.png'});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

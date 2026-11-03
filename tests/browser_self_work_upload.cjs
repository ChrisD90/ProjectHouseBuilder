const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'DIY Upload'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  const task=(await(await page.request.post(base+'/api/tasks',{headers,data:{code:'D1',name:'Zimmer streichen',trade:'Maler & Lackierer',execution_type:'Eigenleistung',duration:1}})).json()).id;
  const plan=(await(await page.request.post(base+'/api/self-work',{headers,data:{title:'Wände streichen',description:'Kachelfläche anklicken',task_id:task}})).json()).plan;
  await page.goto(base+'/p/'+owner+'/eigenleistungen');
  await page.locator('.self-work-card').getByText('Kachelfläche anklicken',{exact:true}).click();
  const edit=page.getByRole('dialog',{name:'Eigenleistung bearbeiten',exact:true});
  await expect(edit).toBeVisible();
  await edit.getByRole('button',{name:'Schließen',exact:true}).click();
  await page.getByRole('button',{name:'Rechnungen zu Wände streichen: 0',exact:true}).click();
  await expect(edit.getByRole('tab',{name:'Rechnungen (0)',exact:true})).toHaveAttribute('aria-selected','true');
  await edit.getByRole('tab',{name:'Vorhaben',exact:true}).click();
  await edit.getByRole('textbox',{name:'Ort / Raum',exact:true}).fill('Obergeschoss');
  await edit.getByRole('tab',{name:'Rechnungen (0)',exact:true}).click();
  await edit.getByRole('button',{name:'Rechnungen & Kassenzettel erfassen',exact:true}).click();
  await page.getByRole('dialog',{name:'Bitte bestätigen',exact:true}).getByRole('button',{name:'Bestätigen',exact:true}).click();
  const frame=page.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');
  await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible();
  await expect(frame.locator('#receiptWorkflowTitle')).toHaveText('Beleg zur Eigenleistung erfassen');
  await expect(frame.locator('#uploadStatus')).toContainText('Wände streichen');
  await frame.locator('#upload input[type=file]').setInputFiles({name:'material.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nDIY test')});
  await frame.locator('#receiptUploadButton').click();
  await expect(frame.locator('#receiptAssignmentType')).toHaveValue('Eigenleistung',{timeout:30000});
  await expect(frame.locator('#receiptTrade')).toHaveValue('Maler & Lackierer');
  const saved=(await(await page.request.get(base+'/api/self-work/'+plan.id,{headers})).json()).plan;
  assert.equal(saved.receipt_ids.length,1);
  assert.equal(saved.actual_cost,0);
  assert.equal(saved.location,'Obergeschoss');
  console.log('PASS whole DIY card, independent invoice action, direct contextual upload and persisted draft attribution.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

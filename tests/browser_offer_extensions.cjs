const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
function pdf(){
 const content='BT /F1 12 Tf 50 780 Td (Testfirma GmbH) Tj 0 -20 Td (Angebot Nr TEST-1) Tj 0 -20 Td (Gesamtbetrag 1190,00 EUR) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream'];
 let result='%PDF-1.4\n';const offsets=[];for(const [i,object] of objects.entries()){offsets.push(result.length);result+=(i+1)+' 0 obj\n'+object+'\nendobj\n';}const start=result.length;
 return Buffer.from(result+'xref\n0 6\n0000000000 65535 f \n'+offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF');
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Angebote prüfen und planen'}})).json()).project.id,headers={'X-PHB-Project':String(owner)};
  async function api(method,path,data){const r=await page.request[method](base+path,{headers,data});assert(r.ok(),await r.text());return r.json();}
  const company=(await api('post','/api/contractors',{name:'Testfirma GmbH',trade:'Elektro'})).contractor.id;
  const upload=await page.request.post(base+'/api/offers/import',{headers,multipart:{analysis_mode:'local',file:{name:'Angebot.pdf',mimeType:'application/pdf',buffer:pdf()}}});assert(upload.ok(),await upload.text());const id=(await upload.json()).id;
  await api('patch','/api/offers/'+id+'/draft',{vendor:'Testfirma GmbH',contractor_id:company,net:1000,gross:1190,vat:190,category:'Elektro',positions:[{number:'1',description:'Kabel liefern',section:'Elektro',net_amount:500},{number:'2',description:'Dosen setzen',section:'Elektro',net_amount:500}]});
  const offer=async()=>(await api('get','/api/offers')).offers.find(row=>row.id===id);
  await page.goto(base+'/p/'+owner+'/angebote?offer_draft='+id);
  const frame=page.frameLocator('iframe[title="Angebote"]:not([hidden])'),draft=frame.locator('form[data-review="'+id+'"]');
  await expect(draft).toBeVisible();await draft.locator('[data-position-field="description"]').first().fill('Kabel liefern (geprüft)');
  await draft.locator('[data-position-field="own_work"]').first().check();await expect(draft.locator('.offer-diy-summary')).toContainText('595,00');
  await frame.locator('body').evaluate(()=>window.PHBUI.setTheme('dark'));
  assert(await draft.locator('.offer-positions-editor').evaluate(node=>getComputedStyle(node).backgroundColor!=='rgb(255, 255, 255)'));
  await frame.locator('#offerWorkflowDialog').screenshot({path:'/tmp/phb-offer-positions-dark.png'});
  await draft.locator('[data-offer-promote]').click();
  await expect(frame.locator('#offerWorkflowDialog')).toBeHidden();await expect(page).toHaveURL(base+'/p/'+owner+'/angebote');
  assert.equal((await offer()).status,'Angebot');assert.equal((await offer()).positions[0].own_work,true);
  await frame.locator('[data-offer-details="'+id+'"]').click();const details=frame.locator('#offerEditDialog');
  await expect(details.locator('.offer-diy-plan')).not.toHaveAttribute('open');await details.locator('.offer-diy-plan > summary').click();
  await expect(details.locator('.offer-diy-summary')).toContainText('595,00');
  const choice=details.locator('[data-diy-position]');await choice.nth(1).check();await choice.nth(0).uncheck();
  await details.getByRole('button',{name:'Auswahl speichern',exact:true}).click();
  await expect.poll(async()=>(await offer()).positions.map(position=>position.own_work)).toEqual([false,true]);
  await details.locator('#closeOfferEdit').click();
  await api('patch','/api/offers/'+id,{status:'Angenommen'});await page.reload();
  await frame.locator('[data-offer-details="'+id+'"]').click();await details.locator('.offer-diy-plan > summary').click();await details.locator('[data-diy-position]').first().check();
  await details.getByRole('button',{name:'Auswahl speichern',exact:true}).click();await expect.poll(async()=>(await offer()).diy_estimate.remaining_gross).toBe(0);
  assert.equal((await offer()).agreed_gross,1190);assert.equal((await api('get','/api/costs')).items.find(row=>row.offer_id===id).committed,1190);
  await details.locator('[data-diy-position]').first().uncheck();
  await details.locator('#openOfferDocuments').click();const documents=frame.locator('#offerDocumentsDialog');
  await documents.locator('form[data-offer-attachments] input[type=file]').setInputFiles([{name:'Zusatz.txt',mimeType:'text/plain',buffer:Buffer.from('Weitere Vereinbarung')},{name:'Anlage.pdf',mimeType:'application/pdf',buffer:pdf()}]);
  await documents.getByRole('button',{name:'Anhänge hochladen',exact:true}).click();await expect(documents.locator('.offer-attachment-row')).toHaveCount(2);await expect(details.locator('#offerDocumentsCount')).toHaveText('2');await documents.locator('#closeOfferDocuments').click();
  await expect(details.locator('[data-diy-position]').first()).not.toBeChecked();assert(await details.evaluate(()=>window.PHBFlow.get('offerEditDialog').dirty()));await details.locator('[data-diy-position]').first().check();
  const library=(await api('get','/api/document-library')).documents;assert(library.some(row=>row.filename==='Zusatz.txt'&&row.source==='Angebote'));
  for(const mode of ['light','dark']){
   await frame.locator('body').evaluate((_,mode)=>window.PHBUI.setTheme(mode),mode);
   await details.screenshot({path:'/tmp/phb-offer-diy-attachments-'+mode+'.png'});
  }
  await page.setViewportSize({width:390,height:844});await expect(details.locator('#closeOfferEdit')).toBeInViewport();
  await expect.poll(()=>frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await details.screenshot({path:'/tmp/phb-offer-diy-attachments-mobile.png'});
  await details.locator('#openOfferDocuments').click();await documents.locator('[data-attachment-delete]').first().click();await frame.locator('dialog.phb-messagebox').getByRole('button',{name:'Bestätigen',exact:true}).click();await expect(documents.locator('.offer-attachment-row')).toHaveCount(1);await expect(details.locator('#offerDocumentsCount')).toHaveText('1');await documents.locator('#closeOfferDocuments').click();
  await details.locator('#closeOfferEdit').click();await frame.locator('[data-offer-details="'+id+'"]').click();await expect(details.locator('.offer-diy-summary')).toContainText('0,00');
  assert.deepEqual(errors,[]);console.log('PASS draft save/promote without false conflicts, persisted DIY scenarios, unchanged accepted order totals, attachment uploads/deletion/document index and light/dark/mobile views.');
 }catch(error){await page.screenshot({path:'/tmp/phb-offer-extensions-failure.png'});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

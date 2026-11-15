const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
function quotePDF(){
 const content='BT /F1 12 Tf 50 780 Td (Testfirma GmbH) Tj 0 -20 Td (Angebot Nr DEL-1) Tj 0 -20 Td (Gesamtbetrag 100,00 EUR) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream'];
 let pdf='%PDF-1.4\n';const offsets=[0];
 for(const [i,object] of objects.entries()){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+object+'\nendobj\n';}
 const start=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
 return Buffer.from(pdf+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF');
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Upload löschen'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  const path=value=>base+'/p/'+owner+value;
  const jobs=async()=>(await(await page.request.get(base+'/api/import-jobs',{headers})).json()).jobs;
  async function enqueue(kind,name,fields={}){
   const response=await page.request.post(base+'/api/import-jobs',{headers,multipart:{kind,analysis_mode:kind==='receipts'?'none':'local',...fields,files:{name,mimeType:name.endsWith('.txt')?'text/plain':'application/pdf',buffer:name.endsWith('.txt')?Buffer.from(name):quotePDF()}}});
   assert.equal(response.status(),202,await response.text());const created=(await response.json()).jobs[0];
   await expect.poll(async()=>{const rows=await jobs();return rows.find(job=>job.id===created.id)?.status;},{timeout:30000}).toBe('Fertig');
   return(await jobs()).find(job=>job.id===created.id);
  }
  async function queueIsEmpty(){
   await expect.poll(async()=>(await jobs()).length).toBe(0);
   await page.getByRole('button',{name:'Warteschlange',exact:true}).click();
   const queue=page.getByRole('dialog',{name:'Verarbeitung & Prüfung',exact:true});
   await expect(queue).toContainText('Keine Aufträge vorhanden.');
   await queue.getByRole('button',{name:'Schließen',exact:true}).click();
  }
  for(const kind of ['Rechnung','Kassenzettel']){
   const job=await enqueue('receipts',kind+'.pdf',{receipt_kind:kind});
   await page.goto(path('/belege?receipt_id='+job.result_id));
   const frame=page.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');
   await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible();
   await frame.locator('#delete').click();
   const confirm=frame.locator('dialog.phb-messagebox');
   await confirm.getByRole('button',{name:'Abbrechen',exact:true}).click();
   assert.equal((await jobs()).length,1);await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible();
   await frame.locator('#delete').click();await confirm.getByRole('button',{name:'Bestätigen',exact:true}).click();
   await expect(frame.locator('#receiptWorkflowDialog')).not.toBeVisible();
   await expect(page).toHaveURL(path('/belege'));await queueIsEmpty();
   await page.reload();await expect(frame.locator('#receiptWorkflowDialog')).not.toBeVisible();
  }
  const offer=await enqueue('offers','Angebot.pdf');
  await page.goto(path('/angebote?offer_draft='+offer.result_id));
  const offers=page.frameLocator('iframe[title="Angebote"]:not([hidden])');
  await offers.locator('#offerDrafts [data-offer-delete]').click();
  await offers.locator('dialog.phb-messagebox').getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(offers.locator('#offerWorkflowDialog')).not.toBeVisible();await queueIsEmpty();
  const document=await enqueue('documents','Unterlage.txt');
  await page.goto(path('/dokumente?document_id='+document.result_id));
  const edit=page.getByRole('dialog',{name:'Dokument pflegen',exact:true});await expect(edit).toBeVisible();
  await edit.getByRole('button',{name:/Löschen/}).click();
  await page.getByRole('dialog',{name:'Bitte bestätigen',exact:true}).getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(edit).not.toBeVisible();await expect(page).toHaveURL(path('/dokumente'));await queueIsEmpty();
  const manual=await page.request.post(base+'/api/offers/manual',{headers,data:{vendor:'Versionstest',gross:100,category:'Sonstiges'}});
  assert(manual.ok(),await manual.text());const original=(await manual.json()).id;
  await enqueue('versions','Version.pdf',{offer_id:String(original)});
  await page.goto(path('/angebote?offer_draft='+original));
  await offers.locator('#offerDrafts [data-version-discard]').click();
  await offers.locator('dialog.phb-messagebox').getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(offers.locator('#offerWorkflowDialog')).not.toBeVisible();await queueIsEmpty();
  assert.deepEqual(errors,[]);
  console.log('PASS delete/cancel invoice and till drafts, clean URLs, no reopening, empty live queue, offer/document deletion and version discard.');
 }catch(error){await page.screenshot({path:'/tmp/phb-import-delete-failure.png'});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

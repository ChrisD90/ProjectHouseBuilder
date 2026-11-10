const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'de-DE',viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Offene Rechnungen'}})).json()).project.id,headers={'X-PHB-Project':String(owner)};
  async function api(method,path,data){const r=await page.request[method](base+path,{headers,data});assert(r.ok(),await r.text());return r.json();}
  async function receipt(name,paid=0,book=true){
   const r=await page.request.post(base+'/api/receipts',{headers,multipart:{analysis_mode:'none',file:{name:name+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n'+name)}}});assert(r.ok(),await r.text());const id=(await r.json()).id;
   await api('patch','/api/receipts/'+id,{supplier:name,invoice_number:name,document_date:'2026-11-04',gross_amount:119,paid_amount:paid,assignment_type:'Eigenleistung',book_now:book});return id;
  }
  const unpaid=await receipt('R-offen'),partial=await receipt('R-teilweise',20);await receipt('R-bezahlt',119);const draft=await receipt('R-Entwurf',0,false);
  await api('patch','/api/receipts/'+draft,{supplier:'Fachbetrieb für energetische Gebäudesanierung und moderne Haustechnik GmbH'});
  const canceled=await receipt('R-storniert');const preview=await api('get','/api/receipts/'+canceled+'/cancel-preview');await api('post','/api/receipts/'+canceled+'/cancel',{confirm:true,plan_digest:preview.plan_digest,reason:'Test'});
  const equity=(await api('post','/api/financing/equity',{name:'Baukonto',opening_balance:1000,reserve:0})).id;
  const assigned=await receipt('R-zugewiesen'),splitReceipt=await receipt('R-gemischt',119);
  await api('post','/api/financing/payments',{receipt_id:assigned,source:'equity',equity_id:equity,amount:119,payment_date:'2026-11-04'});
  await api('post','/api/financing/payments/assign',{receipt_id:splitReceipt,source:'equity',equity_id:equity,amount:99,payment_date:'2026-11-04'});
  await page.goto(base+'/p/'+owner+'/eigenleistungen');
  await page.getByRole('button',{name:'Offene Rechnungen: 2',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Offene Rechnungen',exact:true});await expect(modal).toBeVisible();
  await page.screenshot({path:'/tmp/phb-unpaid-receipts-desktop.png'});
  await page.setViewportSize({width:390,height:844});await expect(modal.getByRole('button',{name:'Schließen',exact:true})).toBeInViewport();
  await expect.poll(()=>page.locator('html').evaluate(node=>node.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'/tmp/phb-unpaid-receipts-mobile.png'});await page.setViewportSize({width:1440,height:1000});
  await expect(modal.getByText('R-offen',{exact:true})).toBeVisible();await expect(modal.getByText('R-teilweise',{exact:true})).toBeVisible();await expect(modal).not.toContainText('R-storniert');await expect(modal).not.toContainText('R-Entwurf');await expect(modal).not.toContainText('R-bezahlt');await expect(modal).toContainText('99,00');
  await modal.getByRole('button',{name:'Rechnung R-offen bezahlen',exact:true}).click();
  const frame=page.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');
  await expect(frame.locator('#receiptPaymentsPanel')).toBeVisible();await expect(frame.locator('#receiptReviewLayout')).toBeHidden();await expect(page).toHaveURL(new RegExp('receipt_id='+unpaid+'&financing=1'));
  await frame.locator('#submitReceiptPayment').click();await frame.locator('dialog.phb-messagebox').getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Offene Rechnungen: 1',exact:true})).toBeVisible();
  await frame.locator('#closeReceiptWorkflow').click();await expect(page).toHaveURL(base+'/p/'+owner+'/belege');
  const date=frame.locator('.entry[data-id="'+unpaid+'"] .receipt-card-date');await expect(date).toHaveText('04.11.2026');
  assert(await date.evaluate(node=>{const label=node.closest('.receipt-card-footer').querySelector('.receipt-card-assignment').getBoundingClientRect(),d=node.getBoundingClientRect(),card=node.closest('.receipt-entry-row').getBoundingClientRect();return d.left>=label.right&&Math.abs(d.y+d.height/2-label.y-label.height/2)<2&&Math.abs(card.right-d.right-13)<2&&card.bottom-d.bottom<=12;}));
  assert(await date.evaluate(node=>node.closest('.receipt-entry-row').getBoundingClientRect().height===180));
  for(const id of [unpaid,draft])assert(await frame.locator('.entry[data-id="'+id+'"] .receipt-card-title').evaluate(node=>{const title=node.querySelector('strong'),range=document.createRange();range.setStart(title.firstChild,0);range.setEnd(title.firstChild,1);const text=range.getBoundingClientRect(),icon=node.querySelector('svg').getBoundingClientRect();return Math.abs(icon.y+icon.height/2-text.y-text.height/2)<2&&icon.right<title.getBoundingClientRect().left;}),'Icon muss auf Höhe der ersten Titelzeile ausgerichtet sein.');
  const card=id=>frame.locator('.entry[data-id="'+id+'"]').locator('..');
  await expect(card(assigned).locator('.receipt-unassigned-tag')).toHaveCount(0);await expect(card(draft).locator('.receipt-unassigned-tag')).toHaveCount(0);await expect(card(canceled).locator('.receipt-unassigned-tag')).toHaveCount(0);
  for(const id of [unpaid,partial,splitReceipt])await expect(card(id).locator('.receipt-unassigned-tag')).toHaveText('Nicht zugewiesen');
  await expect(frame.locator('.receipt-payment-badge,.receipt-payment-label')).toHaveCount(0);
  assert(await card(splitReceipt).evaluate(card=>{const amount=card.querySelector('.receipt-card-amount>strong').getBoundingClientRect(),tag=card.querySelector('.receipt-unassigned-tag'),box=tag.getBoundingClientRect();const rgb=getComputedStyle(tag).color.match(/[\d.]+/g).map(Number);return box.top>=amount.bottom&&Math.abs(box.left-amount.left)<1&&rgb[0]>rgb[1]&&rgb[0]>rgb[2]&&card.getBoundingClientRect().height===180&&card.scrollHeight<=card.clientHeight;}));
  const persisted=(await api('get','/api/receipts')).receipts;assert.equal(persisted.find(row=>row.id===assigned).payment_assignment,'Zugewiesen');assert.equal(persisted.find(row=>row.id===splitReceipt).payment_assignment,'Teilweise zugewiesen');
  for(const theme of ['light','dark']){await frame.locator('body').evaluate((_,theme)=>window.PHBUI.setTheme(theme),theme);await frame.locator('#list').screenshot({path:'/tmp/phb-receipt-unassigned-'+theme+'.png'});}

  await frame.locator('#list').screenshot({path:'/tmp/phb-receipt-footer-date.png'});
  await page.getByRole('button',{name:'Offene Rechnungen: 1',exact:true}).click();await modal.getByRole('button',{name:'Rechnung R-teilweise bezahlen',exact:true}).click();await expect(frame.locator('#receiptPaymentsPanel')).toBeVisible();
  await frame.locator('#submitReceiptPayment').click();await frame.locator('dialog.phb-messagebox').getByRole('button',{name:'Bestätigen',exact:true}).click();await expect(page.getByRole('button',{name:/Offene Rechnungen:/})).toHaveCount(0);await frame.locator('#closeReceiptWorkflow').click();
  const other=(await(await page.request.post(base+'/api/projects',{data:{title:'Anderes Projekt'}})).json()).project.id;await page.goto(base+'/p/'+other+'/belege');await expect(page.getByRole('button',{name:/Offene Rechnungen:/})).toHaveCount(0);
  const english=await browser.newContext({locale:'en-US'}),englishPage=await english.newPage();await englishPage.goto(base+'/p/'+owner+'/belege');
  const englishFrame=englishPage.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');await expect(englishFrame.locator('.entry[data-id="'+unpaid+'"] .receipt-card-date')).toHaveText('11/04/2026');await english.close();
  const mixed=await browser.newContext({locale:'en-US'});await mixed.addInitScript(()=>Object.defineProperty(navigator,'languages',{get:()=>['en-US','de-DE']}));
  const mixedPage=await mixed.newPage();await mixedPage.goto(base+'/p/'+owner+'/belege');const mixedFrame=mixedPage.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');await expect(mixedFrame.locator('.entry[data-id="'+unpaid+'"] .receipt-card-date')).toHaveText('04.11.2026');await mixed.close();
  assert.deepEqual(errors,[]);console.log('PASS project-scoped unpaid counter, partials, excluded drafts/cancellations, direct payment navigation, live disappearance after payment, URL cleanup and German/US dates in unchanged card size.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

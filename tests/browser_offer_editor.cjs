const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Angebotseditor'}})).json()).project.id,headers={'X-PHB-Project':String(owner)};
  async function api(method,path,data){const response=await page.request[method](base+path,{headers,data});assert(response.ok(),await response.text());return response.json();}
  const company=(await api('post','/api/contractors',{name:'Testfirma',trade:'Elektro'})).contractor.id;
  const created=await api('post','/api/offers/manual',{contractor_id:company,gross:1190,net:1000,vat:190,category:'Elektro'}),id=created.id;
  await page.goto(base+'/p/'+owner+'/angebote?offer_id='+id);
  const frame=page.frameLocator('iframe[title="Angebote"]:not([hidden])'),editor=frame.locator('#offerEditDialog'),form=editor.locator('#offerEditForm');
  await expect(editor).toBeVisible();await expect(form.locator('[data-offer-tax]')).toHaveValue('19');
  await expect(editor.locator('.offer-attachments')).not.toHaveAttribute('open');
  await editor.locator('#openOfferVersionHistory').click();const history=frame.locator('#offerVersionHistoryDialog');await expect(history).toBeVisible();await expect(history).toContainText('Version 1');
  await history.locator('#closeOfferVersionHistory').click();await expect(editor).toBeVisible();
  await editor.locator('#openOfferVersionUpload').click();const upload=frame.locator('#offerVersionUploadDialog');await expect(upload).toBeVisible();await expect(upload.locator('input[type=file]')).toBeVisible();
  await upload.locator('#closeOfferVersionUpload').click();await expect(editor).toBeVisible();
  await form.locator('[name=gross]').fill('2380');await expect(form.locator('[name=net]')).toHaveValue('2.000');await expect(form.locator('[name=vat]')).toHaveValue('380');
  await form.locator('[name=net]').fill('1000');await expect(form.locator('[name=gross]')).toHaveValue('1.190');
  await form.locator('[data-offer-tax]').selectOption('7');await expect(form.locator('[name=gross]')).toHaveValue('1.070');await expect(form.locator('[name=vat]')).toHaveValue('70');
  await form.locator('[data-offer-tax]').selectOption('0');await expect(form.locator('[name=gross]')).toHaveValue('1.000');await expect(form.locator('[name=vat]')).toHaveValue('0');
  await form.locator('[data-offer-tax]').selectOption('manual');await form.locator('[name=gross]').fill('1050');await expect(form.locator('[name=net]')).toHaveValue('1.000');
  await form.locator('[name=vat]').fill('50');await expect(form.locator('[data-offer-tax]')).toHaveValue('manual');
  await form.locator('.offer-extra-fields > summary').click();await form.locator('[name=notes]').fill('Nicht beim Anhängen verlieren');
  await editor.locator('.offer-attachments > summary').click();await editor.locator('[name=files]').setInputFiles({name:'Zusatz.txt',mimeType:'text/plain',buffer:Buffer.from('Zusatzvereinbarung')});
  await editor.getByRole('button',{name:'Anhänge hochladen',exact:true}).click();await expect(editor.locator('.offer-attachment-row')).toHaveCount(1);
  await expect(form.locator('[name=notes]')).toHaveValue('Nicht beim Anhängen verlieren');await expect(form.locator('[name=gross]')).toHaveValue('1.050');
  await editor.getByRole('button',{name:'Speichern',exact:true}).click();await expect(editor).toBeHidden();await expect(page).toHaveURL(base+'/p/'+owner+'/angebote');
  const alert=frame.locator('dialog.phb-messagebox');await alert.getByRole('button',{name:'OK',exact:true}).click();
  const offer=(await api('get','/api/offers')).offers.find(o=>o.id===id);assert.equal(offer.gross,1050);assert.equal(offer.net,1000);assert.equal(offer.vat,50);assert.equal(offer.attachments.length,1);assert.equal(offer.notes,'Nicht beim Anhängen verlieren');
  await frame.locator('[data-offer-details="'+id+'"]').click();await expect(editor).toBeVisible();await expect(form.locator('[data-offer-tax]')).toHaveValue('manual');
  await editor.locator('#closeOfferEdit').click();await frame.locator('[data-offer-edit="'+id+'"]').click();await expect(editor).toBeVisible();
  for(const theme of ['light','dark']){await frame.locator('body').evaluate((_,mode)=>window.PHBUI.setTheme(mode),theme);await editor.screenshot({path:'/tmp/phb-offer-editor-'+theme+'.png'});}
  await page.setViewportSize({width:390,height:844});await expect(editor.locator('#closeOfferEdit')).toBeInViewport();await expect(editor.getByRole('button',{name:'Speichern',exact:true})).toBeInViewport();
  assert(await editor.evaluate(node=>node.scrollWidth<=node.clientWidth+1));await editor.screenshot({path:'/tmp/phb-offer-editor-mobile.png'});
  assert.deepEqual(errors,[]);console.log('PASS same editor from URL/card/pencil, stacked version actions, collapsed attachments preserving edits, VAT calculation both directions and manual mode, save and responsive themes.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

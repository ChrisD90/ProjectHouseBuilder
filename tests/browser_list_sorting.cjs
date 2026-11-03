const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Sortierung'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  async function post(path,data){const response=await page.request.post(base+path,{headers,data});assert(response.ok(),await response.text());return response.json();}
  const offers=[];
  for(const [vendor,gross] of [['Zebra',100],['Alpha',300],['Mitte',200]])offers.push((await post('/api/offers/manual',{vendor,gross,category:'Elektro'})).offer);
  for(const offer of offers.slice(0,2)){const r=await page.request.patch(base+'/api/offers/'+offer.id,{headers,data:{status:'Angenommen'}});assert(r.ok(),await r.text());}
  for(const [title,cost] of [['Zebra',100],['Alpha',300],['Mitte',200]]){
   await post('/api/self-work',{title,materials:[{title:'Material',quantity:1,unit:'Stück',unit_price:cost,status:'Benötigt'}]});
  }
  for(const [title,due_on] of [['Zebra','2026-12-31'],['Alpha','2026-11-01'],['Mitte','']])await post('/api/project-work',{kind:'todo',title,due_on});
  async function sort(label){await page.getByRole('textbox',{name:'Sortierung',exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();}
  await page.goto(base+'/p/'+owner+'/eigenleistungen');
  const diy=page.locator('.self-work-card').getByRole('heading');
  await sort('A–Z');await expect(diy).toHaveText(['Alpha','Mitte','Zebra']);
  await sort('Z–A');await expect(diy).toHaveText(['Zebra','Mitte','Alpha']);
  await sort('Neueste zuerst');await expect(diy).toHaveText(['Mitte','Alpha','Zebra']);
  await sort('Älteste zuerst');await expect(diy).toHaveText(['Zebra','Alpha','Mitte']);
  await sort('Höchste Plankosten');await expect(diy).toHaveText(['Alpha','Mitte','Zebra']);
  await page.reload();await expect(diy).toHaveText(['Alpha','Mitte','Zebra']);
  await page.goto(base+'/p/'+owner+'/aufgaben');
  const todoLabels=page.getByRole('checkbox',{name:/To-do abschließen:/});
  const order=()=>todoLabels.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label').replace('To-do abschließen: ','')));
  await sort('A–Z');assert.deepEqual(await order(),['Alpha','Mitte','Zebra']);
  await sort('Neueste zuerst');assert.deepEqual(await order(),['Mitte','Alpha','Zebra']);
  await sort('Älteste zuerst');assert.deepEqual(await order(),['Zebra','Alpha','Mitte']);
  await sort('Fälligkeit');assert.deepEqual(await order(),['Alpha','Zebra','Mitte']);
  await page.getByRole('tab',{name:'Notizen',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Sortierung',exact:true})).toHaveValue('Neueste zuerst');
  await page.goto(base+'/p/'+owner+'/angebote');
  const frame=page.frameLocator('iframe[title="Angebote"]:not([hidden])');
  const ids=()=>frame.locator('#offerList [data-offer-card]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.offerCard)));
  await frame.locator('#offerSort').selectOption('az');assert.deepEqual(await ids(),[offers[1].id,offers[2].id,offers[0].id]);
  await frame.locator('#offerSort').selectOption('newest');assert.deepEqual(await ids(),offers.map(o=>o.id).reverse());
  await frame.locator('#offerSort').selectOption('oldest');assert.deepEqual(await ids(),offers.map(o=>o.id));
  await frame.locator('#offerSort').selectOption('amount-desc');assert.deepEqual(await ids(),[offers[1].id,offers[2].id,offers[0].id]);
  await page.goto(base+'/p/'+owner+'/kosten');
  await page.getByRole('textbox',{name:'Kosten gruppieren',exact:true}).click();await page.getByRole('option',{name:'Firma',exact:true}).click();
  const first=page.locator('tbody tr').first();
  await sort('A–Z');await expect(first).toContainText('Alpha');
  await sort('Z–A');await expect(first).toContainText('Zebra');
  await sort('Älteste zuerst');await expect(first).toContainText('Zebra');
  await sort('Neueste zuerst');await expect(first).toContainText('Nicht zugeordnet');
  await sort('Höchste Prognose');await expect(first).toContainText('Nicht zugeordnet');
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['light','dark']){
   await page.evaluate(mode=>{localStorage.setItem('mantine-color-scheme-value',mode);localStorage.setItem('phb-color-mode-v1',mode);},mode);
   for(const path of ['kosten','aufgaben','eigenleistungen','angebote']){
    await page.goto(base+'/p/'+owner+'/'+path);
    const select=path==='angebote'?frame.locator('#offerSort'):page.getByRole('textbox',{name:'Sortierung',exact:true});
    await expect(select).toBeVisible();
    if(path!=='angebote'){
     const bounds=await select.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=391,'Sortierung muss auf schmalen Bildschirmen passen.');
    }else{
     assert(await select.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}));
     await expect(select).toHaveValue('amount-desc');
    }
   }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS sorting of costs, DIY plans, offers, to-dos and notes; missing due dates and saved selections.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

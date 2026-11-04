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
  const acceptedResponse=await page.request.post(base+'/api/offers/manual',{headers,data:{vendor:'Fachbetrieb für energetische Gebäudesanierung und moderne Haustechnik GmbH',gross:25000,category:'Elektro'}});
  assert(acceptedResponse.ok(),await acceptedResponse.text());const accepted=(await acceptedResponse.json()).id;
  const acceptance=await page.request.patch(base+'/api/offers/'+accepted,{headers,data:{status:'Angenommen'}});assert(acceptance.ok(),await acceptance.text());
  const costs=(await(await page.request.get(base+'/api/costs',{headers})).json()).items;
  const cost=costs.find(item=>item.offer_id===accepted).id;
  for(const number of ['R-100','Rechnung-mit-einem-sehr-langen-Bezeichner-und-vielen-Details-200']){
   const upload=await page.request.post(base+'/api/receipts',{headers,multipart:{analysis_mode:'none',file:{name:number+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n'+number)}}});
   assert(upload.ok(),await upload.text());const rid=(await upload.json()).id;
   const saved=await page.request.patch(base+'/api/receipts/'+rid,{headers,data:{invoice_number:number,supplier:'Fachbetrieb',document_date:'2026-11-04',gross_amount:100,cost_item_id:cost}});
   assert(saved.ok(),await saved.text());
  }
  for(let i=0;i<4;i++){
   const response=await page.request.post(base+'/api/offers/manual',{headers,data:{vendor:'Weiterer Betrieb '+i,gross:100,category:'Elektro'}});assert(response.ok(),await response.text());
  }
  await page.goto(base+'/p/'+owner+'/angebote');
  const frame=page.frameLocator('iframe[title="Angebote"]:not([hidden])');
  await expect(frame.locator('.offers-heading')).toContainText('Erst wenn du');
  await expect(frame.locator('.offers-how,.offers-clarity')).toHaveCount(0);
  await expect(frame.locator('#angebotsliste [data-offer-card]')).toHaveCount(7);
  for(const theme of ['light','dark']){
   await frame.locator('body').evaluate((_,theme)=>window.PHBUI.setTheme(theme),theme);
   for(const width of [1280,820,390]){
    await page.setViewportSize({width,height:1000});
    await expect.poll(()=>frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const tile=frame.locator('#offerList [data-offer-card="'+accepted+'"]');
    const layout=await tile.evaluate(node=>{
     const rect=node.getBoundingClientRect(),header=node.querySelector('.offer-tile-header').getBoundingClientRect(),vendor=node.querySelector('.offer-tile-vendor').getBoundingClientRect(),price=node.querySelector('.offer-tile-price').getBoundingClientRect(),actions=node.querySelector('.offer-tile-actions').getBoundingClientRect();
     const list=node.parentElement;
     return {height:rect.height,headerBottom:header.bottom,vendorTop:vendor.top,vendorHeight:vendor.height,priceBottom:price.bottom,actionsTop:actions.top,actionsBottom:actions.bottom,bottom:rect.bottom,scrolls:list.scrollHeight>list.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert(layout.height<=212,'Kachel soll deutlich kompakter als 280px sein.');
    assert(layout.vendorTop>=layout.headerBottom&&layout.vendorHeight<=40,'Langer Firmenname darf die Kopfaktionen nicht überdecken.');
    assert(layout.actionsBottom<=layout.bottom+1,'Aktionen dürfen nicht abgeschnitten werden.');
    assert(layout.priceBottom<=layout.actionsTop,'Preis darf die Aktionen nicht überdecken.');
    assert(layout.scrolls,'Nach sechs Kacheln soll die Liste scrollen.');assert(!layout.overflow,'Kein horizontaler Seitenüberlauf.');
    await tile.locator('[data-offer-invoices]').click();
    const dialog=frame.locator('#offerInvoicesDialog');await expect(dialog).toBeVisible();
    await expect(dialog.locator('tbody tr')).toHaveCount(2);
    const aligned=await dialog.locator('tbody tr').evaluateAll(rows=>rows.every(row=>{
     const cell=row.lastElementChild,buttons=[...cell.querySelectorAll('a')].map(link=>link.getBoundingClientRect());
     const title=row.querySelector('td strong').getBoundingClientRect(),status=row.children[1].getBoundingClientRect();
     return title.right<=status.left&&getComputedStyle(cell).display==='table-cell'&&Math.abs(buttons[0].top-buttons[1].top)<1&&Math.abs(buttons[0].height-buttons[1].height)<1&&buttons[0].right<=buttons[1].left;
    }));assert(aligned,'Rechnungsaktionen sollen nebeneinander und gleich hoch ausgerichtet sein.');
    if(width===1280)await dialog.screenshot({path:'/tmp/phb-offer-invoices-'+theme+'.png'});
    await dialog.locator('#closeOfferInvoices').click();
   }
   await page.setViewportSize({width:1280,height:1000});
   await frame.locator('#offerList').screenshot({path:'/tmp/phb-offer-tiles-'+theme+'.png'});
  }
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
  console.log('PASS compact offer tiles, six-card scrolling, long vendor names, aligned invoice actions in light/dark and mobile, collapsed comparison and live connection guard.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

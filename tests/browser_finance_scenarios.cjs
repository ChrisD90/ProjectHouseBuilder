/* One sandbox journey: create, edit, allocate, save, clone, compare, isolation. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1600,height:1100}});
 try{
  const base=process.env.PHB_TEST_URL,errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function post(path,data,headers={}){const r=await page.request.post(base+path,{headers,data});assert(r.ok(),await r.text());return r.json();}
  const owner=(await post('/api/projects',{title:'Planspiele'})).project.id,headers={'X-PHB-Project':String(owner)};
  const tour=await(await page.request.get(base+'/api/project-onboarding',{headers})).json();assert((await page.request.put(base+'/api/project-onboarding',{headers,data:{action:'skip',token:tour.token}})).ok());
  await post('/api/financing/loans',{name:'Bankkredit',principal:1000},headers);await post('/api/financing/equity',{name:'Eigenkapital',opening_balance:500,reserve:100},headers);
  const quote=await post('/api/offers/manual',{vendor:'Dachbetrieb',gross:119,net:100,vat:19,category:'Sonstiges'},headers),oid=quote.id;
  assert((await page.request.post(base+'/api/offers/'+oid+'/accept',{headers,form:{confirm:'true',mode:'offer'}})).ok());
  const before=(await(await page.request.get(base+'/api/offers',{headers})).json()).offers;
  await page.goto(base+'/p/'+owner+'/szenarien');await expect(page.getByRole('heading',{name:'Szenarien',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Neues Szenario',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Neues Szenario',exact:true});await dialog.getByRole('textbox').fill('Variante A');await dialog.getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Variante A',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Dachbetrieb Planbetrag',exact:true})).toHaveValue('119');
  await page.getByRole('textbox',{name:'Dachbetrieb Planbetrag',exact:true}).fill('200');
  await page.getByRole('button',{name:'Planposition hinzufügen',exact:true}).click();
  await page.getByRole('textbox',{name:'Planposition',exact:true}).last().fill('Innenausbau');await page.getByRole('textbox',{name:'Innenausbau Planbetrag',exact:true}).fill('300');
  const first=page.locator('.scenario-table tbody tr').first();await first.getByRole('button').first().click();dialog=page.getByRole('dialog',{name:'Dachbetrieb finanzieren',exact:true});
  await dialog.getByRole('textbox',{name:'Planbetrag aus Bankkredit',exact:true}).fill('150');await dialog.getByRole('textbox',{name:'Planbetrag aus Eigenkapital',exact:true}).fill('50');await dialog.getByRole('button',{name:'Übernehmen',exact:true}).click();
  await page.getByRole('textbox',{name:'Reserve (%)',exact:true}).fill('10');
  const save=page.getByRole('button',{name:'Speichern',exact:true});await expect(save).toBeEnabled();await save.click();await expect(page.getByText('Ungespeicherte Änderungen',{exact:true})).toHaveCount(0);
  await page.reload();await expect(page.getByRole('textbox',{name:'Dachbetrieb Planbetrag',exact:true})).toHaveValue('200');
  const listing=await(await page.request.get(base+'/api/finance-scenarios',{headers})).json();assert.equal(listing.scenarios[0].summary.total,550);assert.equal(listing.scenarios[0].summary.credit_remaining,850);assert.equal(listing.scenarios[0].summary.equity_remaining,450);
  await page.getByRole('button',{name:'Duplizieren',exact:true}).click();dialog=page.getByRole('dialog',{name:'Szenario duplizieren',exact:true});await dialog.getByRole('textbox').fill('Variante B');await dialog.getByRole('button',{name:'Bestätigen',exact:true}).click();await expect(page.getByRole('heading',{name:'Variante B',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Dachbetrieb Planbetrag',exact:true}).fill('250');
  await page.getByRole('button',{name:'Szenarien',exact:true}).click();
  const discard=page.getByRole('dialog',{name:'Bitte bestätigen',exact:true});await expect(discard).toContainText('Ungespeicherte Änderungen');await discard.getByRole('button',{name:'Abbrechen',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Dachbetrieb Planbetrag',exact:true})).toHaveValue('250');await expect(save).toBeEnabled();await save.click();await expect(page.getByText('Ungespeicherte Änderungen',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Szenarien',exact:true}).click();await page.getByRole('checkbox',{name:'Variante A vergleichen',exact:true}).check();await page.getByRole('checkbox',{name:'Variante B vergleichen',exact:true}).check();await page.getByRole('button',{name:'Varianten vergleichen',exact:true}).click();await expect(page.getByRole('dialog',{name:'Szenarien vergleichen',exact:true})).toContainText('Innenausbau');await expect(page.getByRole('dialog',{name:'Szenarien vergleichen',exact:true})).toContainText('605,00');
  const after=(await(await page.request.get(base+'/api/offers',{headers})).json()).offers;assert.deepEqual(after,before);assert.deepEqual(errors,[]);
  console.log('PASS scenario creation, plan edits, split funding, reserve, save/reload, cloning, comparison and unchanged real offers.');
 }catch(e){await page.screenshot({path:'/tmp/phb-finance-scenarios-debug.png'});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

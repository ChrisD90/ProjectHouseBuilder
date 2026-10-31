/* Run only against a disposable app DB: PHB_TEST_URL=http://127.0.0.1:5056 node tests/browser_navigation.cjs */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('PHB_TEST_URL must point to a disposable local test database.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),type:r.resourceType()}));
  await page.goto(base+'/');await page.waitForFunction(()=>window.PHBNav&&!PHBNav.diagnostics().navigating&&document.getElementById('count').textContent!=='–');
  await page.locator('#phbCollapse').click();
  await page.evaluate(()=>{window.testSidebar=document.getElementById('phbSidebar');window.testAI=PHBAI;window.testQueue=PHBImports;});
  const initialStatusRequests=requests.filter(r=>r.url.endsWith('/api/ai/status')).length;
  async function go(path){await page.evaluate(p=>PHBNav.visit(p),path);assert.equal(new URL(page.url()).pathname,path);}
  for(let round=0;round<3;round++)for(const path of ['/kosten','/belege','/finanzierung','/angebote','/stammdaten','/dokumente','/daten','/energieplanung','/']){
   if(round===0){await page.locator(`.phb-nav-link[href="${path}"]`).first().click();await page.waitForFunction(p=>location.pathname===p&&!PHBNav.diagnostics().navigating,path);}else await go(path);
   assert(await page.evaluate(()=>testSidebar===document.getElementById('phbSidebar')&&testAI===PHBAI&&testQueue===PHBImports));
   assert(await page.locator('body').evaluate(el=>el.classList.contains('phb-sidebar-collapsed')));
   assert.equal(await page.locator('#phbMain').count(),1);assert.equal(await page.locator('.phb-page-host').count(),1);
  }
  assert.equal(requests.filter(r=>r.type==='document').length,1,'only the initial top-level document loads');
  assert.equal(requests.filter(r=>r.url.endsWith('/api/ai/status')).length,initialStatusRequests,'AI service stays alive');
  await go('/kosten');await go('/belege');await page.goBack();await page.waitForFunction(()=>PHBNav.diagnostics().page==='kosten');
  await page.goForward();await page.waitForFunction(()=>PHBNav.diagnostics().page==='belege');
  // A page-module form stays functional after repeated mount/unmount.
  await go('/');await page.locator('#newTask').click();await page.locator('#taskForm [name=name]').fill('Unsaved browser-test task');
  const attempt=page.evaluate(()=>PHBNav.visit('/kosten'));
  await page.locator('.phb-messagebox').last().getByRole('button',{name:'Abbrechen',exact:true}).click();assert.equal(await attempt,false);
  assert.equal(new URL(page.url()).pathname,'/');assert(await page.locator('#overlay').evaluate(d=>d.open));
  const accepted=page.evaluate(()=>PHBNav.visit('/kosten'));
  await page.locator('.phb-messagebox').last().getByRole('button',{name:'Bestätigen',exact:true}).click();assert.equal(await accepted,true);
  assert.equal(await page.locator('dialog[open]').count(),0);
  // Slow destinations preserve the previous content and sidebar until ready.
  await page.route('**/api/receipts',async route=>{await new Promise(r=>setTimeout(r,350));await route.continue();});
  const slow=page.evaluate(()=>PHBNav.visit('/belege'));await page.waitForTimeout(100);
  assert(await page.locator('.phb-page-host:not([hidden]) #costOverviewRows').count());
  await slow;await page.unroute('**/api/receipts');
  // Failed destinations keep the current view and URL intact.
  await page.route('**/kosten',route=>route.fulfill({status:503,body:'unavailable'}));
  const failed=page.evaluate(()=>PHBNav.visit('/kosten'));await page.locator('.phb-messagebox').last().getByRole('button',{name:'OK',exact:true}).click();
  assert.equal(await failed,false);assert.equal(new URL(page.url()).pathname,'/belege');await page.unroute('**/kosten');
  // A real save after repeated visits must still trigger exactly one mutation.
  await go('/stammdaten');await page.locator('#addCompany').click();
  await page.locator('#companyName').fill('Navigation browser test '+Date.now());
  const beforeWrites=requests.filter(r=>r.url.endsWith('/api/contractors')&&r.type==='fetch').length;
  await page.locator('#saveCompany').click();await page.waitForFunction(()=>!document.getElementById('companyDialog').open);
  const afterWrites=requests.filter(r=>r.url.endsWith('/api/contractors')&&r.type==='fetch').length;
  assert.equal(afterWrites-beforeWrites,1,'exactly one save handler remains');
  await go('/kosten');
  // Dirty-history cancellation restores the prior entry rather than creating a new one.
  await go('/');await page.locator('#newTask').click();await page.locator('#taskForm [name=name]').fill('Dirty history');
  await page.goBack();await page.locator('.phb-messagebox').last().getByRole('button',{name:'Abbrechen',exact:true}).click();
  await page.waitForFunction(()=>location.pathname==='/');assert.equal(new URL(page.url()).pathname,'/');
  assert.deepEqual(errors,[]);
  console.log('PASS: 27 page swaps, persistent services/sidebar, history, dirty forms, slow and failed navigation; no page errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

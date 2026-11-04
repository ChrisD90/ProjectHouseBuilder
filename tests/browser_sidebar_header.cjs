const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const title='Unser Sanierungsprojekt mit einem besonders langen Projektnamen für die Prüfung der Kopfzeile';
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title}})).json()).project.id;
  await page.goto(base+'/');
  await expect(page.getByRole('heading',{name:'Deine Projekte',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Abmelden',exact:true})).toHaveCount(0);
  await page.goto(base+'/p/'+owner+'/');
  const nav=page.locator('#app-navigation'),top=nav.locator('.sidebar-top-actions'),header=page.getByRole('banner');
  const frame=page.frameLocator('iframe[title="Bauzeitenplan"]:not([hidden])');
  await expect(frame.locator('#gantt')).toBeVisible();
  await expect(page.getByRole('button',{name:'Abmelden',exact:true})).toHaveCount(0);
  await expect(frame.locator('form[action="/logout"]')).toHaveCount(0);
  await frame.locator('#gantt').evaluate(()=>window.sidebarSentinel='retained');
  await expect(header.locator('.header-project-title')).toHaveText(title);
  await expect(nav.getByText(title,{exact:true})).toHaveCount(0);
  async function checkControls(){
   await expect.poll(()=>nav.evaluate(n=>Math.abs(n.getBoundingClientRect().x))).toBeLessThan(1);
   const home=await top.getByRole('link',{name:'Alle Projekte',exact:true}).boundingBox();
   const toggle=await top.getByRole('button').boundingBox(),bounds=await nav.boundingBox();
   assert(home&&toggle&&bounds);
   assert(home.x+home.width<=toggle.x&&Math.abs(home.y-toggle.y)<2,'Home und Einklappen müssen in einer Zeile nebeneinander liegen.');
   assert(home.x>=bounds.x-1&&toggle.x+toggle.width<=bounds.x+bounds.width+1,'Die obere Leiste muss in die Sidebar passen: '+JSON.stringify({home,toggle,bounds}));
  }
  await checkControls();
  for(const mode of ['Hell','Dunkel']){
   await header.getByRole('textbox',{name:'Darstellung',exact:true}).click();
   await page.getByRole('option',{name:mode,exact:true}).click();
   await top.getByRole('button',{name:'Sidebar einklappen',exact:true}).click();
   await expect(nav).toHaveAttribute('data-collapsed','true');
   await checkControls();
   await expect(top.getByRole('button',{name:'Sidebar ausklappen',exact:true})).toHaveAttribute('aria-expanded','false');
   const center=await nav.getByRole('link',{name:'Bauzeitenplan',exact:true}).evaluate(n=>{
    const link=n.getBoundingClientRect(),icon=n.querySelector('svg').getBoundingClientRect();return Math.abs(link.x+link.width/2-icon.x-icon.width/2);
   });assert(center<2,'Die Symbole müssen im eingeklappten Menü zentriert sein.');
   await page.screenshot({path:'/tmp/phb-sidebar-'+mode+'-collapsed.png'});
   assert.equal(await frame.locator('#gantt').evaluate(()=>window.sidebarSentinel),'retained');
   await nav.getByRole('link',{name:'Kosten & Budget',exact:true}).click();
   await nav.getByRole('link',{name:'Bauzeitenplan',exact:true}).click();
   await expect(frame.locator('#gantt')).toBeVisible();
   assert.equal(await frame.locator('#gantt').evaluate(()=>window.sidebarSentinel),'retained');
   await expect(nav).toHaveAttribute('data-collapsed','true');
   await top.getByRole('button',{name:'Sidebar ausklappen',exact:true}).click();
   await expect(nav).toHaveAttribute('data-collapsed','false');await checkControls();
   const logo=await header.locator('.brand-logo:visible').boundingBox(),name=await header.locator('.header-project-title').boundingBox();
   assert(logo.width>200&&name.x>=logo.x+logo.width,'Größeres Logo und Projektname müssen nebeneinander stehen.');
   await page.screenshot({path:'/tmp/phb-sidebar-'+mode+'-expanded.png'});
  }
  await top.getByRole('button',{name:'Sidebar einklappen',exact:true}).click();
  await page.reload();await expect(nav).toHaveAttribute('data-collapsed','true');
  for(const width of [768,390,320]){
   await page.setViewportSize({width,height:844});
   await expect(header.locator('.header-project-title')).toBeVisible();
   const titleBox=await header.locator('.header-project-title').boundingBox(),actions=await header.locator('.app-header-actions').boundingBox();
   assert(titleBox.x+titleBox.width<=actions.x+1,'Projektname und Header-Aktionen dürfen sich nicht überlagern.');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Kein horizontaler Überlauf der Anwendung.');
   if(width<768){
    await page.getByRole('button',{name:'Navigation öffnen',exact:true}).click();
    await checkControls();
    await top.getByRole('button',{name:'Navigation schließen',exact:true}).click();
    await expect(page.getByRole('button',{name:'Navigation öffnen',exact:true})).toBeVisible();
    await expect.poll(()=>nav.evaluate(n=>n.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
   }
   await page.screenshot({path:'/tmp/phb-sidebar-width-'+width+'.png'});
  }
  await page.setViewportSize({width:1280,height:900});
  await top.getByRole('link',{name:'Alle Projekte',exact:true}).click();
  await expect(page).toHaveURL(base+'/');
  await expect(page.getByRole('heading',{name:'Deine Projekte',exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('PASS top sidebar controls, header project identity, centered collapsed icons, persistent navigation, light/dark and mobile layouts.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

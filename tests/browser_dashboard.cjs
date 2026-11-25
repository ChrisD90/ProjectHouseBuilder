/* One focused flow: customize -> move/resize -> save/reload/discard -> direct task action. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1440,height:1050}}),base=process.env.PHB_TEST_URL,errors=[];page.on('pageerror',e=>errors.push(e.message));
 const project=await page.request.post(base+'/api/projects',{data:{title:'Dashboard Prüfung'}}),owner=(await project.json()).project.id,headers={'X-PHB-Project':String(owner)};
 const todoResponse=await page.request.post(base+'/api/project-work',{headers,data:{kind:'todo',title:'Baustelle prüfen',body:'Details'}});assert.equal(todoResponse.status(),201,await todoResponse.text());
 const getLayout=async()=>{const r=await page.request.get(base+'/api/dashboard/layout',{headers});assert(r.ok(),await r.text());return r.json();};
 await page.goto(base+'/p/'+owner+'/uebersicht');await expect(page.getByRole('heading',{name:'Projektübersicht',exact:true})).toBeVisible();await expect(page.locator('[data-widget="todos"]').getByText('Baustelle prüfen')).toBeVisible();
 await page.getByRole('button',{name:'Übersicht anpassen',exact:true}).click();
 await page.getByRole('button',{name:'Kachel hinzufügen',exact:true}).click();const catalog=page.getByRole('dialog',{name:'Kachelkatalog',exact:true});
 await catalog.getByRole('textbox',{name:'Kachel suchen',exact:true}).fill('Eigene Kennzahl');await catalog.getByRole('button',{name:'Hinzufügen',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Kachel einstellen',exact:true});await settings.getByRole('textbox',{name:'Titel',exact:true}).fill('Meine offenen Aufgaben');
 await settings.getByRole('textbox',{name:'Status',exact:true}).click();await page.getByRole('option',{name:'Offen',exact:true}).click();
 await settings.getByRole('button',{name:'Übernehmen',exact:true}).click();
 const events=page.locator('[data-widget="events"]'),grip=events.getByRole('button',{name:'Verschieben: Nächste Termine',exact:true}),before=await events.boundingBox();
 // Real pointer drag through collision handling, with the app's global 80% density.
 const handle=await grip.boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+80,handle.y+handle.height/2+94,{steps:8});await page.mouse.up();
 const after=await events.boundingBox();assert(after.y>before.y+50,'Drag must snap to another row');
 const resize=events.getByRole('button',{name:'Kachelgröße ändern (Pfeiltasten)',exact:true});await resize.focus();await resize.press('ArrowLeft');await resize.press('ArrowLeft');await resize.press('ArrowLeft');
 await page.getByRole('button',{name:'Speichern',exact:true}).click();await expect(page.getByRole('button',{name:'Übersicht anpassen',exact:true})).toBeVisible();
 const saved=await getLayout(),eventConfig=saved.layout.widgets.find(w=>w.type==='events');assert.equal(eventConfig.w,4);assert(eventConfig.y>=1);assert(saved.layout.widgets.some(w=>w.config.title==='Meine offenen Aufgaben'));
 await page.reload();await expect(page.getByText('Meine offenen Aufgaben',{exact:true})).toBeVisible();await expect(page.locator('[data-widget="metric"] .dashboard-value')).toHaveText('1');
 await page.getByRole('button',{name:'Übersicht anpassen',exact:true}).click();await page.locator('[data-widget="metric"]').getByRole('button',{name:'Kachel entfernen',exact:true}).click();await page.getByRole('button',{name:'Verwerfen',exact:true}).click();assert.deepEqual(await getLayout(),saved);await expect(page.getByText('Meine offenen Aufgaben',{exact:true})).toBeVisible();
 await page.locator('[data-widget="todos"]').getByRole('checkbox',{name:'Erledigen: Baustelle prüfen',exact:true}).click();await expect(page.locator('[data-widget="metric"] .dashboard-value')).toHaveText('0');
 // Both the custom open-only metric and the direct-action task card refresh.
 await expect(page.locator('[data-widget="todos"]').getByText('Baustelle prüfen')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await expect(page.locator('[data-widget="metric"]')).toBeVisible();const widgets=await page.locator('.dashboard-widget').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,parent:n.parentElement.getBoundingClientRect().width})));assert(widgets.every(x=>x.w<=x.parent+1));
 assert.deepEqual(errors,[]);console.log('PASS project dashboard add, pointer drag, collision placement, minimum resize, save/reload/discard, live task completion and narrow layout.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

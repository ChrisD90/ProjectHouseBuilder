/* One shared-photo workflow, including native/classic editors and stacked dialogs. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1440,height:1050}}),base=process.env.PHB_TEST_URL,errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function post(url,data,headers={}){const r=await page.request.post(base+url,{headers,data});assert(r.ok(),await r.text());return r.json();}
 const owner=(await post('/api/projects',{title:'Foto Projekt'})).project.id,headers={'X-PHB-Project':String(owner)};
 const state=await (await page.request.get(base+'/api/project-onboarding',{headers})).json();assert((await page.request.put(base+'/api/project-onboarding',{headers,data:{action:'skip',token:state.token}})).ok());
 const note=(await post('/api/project-work',{kind:'note',title:'Baustellennotiz',body:'Notiz mit gemeinsamem Foto'},headers)).item;
 const journal=(await post('/api/companion/records',{kind:'journal',title:'Rohbau im Tagebuch'},headers)).record;
 const offer=(await post('/api/offers/manual',{vendor:'Fotobetrieb',gross:119,net:100,vat:19,category:'Sonstiges'},headers)).offer;
 await page.goto(base+'/p/'+owner+'/fotos');await expect(page.getByRole('heading',{name:'Fotobibliothek',exact:true})).toBeVisible();
 await page.locator('input[type=file]').setInputFiles({name:'Rohbau.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(__dirname,'fixtures/project-photo.png'))});
 await page.getByRole('button',{name:'Foto öffnen: Rohbau.png',exact:true}).click();const detail=page.getByRole('dialog',{name:'Foto',exact:true});await expect(detail).toBeVisible();
 await detail.getByRole('textbox',{name:'Titel',exact:true}).fill('Leitungen vor dem Verputzen');const tag=detail.getByRole('textbox',{name:'Tags',exact:true});await tag.fill('Elektrik');await tag.press('Enter');
 const select=detail.getByRole('textbox',{name:'Weitere Einträge auswählen',exact:true});
 for(const label of ['Notiz · Baustellennotiz','Rohbau im Tagebuch','Angebot · Fotobetrieb']){await select.fill(label);await page.getByRole('option',{name:label,exact:true}).click();}
 await select.press('Tab');
 await detail.getByRole('button',{name:'Verknüpfungen hinzufügen',exact:true}).click();await expect(detail.getByRole('button',{name:'Verknüpfung lösen: Notiz · Baustellennotiz',exact:true})).toBeVisible();
 await detail.getByRole('button',{name:'Speichern',exact:true}).click();await expect(detail.getByRole('button',{name:'Speichern',exact:true})).toBeDisabled();await detail.getByRole('button',{name:'Schließen',exact:true}).last().click();
 const card=page.getByRole('button',{name:'Foto öffnen: Leitungen vor dem Verputzen',exact:true});await expect(card).toBeVisible();await expect.poll(()=>card.locator('img').evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
 await page.getByRole('textbox',{name:'Fotos suchen',exact:true}).fill('Elektrik');await expect(card).toBeVisible();
 await page.goto(base+'/p/'+owner+'/aufgaben?work_id='+note.id);const noteEditor=page.getByRole('dialog',{name:'Notiz bearbeiten',exact:true});await noteEditor.getByRole('button',{name:'Fotos anzeigen · 1',exact:true}).click();
 let gallery=page.getByRole('dialog',{name:'Verknüpfte Fotos',exact:true});await expect(gallery).toBeVisible();await gallery.getByRole('button',{name:'Foto öffnen: Leitungen vor dem Verputzen',exact:true}).click();await expect(detail).toBeVisible();await detail.getByRole('button',{name:'Schließen',exact:true}).last().click();await expect(gallery).toBeVisible();await expect(noteEditor).toBeVisible();
 await gallery.getByRole('button',{name:'Hier lösen',exact:true}).click();await expect(gallery.getByRole('button',{name:'Foto öffnen: Leitungen vor dem Verputzen',exact:true})).toHaveCount(0);
 let photos=await (await page.request.get(base+'/api/photos',{headers})).json();assert.equal(photos.photos.length,1);assert.equal(photos.photos[0].links.length,2);assert(photos.photos[0].links.some(x=>x.type==='offer'));assert(photos.photos[0].links.some(x=>x.type==='companion'));
 await gallery.getByRole('textbox',{name:'Bildgröße beim Upload',exact:true}).click();await page.getByRole('option',{name:'Komprimiert speichern',exact:true}).click();
 await gallery.locator('input[type=file]').setInputFiles({name:'Direkt-bei-Notiz.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(__dirname,'fixtures/project-photo.png'))});
 await expect.poll(async()=>{const result=await (await page.request.get(base+'/api/photos?source_type=work&source_id='+note.id,{headers})).json();return result.photos?.length||0;}).toBe(1);
 const direct=(await (await page.request.get(base+'/api/photos?source_type=work&source_id='+note.id,{headers})).json()).photos[0];assert(direct.filename.startsWith('Direkt-bei-Notiz'));await expect(gallery.getByRole('button',{name:'Foto öffnen: '+direct.title,exact:true})).toBeVisible();
 await gallery.getByRole('button',{name:'Schließen',exact:true}).last().click();await noteEditor.getByRole('button',{name:'Schließen',exact:true}).last().click();
 await page.goto(base+'/p/'+owner+'/angebote/'+offer.id);const frame=page.frameLocator('iframe[title="Angebotsdetails"]:not([hidden])');await expect(frame.getByRole('button',{name:'Fotos anzeigen · 1',exact:true})).toBeVisible();await frame.getByRole('button',{name:'Fotos anzeigen · 1',exact:true}).evaluate(n=>n.click());
 gallery=page.getByRole('dialog',{name:'Verknüpfte Fotos',exact:true});await expect(gallery.getByRole('button',{name:'Foto öffnen: Leitungen vor dem Verputzen',exact:true})).toBeVisible();await gallery.getByRole('button',{name:'Schließen',exact:true}).last().click();assert.deepEqual(errors,[]);
 console.log('PASS one original, tag search, multiple object links, stacked photo dialogs, unlink without losing other links, and identical offer gallery via classic bridge.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

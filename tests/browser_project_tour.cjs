/* First project opening -> folder setup -> finish -> replay/skip, isolated data only. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),'phb-tour-inbox-')),browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1280,height:1000}}),base=process.env.PHB_TEST_URL,errors=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.request.post(base+'/api/projects',{data:{title:'Tour Projekt'}});assert.equal(response.status(),201,await response.text());const owner=(await response.json()).project.id,headers={'X-PHB-Project':String(owner)};
 const state=async()=>(await page.request.get(base+'/api/project-onboarding',{headers})).json();
 await page.goto(base+'/p/'+owner+'/uebersicht');let dialog=page.getByRole('dialog',{name:'Willkommen in deinem Projekt',exact:true});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Weiter',exact:true}).click();dialog=page.getByRole('dialog',{name:'Dein Arbeitsablauf',exact:true});await dialog.getByRole('button',{name:'Weiter',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Dokumenteneingang einrichten',exact:true});await expect(dialog).toBeVisible();
 await page.reload();await expect(dialog).toBeVisible();assert.equal((await state()).step,2);
 await page.route('**/api/document-inbox/native-folder',route=>route.fulfill({json:{cancelled:false,folder}}));
 await dialog.getByRole('button',{name:'Ordner auswählen',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'Eingangsordner für dieses Projekt',exact:true})).toHaveValue(folder);
 await dialog.getByRole('button',{name:'Ordner speichern & weiter',exact:true}).click();dialog=page.getByRole('dialog',{name:'Sicherungen einrichten',exact:true});await expect(dialog).toBeVisible();
 const config=(await (await page.request.get(base+'/api/document-inbox',{headers})).json()).config;assert.equal(config.folder,folder);assert.equal(config.interval_minutes,10);
 await expect(dialog.getByRole('checkbox',{name:'Sicherungsziel ändern (für alle Projekte)',exact:true})).not.toBeChecked();
 const backupBefore=await (await page.request.get(base+'/api/backup/status',{headers})).json();
 await dialog.getByRole('button',{name:'Weiter',exact:true}).click();dialog=page.getByRole('dialog',{name:'Bereit für dein Projekt',exact:true});await dialog.getByRole('button',{name:'Zur Projektübersicht',exact:true}).click();await expect(dialog).not.toBeVisible();assert.equal((await state()).status,'completed');
 assert.equal((await (await page.request.get(base+'/api/backup/status',{headers})).json()).relative_folder,backupBefore.relative_folder);
 await page.reload();await expect(page.getByRole('dialog',{name:'Willkommen in deinem Projekt',exact:true})).toHaveCount(0);
 await page.goto(base+'/p/'+owner+'/system');await page.getByRole('button',{name:'Projekttour starten',exact:true}).click();dialog=page.getByRole('dialog',{name:'Willkommen in deinem Projekt',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Tour überspringen',exact:true}).click();await expect(dialog).not.toBeVisible();assert.equal((await state()).status,'skipped');
 await page.reload();await expect(dialog).toHaveCount(0);assert.deepEqual(errors,[]);console.log('PASS tour first-open, resume, real inbox setup, unchanged global backup target, completion, replay and persistent skip.');
}finally{await browser.close();fs.rmSync(folder,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exit(1)});

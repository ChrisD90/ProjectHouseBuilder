const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=process.env.PHB_TEST_URL;
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'phb-inbox-browser-'));
 const write=(name,text)=>{const file=path.join(folder,name);fs.writeFileSync(file,text);const past=new Date(Date.now()-60000);fs.utimesSync(file,past,past);};
 write('Rechnung.pdf','%PDF-1.4\nRechnung Eingang');write('Bon.pdf','%PDF-1.4\nBon Eingang');write('Grundriss.txt','Projektplan im Original');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'de-DE',viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Dokumenteneingang prüfen'}})).json()).project.id,headers={'X-PHB-Project':String(owner)};
  const trigger=()=>page.getByRole('button',{name:/^Dokumenteneingang(?::|$)/});
  const inbox=page.getByRole('dialog',{name:'Dokumenteneingang',exact:true}),settings=page.getByRole('dialog',{name:'Dokumenteneingang einstellen',exact:true}),classify=page.getByRole('dialog',{name:'Dokument zuordnen',exact:true});
  async function choose(dialog,label,option){await dialog.getByRole('textbox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
  await page.goto(base+'/p/'+owner+'/kosten');await trigger().click();await inbox.getByRole('button',{name:'Ordner einrichten',exact:true}).click();
  await settings.getByRole('textbox',{name:'Eingangsordner',exact:true}).fill(folder);await settings.getByRole('button',{name:'Speichern',exact:true}).click();await expect(settings).toBeHidden();
  await expect(trigger()).toHaveAccessibleName('Dokumenteneingang: 3');assert.equal((await(await page.request.get(base+'/api/import-jobs',{headers})).json()).jobs.length,0);
  await inbox.getByRole('button',{name:'Dokument zuordnen: Rechnung.pdf',exact:true}).click();await choose(classify,'Dokumenttyp','Rechnung');await choose(classify,'Analyse','Ohne Analyse als Entwurf speichern');await classify.getByRole('button',{name:'Verarbeitung starten',exact:true}).click();
  const frame=page.frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])');await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible({timeout:30000});await frame.locator('#closeReceiptWorkflow').click();await expect(frame.locator('#receiptWorkflowDialog')).toBeHidden();
  await trigger().click();await expect(trigger()).toHaveAccessibleName('Dokumenteneingang: 2');assert(fs.existsSync(path.join(folder,'Rechnung.pdf')));
  await inbox.getByRole('button',{name:'Dokument zuordnen: Bon.pdf',exact:true}).click();await choose(classify,'Dokumenttyp','Kassenzettel');await choose(classify,'Analyse','Ohne Analyse als Entwurf speichern');await choose(classify,'Verarbeitung','Im Hintergrund – später prüfen');await classify.getByRole('button',{name:'Verarbeitung starten',exact:true}).click();await expect(classify).toBeHidden();await expect(inbox).toBeHidden();
  await expect.poll(async()=>{const rows=(await(await page.request.get(base+'/api/receipts',{headers})).json()).receipts;return rows.some(row=>(row.filename==='Bon.pdf'||row.original_name==='Bon.pdf')&&row.kind==='Kassenzettel');},{timeout:30000}).toBe(true);
  await trigger().click();await inbox.getByRole('button',{name:'Dokument zuordnen: Grundriss.txt',exact:true}).click();await choose(classify,'Dokumenttyp','Projektunterlage');await classify.getByRole('button',{name:'Verarbeitung starten',exact:true}).click();
  const doc=page.getByRole('dialog',{name:'Dokument pflegen',exact:true});await expect(doc).toBeVisible({timeout:30000});await doc.getByRole('button',{name:'Schließen',exact:true}).click();
  write('Neu.txt','Neue Unterlage');await trigger().click();await inbox.getByRole('button',{name:'Jetzt prüfen',exact:true}).click();await expect(trigger()).toHaveAccessibleName('Dokumenteneingang: 1');
  await inbox.getByRole('button',{name:'Aus Eingang ausblenden: Neu.txt',exact:true}).click();await expect(trigger()).toHaveAccessibleName('Dokumenteneingang');await inbox.getByRole('checkbox',{name:'Ausgeblendete anzeigen',exact:true}).check();await inbox.getByRole('button',{name:'Wieder anzeigen: Neu.txt',exact:true}).click();await expect(trigger()).toHaveAccessibleName('Dokumenteneingang: 1');
  await inbox.getByRole('button',{name:'Schließen',exact:true}).click();await page.locator('#app-navigation').getByRole('link',{name:'Daten & Sicherung',exact:true}).click();const dataFrame=page.frameLocator('iframe[title="Daten & Sicherung"]:not([hidden])');await dataFrame.locator('#documentInboxSettings').click();await expect(settings).toBeVisible();await expect(settings.getByRole('textbox',{name:'Eingangsordner',exact:true})).toHaveValue(folder);await settings.getByRole('button',{name:'Schließen',exact:true}).click();
  await page.getByRole('banner').getByRole('textbox',{name:'Darstellung',exact:true}).click();await page.getByRole('option',{name:'Dunkel',exact:true}).click();await trigger().click();await expect.poll(()=>inbox.evaluate(n=>getComputedStyle(n).opacity)).toBe('1');await page.screenshot({path:'/tmp/phb-inbox-dark.png'});await inbox.getByRole('button',{name:'Schließen',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThan(2);await trigger().click();await expect.poll(()=>inbox.evaluate(n=>getComputedStyle(n).opacity)).toBe('1');await page.screenshot({path:'/tmp/phb-inbox-mobile.png'});await inbox.getByRole('button',{name:'Schließen',exact:true}).click();
  const other=(await(await page.request.post(base+'/api/projects',{data:{title:'Ohne Eingang'}})).json()).project.id;await page.goto(base+'/p/'+other+'/kosten');await trigger().click();await expect(inbox).toContainText('Noch kein Eingangsordner für dieses Projekt eingerichtet.');
  assert.deepEqual(errors,[]);console.log('PASS watched-folder settings, counter, explicit classification, standard foreground/background receipt/document flows, originals, hide/restore, settings entry, dark/mobile and project isolation.');
 }finally{await browser.close();fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

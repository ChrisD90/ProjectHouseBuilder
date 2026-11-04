/* Disposable project: legacy rows open their own details and require confirmed cleanup. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Altplan-Test'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  const made=await page.request.post(base+'/api/budget/lines',{headers,data:{title:'Architektenplan Altbestand',category:'Sonstiges',estimate:1234,kind:'Fremdleistung'}});
  assert.equal(made.status(),200,await made.text());
  await page.goto(base+'/p/'+owner+'/kosten');
  await page.getByRole('button',{name:'Alte Planpositionen bereinigen',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Alte Kostenplanung bereinigen',exact:true});
  await expect(dialog.getByText('Architektenplan Altbestand',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Prüfen',exact:true}).click();
  await expect(dialog.getByText('Keine Verknüpfungen mehr vorhanden.')).toBeVisible();
  await dialog.getByRole('button',{name:'Position löschen',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'Bitte bestätigen',exact:true});
  await confirm.getByRole('button',{name:'Abbrechen',exact:true}).click();
  await expect(dialog).toBeVisible();
  assert.equal((await(await page.request.get(base+'/api/cost-dashboard/legacy',{headers})).json()).rows.length,1);
  await dialog.getByRole('button',{name:'Position löschen',exact:true}).click();
  await confirm.getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  assert.equal((await(await page.request.get(base+'/api/cost-dashboard/legacy',{headers})).json()).rows.length,0);
  assert.equal(new URL(page.url()).pathname,'/p/'+owner+'/kosten');
  console.log('PASS legacy cost details, mobile dialog, cancellation, confirmed deletion and overview refresh without offer navigation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

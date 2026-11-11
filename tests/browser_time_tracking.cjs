const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'de-DE',viewport:{width:1440,height:1000}}),errors=[];
  page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Stundenprojekt'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  await page.request.post(base+'/api/contractors',{headers,data:{name:'Planungsbüro Beispiel',trade:'Sonstiges'}});
  await page.goto(base+'/p/'+owner+'/stunden');
  await expect(page.getByRole('heading',{name:'Stundenerfassung',exact:true})).toBeVisible();
  await expect(page.locator('#app-navigation').getByRole('link',{name:'Stundenerfassung',exact:true})).toBeVisible();
  const add=page.getByRole('button',{name:'Person oder Firma hinzufügen',exact:true});
  async function choose(dialog,label,option){await dialog.getByRole('textbox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
  await add.click();let edit=page.getByRole('dialog',{name:'Person oder Firma hinzufügen',exact:true});
  await edit.getByRole('textbox',{name:'Name',exact:true}).fill('Anna Helferin');
  await edit.getByRole('textbox',{name:'Rolle (optional)',exact:true}).fill('Helferin');
  await choose(edit,'Firma aus Stammdaten (optional)','Planungsbüro Beispiel');
  await edit.getByRole('button',{name:'Speichern',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Anna Helferin',exact:true});await expect(detail).toBeVisible();
  await detail.getByRole('button',{name:'Stunden erfassen',exact:true}).click();
  let entry=page.getByRole('dialog',{name:'Stunden erfassen',exact:true});
  await entry.locator('input[type=date]').fill('2026-11-11');
  await entry.getByRole('textbox',{name:'Stunden',exact:true}).fill('2');await entry.getByRole('textbox',{name:'Minuten',exact:true}).fill('30');
  await entry.getByRole('textbox',{name:'Tätigkeit (optional)',exact:true}).fill('Wände vorbereiten');
  await entry.getByRole('button',{name:'Speichern',exact:true}).click();await expect(entry).toBeHidden();
  await expect(detail).toContainText('2 Std. 30 Min.');await expect(detail).toContainText('Wände vorbereiten');
  await detail.getByRole('button',{name:/^Stundeneintrag bearbeiten:/}).click();
  entry=page.getByRole('dialog',{name:'Stundeneintrag bearbeiten',exact:true});
  await entry.getByRole('textbox',{name:'Stunden',exact:true}).fill('3');await entry.getByRole('textbox',{name:'Minuten',exact:true}).fill('15');
  await entry.getByRole('button',{name:'Speichern',exact:true}).click();await expect(entry).toBeHidden();await expect(detail).toContainText('3 Std. 15 Min.');
  await detail.getByRole('button',{name:'Stunden erfassen',exact:true}).click();entry=page.getByRole('dialog',{name:'Stunden erfassen',exact:true});
  await entry.locator('input[type=date]').fill('2026-11-11');await entry.getByRole('textbox',{name:'Stunden',exact:true}).fill('24');
  await entry.getByRole('button',{name:'Speichern',exact:true}).click();await expect(entry).toContainText('mehr als 24 Stunden');
  await expect(entry.getByRole('textbox',{name:'Stunden',exact:true})).toHaveValue('24');
  await entry.getByRole('button',{name:'Schließen',exact:true}).click();
  await page.getByRole('dialog',{name:'Bitte bestätigen',exact:true}).getByRole('button',{name:'Bestätigen',exact:true}).click();await expect(detail).toBeVisible();
  await detail.getByRole('button',{name:'Schließen',exact:true}).click();
  const tile=page.getByRole('button',{name:'Stunden anzeigen: Anna Helferin',exact:true});await expect(tile).toContainText('3 Std. 15 Min.');
  const bounds=await tile.boundingBox();await tile.click({position:{x:8,y:bounds.height-8}});await expect(detail).toBeVisible();
  await detail.getByRole('button',{name:'Person oder Firma bearbeiten',exact:true}).click();edit=page.getByRole('dialog',{name:'Person oder Firma bearbeiten',exact:true});
  await edit.getByRole('textbox',{name:'Notizen (optional)',exact:true}).fill('Helferin für Innenausbau');await edit.getByRole('button',{name:'Speichern',exact:true}).click();await expect(edit).toBeHidden();await expect(detail).toContainText('Helferin für Innenausbau');
  await detail.getByRole('button',{name:'Schließen',exact:true}).click();
  await add.click();edit=page.getByRole('dialog',{name:'Person oder Firma hinzufügen',exact:true});
  await choose(edit,'Erfassen für','Firma aus Stammdaten');await choose(edit,'Firma aus Stammdaten','Planungsbüro Beispiel');await edit.getByRole('button',{name:'Speichern',exact:true}).click();
  const company=page.getByRole('dialog',{name:'Planungsbüro Beispiel',exact:true});await expect(company).toBeVisible();
  await company.getByRole('button',{name:'Stunden erfassen',exact:true}).click();entry=page.getByRole('dialog',{name:'Stunden erfassen',exact:true});
  await entry.locator('input[type=date]').fill('2026-11-10');await entry.getByRole('textbox',{name:'Minuten',exact:true}).fill('45');await entry.getByRole('button',{name:'Speichern',exact:true}).click();await expect(entry).toBeHidden();
  await expect(company).toContainText('1 Std. 45 Min.');await company.getByRole('button',{name:'Schließen',exact:true}).click();
  await page.getByRole('textbox',{name:'Person oder Firma suchen',exact:true}).fill('Anna');await expect(page.locator('.time-person-card')).toHaveCount(1);await page.getByRole('textbox',{name:'Person oder Firma suchen',exact:true}).fill('');
  await page.reload();await expect(page.getByRole('button',{name:'Stunden anzeigen: Anna Helferin',exact:true})).toContainText('3 Std. 15 Min.');
  for(const mode of ['Hell','Dunkel']){
   await page.getByRole('banner').getByRole('textbox',{name:'Darstellung',exact:true}).click();await page.getByRole('option',{name:mode,exact:true}).click();
   await page.screenshot({path:'/tmp/phb-hours-'+mode+'.png'});
  }
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThan(2);
  await page.getByRole('button',{name:'Stunden anzeigen: Anna Helferin',exact:true}).click();await expect(detail).toBeVisible();await expect.poll(()=>detail.evaluate(node=>getComputedStyle(node).opacity)).toBe('1');await page.screenshot({path:'/tmp/phb-hours-mobile-detail.png'});
  await detail.getByRole('button',{name:/^Stundeneintrag löschen:/}).click();await page.getByRole('dialog',{name:'Bitte bestätigen',exact:true}).getByRole('button',{name:'Bestätigen',exact:true}).click();await expect(detail).toContainText('0 Std.');
  await detail.getByRole('button',{name:'Person oder Firma löschen',exact:true}).click();await page.getByRole('dialog',{name:'Bitte bestätigen',exact:true}).getByRole('button',{name:'Bestätigen',exact:true}).click();await expect(detail).toBeHidden();
  await expect(page.locator('.time-person-card')).toHaveCount(1);
  const other=(await(await page.request.post(base+'/api/projects',{data:{title:'Ohne Stunden'}})).json()).project.id;
  await page.goto(base+'/p/'+other+'/stunden');await expect(page.getByRole('heading',{name:'Stundenerfassung',exact:true})).toBeVisible();await expect(page.locator('.time-person-card')).toHaveCount(0);
  assert.deepEqual(errors,[]);console.log('PASS people/company cards, minute totals, stacked time entry editors, validation/retained inputs, edit/delete, persistence, themes, mobile and project isolation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

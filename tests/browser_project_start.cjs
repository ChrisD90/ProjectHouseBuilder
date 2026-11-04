/* Isolated UI check: blur, cancellation and signed calendar-day shifts. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'de-DE'});
  const created=await page.request.post(base+'/api/projects',{data:{title:'Projektstart-Prüfung',start_date:'2028-02-25'}});
  const owner=(await created.json()).project.id,headers={'X-PHB-Project':String(owner)};
  const phase=await page.request.post(base+'/api/phases',{headers,data:{title:'Ausführung',start_date:'2028-02-27',end_date:'2028-03-08'}});
  const phaseID=(await phase.json()).phase.id;
  for(const [code,phase_id] of [['T-1',phaseID],['T-2',null]]){
   const result=await page.request.post(base+'/api/tasks',{headers,data:{code,name:'Paket '+code,phase_id,trade:'Sonstiges',execution_type:'Noch offen',duration:3,planned_end:'2028-03-12'}});
   assert.equal(result.status(),201,await result.text());
  }
  const read=async()=>await(await page.request.get(base+'/api/project',{headers})).json();
  const before=await read();
  await page.goto(base+'/p/'+owner+'/');
  const frame=page.frameLocator('iframe[title="Bauzeitenplan"]'),input=frame.locator('#projectStart'),popup=frame.locator('dialog.phb-messagebox');
  await expect(input).toHaveValue('2028-02-25');
  await input.fill('2028-03-08');
  await expect(popup).toHaveCount(0);
  await input.blur();
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('12 Tage nach hinten verschoben (+12 Tage)');
  await expect(popup).toContainText('Ist-Termine und Abschlussdaten bleiben erhalten');
  await popup.getByRole('button',{name:'Abbrechen',exact:true}).click();
  await expect(input).toHaveValue('2028-02-25');
  assert.deepEqual((await read()).tasks,before.tasks);
  await input.fill('2028-03-08');await input.blur();
  await popup.getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(frame.locator('#projectStartStatus')).toHaveText('Projektstart gespeichert.');
  await expect(input).toHaveValue('2028-03-08');
  const shifted=await read(),add=(value,n)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  for(const field of ['start_date','end_date'])assert.equal(shifted.phases[0][field],add(before.phases[0][field],12));
  for(let i=0;i<before.tasks.length;i++)for(const field of ['start','end','planned_end'])assert.equal(shifted.tasks[i][field],add(before.tasks[i][field],12));
  await expect(input).toBeEnabled();
  await input.fill('2028-02-25');await input.blur();
  await expect(popup).toContainText('12 Tage nach vorne verschoben (-12 Tage)');
  await popup.getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect.poll(async()=>(await read()).start).toBe('2028-02-25');
  assert.deepEqual((await read()).tasks,before.tasks);
  console.log('PASS project start confirms only on blur; cancel preserves dates; phases and assigned/unassigned tasks shift by the exact signed delta across leap day.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

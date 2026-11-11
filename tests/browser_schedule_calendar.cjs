/* Calendar projections use the same persisted tasks, dependency checks and stacked editors. */
require('./schedule_calendar_model.cjs');
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict'),M=require('../static/schedule_calendar_model.js');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'de-DE',viewport:{width:1520,height:1100}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const now=new Date().toLocaleDateString('sv-SE'),start=M.monday(now);
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Kalenderprüfung',start_date:M.add(start,-70)}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  async function post(path,data){const result=await page.request.post(base+path,{headers,data});assert(result.ok(),await result.text());return result.json();}
  const phase=(await post('/api/phases',{title:'Ausführung mit mehreren Arbeitspaketen',start_date:start,end_date:M.add(start,20)})).phase;
  const company=(await post('/api/contractors',{name:'Elektro Kalender',trade:'Elektro'})).contractor;
  const add=async(code,extra={})=>(await post('/api/tasks',{code,name:'Arbeitspaket '+code,trade:'Sonstiges',execution_type:'Noch offen',duration:2,earliest_start:start,...extra})).id;
  const main=await add('K-1',{name:'Elektroinstallation',phase_id:phase.id,trade:'Elektro',execution_type:'Fremdleistung',contractor_id:company.id,duration:3,planned_end:M.add(start,12)});
  const next=await add('K-2',{name:'Nachfolgeprüfung',phase_id:phase.id,predecessors:['K-1'],duration:2});
  const done=await add('K-3',{name:'Erledigtes Paket',status:'Erledigt'});
  const overdue=await add('K-4',{name:'Überfälliges Paket',planned_end:M.add(now,-1)});
  const running=await add('K-5',{name:'Lange laufendes Paket',status:'In Arbeit',earliest_start:M.add(start,-60)});
  for(let n=6;n<=11;n++)await add('K-'+n,{name:'Paralleles Paket '+n,duration:7});
  const read=async()=>await(await page.request.get(base+'/api/project',{headers})).json();
  await page.goto(base+'/p/'+owner+'/');
  let frame=page.frameLocator('iframe[title="Bauzeitenplan"]');
  const event=id=>frame.locator('.schedule-calendar-event[data-calendar-task="'+id+'"]'),popup=()=>frame.locator('dialog.phb-messagebox');
  await expect(frame.locator('[data-schedule-view=week]')).toHaveAttribute('aria-pressed','true');
  await expect(event(main)).toBeVisible();
  await expect(event(main)).toContainText('Elektro Kalender');
  await expect(event(overdue)).toHaveClass(/overdue/);await expect(event(done)).toHaveClass(/is-complete/);
  await expect(frame.locator('#scheduleCalendarContext')).toHaveCount(0);
  const list=frame.locator('#calendarDayDialog'),listRows=frame.locator('#calendarDayTasks [data-calendar-task]');
  const source=await read();
  for(const [key,label] of [['overdue','Überfällig'],['week','Diese Woche'],['running','Laufend'],['open-end','Endtermin offen']]){
   const expected=source.tasks.filter(task=>M.quickMatch(task,key,now)).map(task=>task.id).sort((a,b)=>a-b);
   const trigger=frame.locator('[data-calendar-quick="'+key+'"]');
   await expect(trigger.locator('span')).toHaveText(String(expected.length));await trigger.click();
   await expect(frame.locator('#calendarDayTitle')).toHaveText(label+' ('+expected.length+')');
   assert.deepEqual((await listRows.evaluateAll(rows=>rows.map(row=>Number(row.dataset.calendarTask)))).sort((a,b)=>a-b),expected);
   if(key==='running'){
    await listRows.click();await expect(frame.locator('#taskForm [name=name]')).toHaveValue('Lange laufendes Paket');
    await frame.locator('#taskForm [name=notes]').fill('Notiz aus der Indikatorliste');await frame.locator('#taskForm button[type=submit]').click();
    await expect(frame.locator('#overlay')).toBeHidden();await expect(list).toBeVisible();await expect(listRows).toHaveCount(1);
   }
   await frame.locator('#closeCalendarDay').click();await expect(event(main)).toHaveCount(1);
  }
  const nav=await frame.locator('.schedule-period-navigation').boundingBox(),views=await frame.locator('.schedule-view-switch').boundingBox(),indicators=await frame.locator('#scheduleQuickFilters').boundingBox();
  assert(nav.x+nav.width<=views.x&&views.x+views.width<=indicators.x,'Today/period, views, then indicators from left to right');
  assert(Math.abs(nav.y+nav.height/2-indicators.y-indicators.height/2)<2,'Toolbar stays aligned in a single row');
  const checkFilterRow=async()=>{
   const ids=['filter','phase','workType','calendarTrade','calendarCompany','calendarStatus','resetScheduleFilters'];
   if(await frame.locator('#scale').isVisible())ids.push('scale');
   const boxes=await Promise.all(ids.map(id=>frame.locator('#'+id).boundingBox()));
   assert(Math.max(...boxes.map(box=>box.y))-Math.min(...boxes.map(box=>box.y))<2,'All filter controls share one row');
  };
  await checkFilterRow();
  for(const width of [1280,1024,768]){
   await page.setViewportSize({width,height:1100});await checkFilterRow();
   assert(await frame.locator('html').evaluate(node=>node.scrollWidth<=innerWidth+1),'Filter row must not overflow the document');
  }
  await page.setViewportSize({width:1520,height:1100});
  await frame.locator('[data-calendar-phase="'+phase.id+'"]').click();
  await expect(frame.locator('#phaseForm [name=title]')).toHaveValue(phase.title);
  await frame.locator('#phaseTaskDetails').evaluate(node=>node.open=true);
  await frame.locator('[data-phase-task="'+main+'"]').click();
  await expect(frame.locator('#overlay')).toBeVisible();await frame.locator('#closeTask').click();
  await expect(frame.locator('#phaseDialog')).toBeVisible();await frame.locator('#closePhaseDialog').click();
  await event(main).click();await expect(frame.locator('#taskForm [name=name]')).toHaveValue('Elektroinstallation');await frame.locator('#closeTask').click();
  await frame.locator('#calendarTrade').selectOption('Elektro');await expect(frame.locator('.schedule-calendar-event')).toHaveCount(1);
  await frame.locator('#resetScheduleFilters').click();
  await frame.locator('#calendarCompany').selectOption(String(company.id));await expect(frame.locator('.schedule-calendar-event')).toHaveCount(1);
  await frame.locator('#resetScheduleFilters').click();
  await frame.locator('#calendarStatus').selectOption('Erledigt');await expect(event(done)).toBeVisible();await expect(event(main)).toHaveCount(0);
  await frame.locator('#resetScheduleFilters').click();
  await frame.locator('#phase').selectOption(String(phase.id));await expect(frame.locator('.schedule-calendar-event')).toHaveCount(2);
  await frame.locator('#resetScheduleFilters').click();
  await frame.locator('#filter').fill('Elektroinstallation');await expect(frame.locator('.schedule-calendar-event')).toHaveCount(1);await frame.locator('#resetScheduleFilters').click();
  await frame.locator('[data-calendar-quick=overdue]').click();await expect(listRows).toHaveCount(1);await expect(listRows).toContainText('Überfälliges Paket');
  await expect(frame.locator('#calendarDayTasks [data-calendar-task="'+main+'"]')).toHaveCount(0);
  await frame.locator('#closeCalendarDay').click();await expect(event(main)).toHaveCount(1);
  await frame.locator('#calendarCompany').selectOption(String(company.id));
  await frame.locator('[data-calendar-quick=running]').click();await expect(listRows).toHaveCount(0);await expect(list).toContainText('Keine passenden Arbeitspakete.');
  await frame.locator('#closeCalendarDay').click();await frame.locator('#resetScheduleFilters').click();
  // Move confirmation preserves deadlines and shifts dependent computed dates.
  const before=await read(),find=(data,id)=>data.tasks.find(task=>task.id===id);
  await event(main).focus();await event(main).press('Alt+ArrowRight');
  await expect(popup()).toContainText('feste Endtermin');await popup().getByRole('button',{name:'Abbrechen',exact:true}).click();
  assert.deepEqual((await read()).tasks,before.tasks);
  await event(main).press('Alt+ArrowRight');await popup().getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect.poll(async()=>find(await read(),main).start).toBe(M.add(start,1));
  let after=await read();assert.equal(find(after,main).planned_end,find(before,main).planned_end);assert.equal(find(after,next).start,M.add(find(before,next).start,1));
  await expect(frame.locator('#scheduleCalendar')).not.toHaveAttribute('aria-busy','true');
  // Dependency rejection rolls back cleanly and retains inputs.
  await event(next).press('Alt+ArrowLeft');await popup().getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect(popup()).toContainText('Frühester Start');await popup().getByRole('button',{name:'OK',exact:true}).click();
  assert.equal(find(await read(),next).start,find(after,next).start);
  await event(done).press('Alt+ArrowRight');await expect(popup()).toHaveCount(0);
  // Pointer move by one day, grabbed in the same relative position of the bar.
  await event(main).scrollIntoViewIfNeeded();const box=await event(main).boundingBox(),weekBox=await frame.locator('.schedule-calendar-week').boundingBox();
  const x=box.x+15,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+weekBox.width/7,y,{steps:8});await page.mouse.up();
  await expect(popup()).toBeVisible();await popup().getByRole('button',{name:'Bestätigen',exact:true}).click();
  await expect.poll(async()=>find(await read(),main).start).toBe(M.add(start,2));
  await expect(frame.locator('#scheduleCalendar')).not.toHaveAttribute('aria-busy','true');
  await frame.locator('body').evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/phb-calendar-week.png'});
  await frame.locator('[data-schedule-view=month]').click();
  await expect(frame.locator('.schedule-calendar-week')).toHaveCount((M.distance(M.period('month',now).start,M.period('month',now).end)+1)/7);
  const more=frame.locator('[data-calendar-more]').first();await more.click();await expect(frame.locator('#calendarDayDialog')).toBeVisible();
  await frame.locator('#calendarDayTasks [data-calendar-task]').first().click();await expect(frame.locator('#overlay')).toBeVisible();await frame.locator('#closeTask').click();
  await expect(frame.locator('#calendarDayDialog')).toBeVisible();await frame.locator('#closeCalendarDay').click();
  // Light/dark and narrow screens: horizontal scroll stays inside the calendar.
  for(const mode of ['Hell','Dunkel']){
   await page.getByRole('banner').getByRole('textbox',{name:'Darstellung',exact:true}).click();await page.getByRole('option',{name:mode,exact:true}).click();
   await expect.poll(()=>frame.locator('#filter').evaluate(node=>{const style=getComputedStyle(node);return style.backgroundColor;})).toBe(mode==='Dunkel'?'rgb(21, 36, 38)':'rgb(255, 255, 255)');
   await page.screenshot({path:'/tmp/phb-calendar-'+mode+'.png'});
  }
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>frame.locator('html').evaluate(()=>innerWidth)).toBeGreaterThan(350);
  assert(await frame.locator('html').evaluate(node=>node.scrollWidth<=innerWidth+1),'No horizontal document overflow');
  await checkFilterRow();
  assert(await frame.locator('.schedule-filter-scroll').evaluate(node=>node.scrollWidth>node.clientWidth),'Mobile filters scroll internally in one row');
  assert(await frame.locator('.schedule-calendar-scroll').evaluate(node=>node.scrollWidth>node.clientWidth),'Mobile calendar scrolls internally');
  await page.setViewportSize({width:1520,height:1100});
  await page.reload();await expect(frame.locator('[data-schedule-view=month]')).toHaveAttribute('aria-pressed','true');
  await frame.locator('[data-schedule-view=gantt]').click();await expect(frame.locator('#gantt')).toBeVisible();await expect(frame.locator('#scale')).toBeVisible();await frame.locator('#resetScheduleFilters').click();await checkFilterRow();
  await frame.locator('[data-calendar-quick=running]').click();
  await expect(listRows).toContainText('Lange laufendes Paket');await frame.locator('#closeCalendarDay').click();
  await page.reload();await expect(frame.locator('[data-schedule-view=gantt]')).toHaveAttribute('aria-pressed','true');
  const other=(await(await page.request.post(base+'/api/projects',{data:{title:'Getrennter Kalender',start_date:M.add(now,90)}})).json()).project.id;
  await page.goto(base+'/p/'+other+'/');frame=page.frameLocator('iframe[title="Bauzeitenplan"]');await expect(frame.locator('[data-schedule-view=week]')).toHaveAttribute('aria-pressed','true');
  await expect(frame.locator('.schedule-calendar-event')).toHaveCount(0);
  await frame.locator('#newTask').click();await frame.locator('#taskForm [name=name]').fill('Erstes zukünftiges Paket');await frame.locator('#taskForm button[type=submit]').click();await expect(frame.locator('#overlay')).toBeHidden();
  await expect(frame.locator('.schedule-calendar-event')).toContainText('Erstes zukünftiges Paket');
  // Reproduce a cached server template with a separate group for trade/company/status.
  let usedLegacyTemplate=false;
  await page.route('**/*',async route=>{
   const request=route.request();if(request.resourceType()!=='document'||!request.url().includes('_embedded=1'))return route.continue();
   const response=await route.fetch();let html=await response.text();
   html=html.replace('<div id="scheduleFilters" class="schedule-filterbar" role="search" aria-label="Bauzeitenplan filtern">','<div class="gantt-filters" role="search" aria-label="Bauzeitenplan filtern">').replace('<select id="calendarTrade"','</div><div class="schedule-secondary-filters"><select id="calendarTrade"');
   html=html.replace(/(<button id="resetScheduleFilters"[^>]*>)[\s\S]*?<\/button>/,'$1Filter zurücksetzen</button>');
   usedLegacyTemplate=html.includes('class="schedule-secondary-filters"');
   await route.fulfill({response,body:html});
  });
  await page.reload();await expect(frame.locator('#scheduleFilters')).toBeVisible();await checkFilterRow();
  assert(usedLegacyTemplate,'The browser must have loaded the older two-group template');
  await expect(frame.locator('.schedule-secondary-filters')).toHaveCount(0);
  const widths=await Promise.all(['phase','workType','calendarTrade','calendarCompany','calendarStatus'].map(id=>frame.locator('#'+id).evaluate(node=>node.getBoundingClientRect().width)));
  assert(Math.max(...widths)-Math.min(...widths)<2,'Dropdowns share the available width evenly');
  await expect(frame.locator('#resetScheduleFilters')).toHaveText('');
  const reset=await frame.locator('#resetScheduleFilters').boundingBox(),field=await frame.locator('#calendarStatus').boundingBox(),icon=await frame.locator('#resetScheduleFilters svg').boundingBox();
  assert(Math.abs(reset.height-field.height)<1&&Math.abs(reset.width-reset.height)<1,'Reset button is square and aligned with fields');
  assert(Math.abs(icon.x+icon.width/2-reset.x-reset.width/2)<1&&Math.abs(icon.y+icon.height/2-reset.y-reset.height/2)<1,'Reset icon is centered');
  await frame.locator('#filter').fill('Nicht vorhanden');await expect(frame.locator('.schedule-calendar-event')).toHaveCount(0);
  await frame.locator('#resetScheduleFilters').click();await expect(frame.locator('#filter')).toHaveValue('');await expect(frame.locator('.schedule-calendar-event')).toHaveCount(1);
  assert.deepEqual(errors,[]);
  console.log('PASS weekly/monthly calendar, filters, shared stacked details, confirmed keyboard/pointer moves, dependency rollback, fixed deadlines, theme/mobile layout, persisted project-specific views and existing Gantt.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

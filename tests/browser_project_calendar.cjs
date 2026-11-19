/* Use the isolated server from dev/ui_browser_smoke.py. */
const {chromium, expect} = require('../frontend/node_modules/@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.PHB_TEST_URL;
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
  try {
    const page = await browser.newPage({locale: 'de-DE', viewport: {width: 1440, height: 1000}}), errors=[];
    page.on('pageerror', e => errors.push(e.message));
    const owner = (await (await page.request.post(base+'/api/projects', {data:{title:'Terminprojekt'}})).json()).project.id;
    const headers = {'X-PHB-Project':String(owner)};
    const trades = (await (await page.request.get(base+'/api/trades', {headers})).json()).trades;
    await page.goto(base+'/p/'+owner+'/');
    await expect(page.getByRole('heading', {name:'Projektkalender', exact:true})).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByText('Bauphasen und Arbeitspakete', {exact:true})).toHaveCount(0);
    const today = await page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
    const cell = page.locator(`[data-calendar-day="${today}"]`);
    await cell.getByRole('button', {name:/Termin am/}).click();
    const editor = page.getByRole('dialog', {name:'Termin erstellen', exact:true});
    await editor.getByRole('textbox',{name:'Titel',exact:true}).fill('Treppenbauer – Aufmaß');
    await editor.getByRole('checkbox',{name:'Ganztägig',exact:true}).uncheck();
    await editor.locator('input[type=time]').first().fill('09:30');
    await editor.locator('input[type=time]').last().fill('11:00');
    await editor.getByRole('textbox',{name:'Gewerke',exact:true}).click();
    await page.getByRole('option',{name:trades[0].name,exact:true}).click();
    await page.keyboard.press('Escape');
    await editor.getByRole('textbox',{name:'Notizen',exact:true}).fill('Vor Ort abstimmen.');
    await editor.getByRole('button',{name:'Speichern',exact:true}).click();
    await expect(editor).toBeHidden();
    const event = cell.locator('.project-calendar-event');
    await expect(event).toContainText('Treppenbauer – Aufmaß'); await expect(event).toContainText('09:30'); await expect(event).toContainText(trades[0].name);
    await event.click();
    const edit = page.getByRole('dialog',{name:'Termin bearbeiten',exact:true});
    await expect(edit.getByRole('textbox',{name:'Notizen',exact:true})).toHaveValue('Vor Ort abstimmen.');
    await page.mouse.click(3,3); await expect(edit).toBeVisible();
    await edit.getByRole('textbox',{name:'Titel',exact:true}).fill('Treppenbauer – Montage');
    await edit.getByRole('button',{name:'Speichern',exact:true}).click(); await expect(edit).toBeHidden();
    await page.reload(); await expect(cell.locator('.project-calendar-event')).toContainText('Treppenbauer – Montage');
    await page.getByRole('combobox',{name:'Termine suchen',exact:true}).fill('Verputzer');
    await expect(page.getByText('Keine passenden Termine gefunden.',{exact:true})).toBeVisible();
    await expect(cell.locator('.project-calendar-event')).toHaveCount(1);
    await page.getByRole('combobox',{name:'Termine suchen',exact:true}).fill('');
    await page.locator('.mantine-SegmentedControl-label').filter({hasText:/^Woche$/}).click();
    await expect(page.locator('.project-calendar-day')).toHaveCount(7);
    await page.getByRole('button',{name:'Nächster Zeitraum',exact:true}).click(); await expect(page.locator('.project-calendar-event')).toHaveCount(0);
    await page.getByRole('button',{name:'Heute',exact:true}).click(); await expect(cell.locator('.project-calendar-event')).toHaveCount(1);
    for(const theme of ['light','dark']) {
      await page.evaluate(theme => localStorage.setItem('mantine-color-scheme-value',theme),theme); await page.reload();
      await expect(cell.locator('.project-calendar-event')).toBeVisible();
      await page.screenshot({path:'/tmp/phb-project-calendar-'+theme+'.png'});
    }
    await page.setViewportSize({width:390,height:844});
    await expect.poll(()=>page.locator('html').evaluate(node=>node.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:'/tmp/phb-project-calendar-mobile.png'});
    await cell.locator('.project-calendar-event').click(); await expect(edit).toBeVisible();
    await expect(edit.getByRole('button',{name:'Speichern',exact:true})).toBeInViewport();
    await edit.getByRole('button',{name:'Löschen',exact:true}).click();
    await page.getByRole('button',{name:'Löschen',exact:true}).last().click(); await expect(edit).toBeHidden();
    await expect(page.locator('.project-calendar-event')).toHaveCount(0);
    const other=(await(await page.request.post(base+'/api/projects',{data:{title:'Anderer Kalender'}})).json()).project.id;
    const created=await page.request.post(base+'/api/calendar-events',{headers,data:{title:'Nur im ersten Projekt',start_date:today,end_date:today}});assert.equal(created.status(),201);
    await page.goto(base+'/p/'+other+'/'); await expect(page.getByRole('heading',{name:'Projektkalender',exact:true})).toBeVisible(); await expect(page.locator('.project-calendar-event')).toHaveCount(0);
    // Old deep links still reach the retained editor, without restoring it as the calendar landing page.
    const legacy=await page.request.post(base+'/api/tasks',{headers,data:{code:'ALT-1',name:'Vorhandenes Arbeitspaket',trade:trades[0].name,duration:1}});
    assert.equal(legacy.status(),201,await legacy.text()); const task=await legacy.json();
    await page.goto(base+'/p/'+owner+'/?task_id='+task.id);
    const frame=page.frameLocator('iframe[title="Projektkalender"]');await expect(frame.locator('#overlay')).toBeVisible();
    await frame.locator('#closeTask').click();await expect(page.getByRole('heading',{name:'Projektkalender',exact:true})).toBeVisible();
    assert.deepEqual(errors,[]);
    console.log('PASS native calendar create/edit/delete, times/trades, search, week navigation, persistence, dark/mobile, project isolation and preserved legacy deep links.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});

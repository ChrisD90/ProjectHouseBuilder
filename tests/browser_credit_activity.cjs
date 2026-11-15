const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Kreditverlauf'}})).json()).project.id,headers={'X-PHB-Project':String(owner)};
  async function api(method,path,data){const r=await page.request[method](base+path,{headers,data});assert(r.ok(),await r.text());return r.json();}
  const first=(await api('post','/api/financing/loans',{name:'Baukredit',principal:1000,interest_rate:3,monthly_payment:10})).id;
  const second=(await api('post','/api/financing/loans',{name:'Dachkredit',principal:500,interest_rate:3,monthly_payment:10})).id;
  const manual=(await api('post','/api/financing/events',{kind:'loan_drawdown',loan_id:first,amount:300,event_date:'2026-11-01'})).id;
  await api('post','/api/financing/events',{kind:'loan_drawdown',loan_id:second,amount:200,event_date:'2026-11-02'});
  const upload=await page.request.post(base+'/api/receipts',{headers,multipart:{analysis_mode:'none',file:{name:'Rechnung.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nRechnung')}}});assert(upload.ok(),await upload.text());const rid=(await upload.json()).id;
  await api('patch','/api/receipts/'+rid,{supplier:'Fachbetrieb',invoice_number:'R-1',document_date:'2026-11-03',gross_amount:100,assignment_type:'Eigenleistung',book_now:true});
  const draft=await api('post','/api/financing/drawdowns/drafts',{loan_id:first,receipt_ids:[rid],requested_date:'2026-11-03',payout_type:'direct'});
  const submitted=await page.request.post(base+'/api/financing/drawdowns/'+draft.id+'/submit',{headers});assert(submitted.ok(),await submitted.text());
  const before=await api('get','/api/financing');
  await page.goto(base+'/p/'+owner+'/finanzierung');const frame=page.frameLocator('iframe[title="Kredite & Eigenkapital"]:not([hidden])');
  const cards=frame.locator('.loan-overview-card'),firstCard=cards.filter({has:frame.getByRole('heading',{name:'Baukredit',exact:true})}),secondCard=cards.filter({has:frame.getByRole('heading',{name:'Dachkredit',exact:true})});
  await expect(firstCard.locator('.loan-drawdown-count')).toHaveText('2 Abrufe');await expect(secondCard.locator('.loan-drawdown-count')).toHaveText('1 Abruf');
  assert.deepEqual(await api('get','/api/financing'),before,'Opening history must not change existing finance data');
  await expect(frame.locator('[data-credit-activity="event:'+manual+'"]')).toBeVisible();
  const drawdown=frame.locator('[data-credit-activity="drawdown:'+draft.id+'"]');await expect(drawdown).toContainText('Eingereicht');
  await drawdown.getByRole('button',{name:'Auszahlung eingegangen',exact:true}).click();const prompt=frame.locator('dialog.phb-messagebox');await prompt.getByRole('textbox').fill('2026-11-04');await prompt.getByRole('button',{name:'Übernehmen',exact:true}).click();
  await expect(drawdown).toContainText('Ausgezahlt');await expect(firstCard.locator('.loan-drawdown-count')).toHaveText('2 Abrufe');
  await drawdown.locator('summary').click();await expect(drawdown.locator('.credit-linked-usages')).toContainText('Fachbetrieb');await expect(drawdown.locator('.credit-linked-usages')).toContainText('100,00');
  assert.equal((await api('get','/api/receipts')).receipts.find(r=>r.id===rid).paid_amount,100);
  await expect(frame.locator('[data-credit-activity^="payment:"]')).toHaveCount(0);
  await secondCard.getByRole('button',{name:'Kredit nutzen',exact:true}).click();const chooser=frame.locator('#creditActivityDialog');await expect(chooser.locator('#creditActivityLoan')).toHaveValue(String(second));
  await chooser.locator('#newDrawdown').click();await expect(frame.locator('#drawdownLoan')).toHaveValue(String(second));await frame.locator('#closeDrawdown').click();
  await frame.locator('#newCreditActivity').click();await chooser.locator('#creditActivityLoan').selectOption(String(second));await chooser.locator('#newUsage').click();
  const usage=frame.locator('#usageDialog');await expect(usage.locator('#usageLoan')).toHaveValue(String(second));await usage.locator('input[value=manual]').check();await usage.locator('input[name=purpose]').fill('Baustelleneinrichtung');await usage.locator('input[name=amount]').fill('25');await usage.locator('#saveUsage').click();
  await expect(usage).toBeHidden();await expect(secondCard.locator('.loan-drawdown-count')).toHaveText('1 Abruf');await expect(frame.locator('#creditHistory')).toContainText('Baustelleneinrichtung');
  const current=await api('get','/api/financing');assert.equal(current.loans.find(l=>l.id===second).balance.unallocated_drawn,175);assert.equal(current.events.length,before.events.length+1);
  await frame.locator('#creditHistoryLoanFilter').selectOption(String(second));await expect(frame.locator('[data-credit-activity^="drawdown:"]')).toHaveCount(0);await expect(frame.locator('#creditHistory')).toContainText('Baustelleneinrichtung');
  for(const mode of ['light','dark']){await frame.locator('body').evaluate((_,mode)=>window.PHBUI.setTheme(mode),mode);await frame.locator('#creditHistory').screenshot({path:'/tmp/phb-credit-history-'+mode+'.png'});}
  await page.setViewportSize({width:390,height:844});await frame.locator('#newCreditActivity').click();await expect(chooser.locator('#closeCreditActivity')).toBeInViewport();await chooser.screenshot({path:'/tmp/phb-credit-activity-mobile.png'});await chooser.locator('#closeCreditActivity').click();
  assert(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await frame.locator('#creditHistoryLoanFilter').selectOption('');const usageRow=frame.locator('[data-credit-activity^="usage:"]');await usageRow.getByRole('button',{name:'Verwendung zurücknehmen',exact:true}).click();await prompt.getByRole('button',{name:'Bestätigen',exact:true}).click();await expect(usageRow).toContainText('Zurückgenommen');await expect(secondCard.locator('.loan-drawdown-count')).toHaveText('1 Abruf');
  assert.equal((await api('get','/api/financing')).loans.find(l=>l.id===second).balance.unallocated_drawn,200);
  const other=(await(await page.request.post(base+'/api/projects',{data:{title:'Anderes Projekt'}})).json()).project.id;await page.goto(base+'/p/'+other+'/finanzierung');await expect(frame.locator('#creditHistory')).toContainText('Noch keine Kreditvorgänge');
  assert.deepEqual(errors,[]);console.log('PASS unified credit entry/history, selected loans, manual counts, no double counting on bank confirmation, nested payments, preserved balances, filters, reversal, themes/mobile and project separation.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

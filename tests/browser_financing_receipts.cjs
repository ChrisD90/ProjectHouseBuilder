const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.PHB_TEST_URL;
if(!base)throw Error('Use dev/ui_browser_smoke.py.');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const owner=(await(await page.request.post(base+'/api/projects',{data:{title:'Finanzierungsbelege'}})).json()).project.id;
  const headers={'X-PHB-Project':String(owner)};
  async function post(path,data){const r=await page.request.post(base+path,{headers,data});assert(r.ok(),await r.text());return r.json();}
  const equity=(await post('/api/financing/equity',{name:'Baukonto',opening_balance:500,reserve:0})).id;
  const empty=(await post('/api/financing/equity',{name:'Reservekonto',opening_balance:50,reserve:0})).id;
  const loan=(await post('/api/financing/loans',{name:'Baukredit',principal:500,interest_rate:3,monthly_payment:10,initial_repayment_rate:2,extra_repayment_pct:0})).id;
  await post('/api/financing/events',{kind:'loan_drawdown',amount:100,loan_id:loan,event_date:'2026-11-03'});
  async function receipt(number,gross){
   const upload=await page.request.post(base+'/api/receipts',{headers,multipart:{analysis_mode:'local',file:{name:number+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n'+number)}}});
   assert.equal(upload.status(),201,await upload.text());const id=(await upload.json()).id;
   const booked=await page.request.patch(base+'/api/receipts/'+id,{headers,data:{supplier:'Baumarkt',invoice_number:number,document_date:'2026-11-03',gross_amount:gross,assignment_type:'Eigenleistung',book_now:true}});
   assert(booked.ok(),await booked.text());return id;
  }
  const first=await receipt('R-100',100),second=await receipt('R-200',50);
  const pay=(rid,source,amount)=>post('/api/financing/payments',{receipt_id:rid,source,amount,payment_date:'2026-11-03',...(source==='loan'?{loan_id:loan}:{equity_id:equity})});
  await pay(first,'equity',30);await pay(first,'equity',20);await pay(first,'loan',20);await pay(second,'equity',50);
  await page.goto(base+'/p/'+owner+'/finanzierung');
  const frame=page.frameLocator('iframe[title="Kredite & Eigenkapital"]:not([hidden])');
  const loanButton=frame.locator('[data-receipt-source="loan"][data-account-id="'+loan+'"]');
  await expect(loanButton).toHaveAccessibleName('Zugeordnete Rechnungen & Belege: 1');
  await expect(loanButton.locator('..')).toHaveClass(/loan-overview-card/);
  await loanButton.click();
  await expect(frame.locator('#loanDialog')).not.toBeVisible();
  let overview=page.getByRole('dialog',{name:'Rechnungen · Baukredit',exact:true});
  await expect(overview).toBeVisible();
  assert((await overview.boundingBox()).width>=1100,'Kreditbelege sollen so breit wie Angebotsbelege dargestellt werden.');
  await expect(overview.locator('.mantine-SimpleGrid-root')).toHaveCount(0);
  await expect(overview.locator('tbody tr')).toHaveCount(1);
  await expect(overview.getByRole('columnheader',{name:'Aus diesem Kredit',exact:true})).toBeVisible();
  await expect(overview.locator('tbody tr td').nth(5)).toContainText('20,00');
  await expect(overview.getByRole('link',{name:'Original ansehen'})).toHaveAttribute('href','/api/receipts/'+first+'/preview?project_id='+owner);
  await overview.getByRole('button',{name:'Schließen',exact:true}).click();
  const equityButton=frame.locator('[data-receipt-source="equity"][data-account-id="'+equity+'"]');
  await expect(equityButton).toHaveAccessibleName('Zugeordnete Rechnungen & Belege: 2');
  await expect(equityButton.locator('..')).toHaveClass(/equity-overview-card/);
  await equityButton.click();
  await expect(frame.locator('#equityDialog')).not.toBeVisible();
  overview=page.getByRole('dialog',{name:'Rechnungen · Baukonto',exact:true});
  await expect(overview.locator('.mantine-SimpleGrid-root')).toHaveCount(0);
  assert((await overview.boundingBox()).width>=1100);
  await expect(overview.locator('tbody tr')).toHaveCount(2);
  await expect(overview.locator('tbody tr td').nth(5)).toContainText('50,00');
  await page.setViewportSize({width:390,height:844});
  await expect(overview.getByRole('button',{name:'Schließen',exact:true})).toBeInViewport();
  await overview.getByRole('button',{name:'Schließen',exact:true}).click();
  const emptyButton=frame.locator('[data-receipt-source="equity"][data-account-id="'+empty+'"]');
  await expect(emptyButton).toHaveAccessibleName('Zugeordnete Rechnungen & Belege: 0');
  await emptyButton.click();
  const emptyOverview=page.getByRole('dialog',{name:'Rechnungen · Reservekonto',exact:true});
  await expect(emptyOverview.getByText('Dieser Finanzierungsquelle sind noch keine Rechnungen oder Belege zugeordnet.')).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('PASS financing card receipt buttons, counters, split payments, shared overview and document preview.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

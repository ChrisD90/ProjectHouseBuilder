/* One focused integration check for the native collection / classic form boundary. */
const { chromium, expect } = require('../frontend/node_modules/@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.PHB_TEST_URL;
if (!base) throw Error('Use a disposable PHB_TEST_URL.');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ locale: 'de-DE' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const created = await page.request.post(base + '/api/projects', { data: { title: 'Native Belegprüfung' } });
    const id = (await created.json()).project.id;
    const upload = await page.request.post(base + '/api/receipts', { headers: { 'X-PHB-Project': String(id) }, multipart: {
      analysis_mode: 'none', file: { name: 'Prüfbeleg.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% unanalysierter Testentwurf\n%%EOF') },
    } });
    assert.equal(upload.status(), 201, await upload.text());
    const receipt = (await upload.json()).id;
    await page.goto(base + '/p/' + id + '/belege');
    const card = page.locator('.receipt-native-card').filter({ hasText: 'Prüfbeleg.pdf' });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp('receipt_id=' + receipt));
    const frame = page.frameLocator('iframe[title="Beleg erfassen oder bearbeiten"]');
    await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible();
    // Chromium/Playwright misprojects pointer coordinates in an ancestor-zoomed iframe.
    await expect(frame.locator('#closeReceiptWorkflow')).toBeVisible();
    assert(await frame.locator('#closeReceiptWorkflow').evaluate(n => { const r=n.getBoundingClientRect(); return r.right<=innerWidth && r.bottom<=innerHeight; }));
    await frame.locator('#closeReceiptWorkflow').evaluate(n => n.click());
    await expect(page.locator('iframe[title="Beleg erfassen oder bearbeiten"]')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp('/p/' + id + '/belege$'));
    // Reopening must create a fresh form host, without a stale URL or nested project prefix.
    await card.click();
    await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible();
    // Chromium/Playwright misprojects pointer coordinates in an ancestor-zoomed iframe.
    await expect(frame.locator('#closeReceiptWorkflow')).toBeVisible();
    assert(await frame.locator('#closeReceiptWorkflow').evaluate(n => { const r=n.getBoundingClientRect(); return r.right<=innerWidth && r.bottom<=innerHeight; }));
    await frame.locator('#closeReceiptWorkflow').evaluate(n => n.click());
    await page.getByRole('button', { name: 'Kassenzettel erfassen', exact: true }).click();
    await expect(frame.locator('#receiptWorkflowDialog')).toBeVisible();
    await expect(page).toHaveURL(/receipt_kind=Kassenzettel/);
    // Chromium/Playwright misprojects pointer coordinates in an ancestor-zoomed iframe.
    await expect(frame.locator('#closeReceiptWorkflow')).toBeVisible();
    assert(await frame.locator('#closeReceiptWorkflow').evaluate(n => { const r=n.getBoundingClientRect(); return r.right<=innerWidth && r.bottom<=innerHeight; }));
    await frame.locator('#closeReceiptWorkflow').evaluate(n => n.click());
    assert.deepEqual(errors, []);
    console.log('PASS native receipt cards, project-scoped classic form, close/reopen URL cleanup and receipt-kind entry.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

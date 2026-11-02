/* Requires a disposable PHB_TEST_URL; creates its own project, receipt and long phase. */
const {
  chromium,
  expect,
} = require("../frontend/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const base = process.env.PHB_TEST_URL;
if (!base) throw Error("Use a disposable PHB_TEST_URL.");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({ locale: "de-DE" }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const token = Date.now(),
      created = await page.request.post(base + "/api/projects", {
        data: { title: "UI-Prüfung " + token },
      });
    const owner = (await created.json()).project.id,
      headers = { "X-PHB-Project": String(owner) };
    const upload = await page.request.post(base + "/api/receipts", {
      headers,
      multipart: {
        analysis_mode: "local",
        file: {
          name: "Prüfrechnung.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.concat([
            Buffer.from(
              "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgNTk1IDg0MiBdCi9QYXJlbnQgMiAwIFIKPj4KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMTMgMDAwMDAgbiAKMDAwMDAwMDE2MiAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDUKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKPj4Kc3RhcnR4cmVmCjI1NgolJUVPRgo=",
              "base64",
            ),
            Buffer.from("\n%" + token),
          ]),
        },
      },
    });
    assert.equal(upload.status(), 201, await upload.text());
    const rid = (await upload.json()).id;
    const booked = await page.request.patch(base + "/api/receipts/" + rid, {
      headers,
      data: {
        supplier: "UI-Prüfrechnung",
        document_date: "2026-11-01",
        gross_amount: 100,
        assignment_type: "Eigenleistung",
        book_now: true,
      },
    });
    assert.equal(booked.status(), 200, await booked.text());
    await page.goto(base + "/p/" + owner + "/belege");
    const frame = page.frameLocator('iframe[title="Rechnungen & Belege"]');
    const row = frame
      .locator(".receipt-entry-row")
      .filter({ has: frame.locator('.entry[data-id="' + rid + '"]') });
    const statusBox = await row
      .locator(".receipt-entry-heading .status")
      .boundingBox();
    const toolBox = await row
      .locator('.receipt-entry-heading [data-work-open="receipt"]')
      .boundingBox();
    const cardBox = await row.boundingBox();
    assert(statusBox && toolBox && cardBox);
    assert(toolBox.x >= statusBox.x + statusBox.width);
    assert(
      Math.abs(
        statusBox.y + statusBox.height / 2 - (toolBox.y + toolBox.height / 2),
      ) < 2,
    );
    assert(toolBox.x + toolBox.width <= cardBox.x + cardBox.width);
    await row.locator('[data-work-open="receipt"]').click();
    const linked = page.getByRole("dialog", {
      name: "To-dos & Notizen",
      exact: true,
    });
    await linked
      .getByRole("button", { name: "Neues To-do", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Neues To-do",
      exact: true,
    });
    await editor
      .getByRole("textbox", { name: "Titel", exact: true })
      .fill("Rechnung prüfen " + token);
    await editor
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(editor).toBeHidden();
    await linked
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await expect(row.locator("[data-work-count]")).toHaveText("1");
    await row.locator(".entry").click();
    await expect(frame.locator("#receiptWorkflowDialog")).toBeVisible();
    await expect(frame.locator("#original, #receiptWorkLink")).toHaveCount(0);
    await expect(frame.locator("#receiptPdfFrame")).toBeVisible();
    await expect(frame.locator("#cancelReceipt")).toBeHidden();
    await frame.locator(".receipt-secondary-actions>summary").click();
    await expect(frame.locator("#cancelReceipt")).toBeVisible();
    await expect(
      frame.locator(".receipt-primary-actions #saveReceiptDraft"),
    ).toBeVisible();
    await frame.locator("#closeReceiptWorkflow").click();
    const title =
      "Sehr lange Bauphase für energetische Modernisierung und sämtliche Außenanlagen";
    const phase = await page.request.post(base + "/api/phases", {
      headers,
      data: { title, start_date: "2027-03-01" },
    });
    assert.equal(phase.status(), 201, await phase.text());
    const pid = (await phase.json()).phase.id;
    await page.goto(base + "/p/" + owner + "/");
    const gantt = page.frameLocator('iframe[title="Bauzeitenplan"]');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const button = gantt.locator('.phase-edit[data-phase-id="' + pid + '"]');
      await expect(button).toBeVisible();
      const size = await button.evaluate((node) => {
        const range = document.createRange();
        range.setStart(node.firstChild, 0);
        range.setEnd(node.firstChild, 1);
        return {
          text: node.textContent,
          start: range.getBoundingClientRect().left,
          left: node.getBoundingClientRect().left,
          height: node.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(node).lineHeight),
          whiteSpace: getComputedStyle(node).whiteSpace,
        };
      });
      assert.equal(size.text, title);
      assert(size.start >= size.left - 1, JSON.stringify(size));
      assert(size.height <= size.lineHeight * 2 + 2, JSON.stringify(size));
      assert.equal(size.whiteSpace, "normal");
      await page.screenshot({ path: "/tmp/phb-long-phase-" + width + ".png" });
    }
    await gantt.locator("#managePhases").click();
    await expect(gantt.locator("#phaseForm input[name=title]")).toHaveAttribute(
      "maxlength",
      "80",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS receipt source tools/counter, preview and grouped actions; long phase titles wrap in two lines on desktop/mobile.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

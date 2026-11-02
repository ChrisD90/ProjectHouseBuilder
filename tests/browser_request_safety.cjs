/* Disposable server only. Two real tabs retain their own edit fingerprints. */
const {
  chromium,
  expect,
} = require("../frontend/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const base = process.env.PHB_TEST_URL;
if (!base) throw Error("Use dev/ui_browser_smoke.py.");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ locale: "de-DE" }),
      a = await context.newPage(),
      b = await context.newPage();
    const made = await a.request.post(base + "/api/projects", {
        data: { title: "Konfliktprüfung" },
      }),
      owner = (await made.json()).project.id,
      headers = { "X-PHB-Project": String(owner) };
    const uploaded = await a.request.post(base + "/api/receipts", {
      headers,
      multipart: {
        analysis_mode: "local",
        file: {
          name: "Probe.pdf",
          mimeType: "application/pdf",
          buffer: require("./pdf_fixture.cjs"),
        },
      },
    });
    assert.equal(uploaded.status(), 201, await uploaded.text());
    const ident = (await uploaded.json()).id;
    const booked = await a.request.patch(base + "/api/receipts/" + ident, {
      headers,
      data: {
        supplier: "Konflikt-Test",
        document_date: "2026-11-02",
        gross_amount: 1000,
        assignment_type: "Eigenleistung",
        book_now: true,
      },
    });
    assert.equal(booked.status(), 200, await booked.text());
    const url = base + "/p/" + owner + "/belege?receipt_id=" + ident;
    await a.goto(url);
    await b.goto(url);
    const af = a.frameLocator('iframe[title="Rechnungen & Belege"]'),
      bf = b.frameLocator('iframe[title="Rechnungen & Belege"]');
    await expect(af.locator("#receiptWorkflowDialog")).toBeVisible();
    await expect(bf.locator("#receiptWorkflowDialog")).toBeVisible();
    await bf
      .locator("#review textarea[name=notes]")
      .fill("Gespeichert in Tab B");
    const saving = b.waitForResponse(
      (r) =>
        r.url().includes("/api/receipts/" + ident) &&
        r.request().method() === "PATCH",
    );
    await bf.locator("#saveReceiptDraft").click();
    const saved = await saving;
    assert.equal(
      saved.status(),
      200,
      (await saved.text()) + " REQUEST " + saved.request().postData(),
    );
    await expect
      .poll(
        async () =>
          (
            await (
              await b.request.get(base + "/api/receipts/" + ident, { headers })
            ).json()
          ).notes,
      )
      .toBe("Gespeichert in Tab B");
    await af
      .locator("#review textarea[name=notes]")
      .fill("Meine ungespeicherten Angaben in Tab A");
    await af.locator("#saveReceiptDraft").click();
    const conflict = a.locator("#phbRequestNotice");
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText("Gespeichert in Tab B");
    await conflict
      .getByRole("button", { name: "Zurück zu meinen Eingaben" })
      .click();
    await expect(af.locator("#review textarea[name=notes]")).toHaveValue(
      "Meine ungespeicherten Angaben in Tab A",
    );
    // Explicitly selecting a conflicting field is required to overwrite it.
    await af.locator("#saveReceiptDraft").click();
    await expect(conflict).toBeVisible();
    await expect(conflict.locator("input[type=checkbox]")).not.toBeChecked();
    await conflict.locator("input[type=checkbox]").check();
    await conflict
      .getByRole("button", {
        name: "Ausgewählte Änderungen speichern",
        exact: true,
      })
      .click();
    await expect(conflict).toBeHidden();
    await expect
      .poll(
        async () =>
          (
            await (
              await a.request.get(base + "/api/receipts/" + ident, { headers })
            ).json()
          ).notes,
      )
      .toBe("Meine ungespeicherten Angaben in Tab A");
    const body = {
        receipt_id: ident,
        source: "unassigned",
        amount: 100,
        payment_date: "2026-11-02",
      },
      opHeaders = {
        ...headers,
        "Idempotency-Key": "browser-payment-operation-0001",
      };
    const first = await a.request.post(base + "/api/financing/payments", {
        headers: opHeaders,
        data: body,
      }),
      again = await a.request.post(base + "/api/financing/payments", {
        headers: opHeaders,
        data: body,
      });
    assert.equal(first.status(), 201, await first.text());
    assert.equal((await first.json()).id, (await again.json()).id);
    assert.equal(
      (
        await (
          await a.request.get(base + "/api/receipts/" + ident, { headers })
        ).json()
      ).paid_amount,
      100,
    );
    // A committed payment whose HTTP reply is lost must retain its operation key.
    let intercepted = 0;
    await a.route("**/api/financing/payments", async (route) => {
      intercepted++;
      await route.fetch();
      await route.abort("failed");
    });
    const lost = { ...body, amount: 20 };
    const errorMessage = await a.evaluate(async (body) => {
      try {
        await fetch("/api/financing/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return "";
      } catch (error) {
        return error.message;
      }
    }, lost);
    assert(errorMessage);
    assert.equal(intercepted, 1);
    const unknown = a.locator("#phbRequestNotice");
    await expect(unknown).toBeVisible();
    await unknown
      .getByRole("button", { name: "Status erneut prüfen", exact: true })
      .click();
    await expect(unknown).toContainText("erfolgreich gespeichert");
    await unknown
      .getByRole("button", { name: "Zurück zu meinen Eingaben" })
      .click();
    await a.unroute("**/api/financing/payments");
    const replay = await a.evaluate(async (body) => {
      const response = await fetch("/api/financing/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        replayed: response.headers.get("Idempotency-Replayed"),
      };
    }, lost);
    assert.equal(replay.status, 201);
    assert.equal(replay.replayed, "true");
    assert.equal(
      (
        await (
          await a.request.get(base + "/api/receipts/" + ident, { headers })
        ).json()
      ).paid_amount,
      120,
    );
    await a.route("**/api/review-upload", (route) =>
      route.fulfill({
        status: 413,
        contentType: "text/html",
        body: "<html>too large</html>",
      }),
    );
    const tooLarge = await a.evaluate(async () => {
      const response = await fetch("/api/review-upload", {
        method: "POST",
        body: "fixture",
      });
      return { status: response.status, data: await response.json() };
    });
    assert.equal(tooLarge.status, 413);
    assert(tooLarge.data.error.includes("zu groß"));
    await expect(a.locator("#phbRequestNotice")).toHaveCount(0);
    // Filter restoration is scoped to this project and survives a complete reload.
    await b.goto(base + "/p/" + owner + "/belege");
    await bf.locator("#receiptSearch").fill("Konflikt");
    await b.reload();
    await expect(bf.locator("#receiptSearch")).toHaveValue("Konflikt");
    await b.goto(base + "/p/1/belege");
    await expect(bf.locator("#receiptSearch")).toHaveValue("");
    console.log(
      "PASS stale-tab conflict preserves input, repeated payment is single, filters persist per project.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

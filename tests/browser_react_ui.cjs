/* Requires Playwright + Chromium and a disposable database. Creates test records. */
const { chromium } = require("../frontend/node_modules/playwright"),
  assert = require("node:assert/strict");
const base = process.env.PHB_TEST_URL;
if (!base) throw Error("Set PHB_TEST_URL to a disposable local app instance.");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (require("node:fs").existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : undefined),
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({ locale: "de-DE" }),
      errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) =>
      requests.push({
        url: r.url(),
        type: r.resourceType(),
        method: r.method(),
      }),
    );
    await page.goto(base + "/p/1/");
    await page.waitForFunction(() => !!window.PHBReactBridge);
    await page
      .frameLocator('iframe[title="Bauzeitenplan"]')
      .locator("#count")
      .waitFor();
    await page.evaluate(() => {
      window.testNavigation = document.querySelector("nav");
      window.testServices = window.PHBReactBridge;
    });
    const visit = async (name) => {
      await page.getByRole("link", { name, exact: true }).click();
      await page.waitForTimeout(150);
    };
    await page
      .getByRole("button", { name: "Sidebar einklappen", exact: true })
      .click();
    for (let i = 0; i < 2; i++)
      for (const name of [
        "To-dos & Notizen",
        "Stammdaten",
        "Kosten & Budget",
        "Energetische Planung",
        "Angebote",
        "Rechnungen & Belege",
        "Kredite & Eigenkapital",
        "Dokumente",
        "Daten & Sicherung",
        "Bauzeitenplan",
      ]) {
        await visit(name);
        assert(
          await page.evaluate(
            () =>
              testServices === PHBReactBridge &&
              testNavigation === document.querySelector("nav"),
          ),
        );
      }
    assert.equal(
      requests.filter((r) => r.url.endsWith("/api/ai/status")).length,
      1,
      "ChatGPT status is not reloaded by navigation",
    );
    assert.equal(
      requests.filter(
        (r) => r.type === "document" && !r.url.includes("_embedded=1"),
      ).length,
      1,
      "no repeated top-level document navigation",
    );
    // Draft deletion must close the entire workflow only after a successful delete.
    const draftIds = [];
    for (let index = 0; index < 2; index++) {
      const response = await page.request.post(base + "/api/offers/import", {
        multipart: {
          file: {
            name: "UI-Angebot-" + Date.now() + "-" + index + ".pdf",
            mimeType: "application/pdf",
            buffer: Buffer.concat([
              invoicePDF(),
              Buffer.from("\n% offer " + index + "-" + Date.now()),
            ]),
          },
        },
      });
      assert.equal(response.status(), 201, await response.text());
      draftIds.push((await response.json()).id);
    }
    await visit("Angebote");
    const offers = page.frameLocator('iframe[title="Angebote"]:not([hidden])');
    await offers.locator("#openOfferDrafts").click();
    const draft = offers.locator('[data-offer-card="' + draftIds[0] + '"]');
    await draft.waitFor();
    assert.equal(
      await draft
        .getByRole("button", { name: "PDF rechts anzeigen", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await draft
        .getByRole("link", { name: "Herunterladen", exact: true })
        .count(),
      0,
    );
    assert(await offers.locator("#offerPdfPane").isVisible());
    await draft
      .getByRole("button", { name: "Entwurf löschen", exact: true })
      .click();
    await offers
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    assert(await offers.locator("#offerWorkflowDialog").isVisible());
    const deleteURL = "**/api/offers/" + draftIds[0];
    await page.route(deleteURL, (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({
            status: 503,
            json: { error: "Simulierter Löschfehler" },
          })
        : route.continue(),
    );
    await draft
      .getByRole("button", { name: "Entwurf löschen", exact: true })
      .click();
    await offers
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await offers
      .locator("dialog.phb-messagebox[open]")
      .getByText("Simulierter Löschfehler", { exact: true })
      .waitFor();
    await offers
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "OK", exact: true })
      .click();
    assert(await offers.locator("#offerWorkflowDialog").isVisible());
    await page.unroute(deleteURL);
    await draft
      .getByRole("button", { name: "Entwurf löschen", exact: true })
      .click();
    await offers
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await offers.locator("#offerWorkflowDialog").waitFor({ state: "hidden" });
    await offers.locator("#openOfferDrafts").click();
    await offers.locator('[data-offer-card="' + draftIds[1] + '"]').waitFor();
    await offers
      .getByRole("link", { name: "Kategorien verwalten ↗", exact: true })
      .click();
    await page.waitForURL("**/stammdaten#kategorien");
    assert.equal(
      await page
        .getByRole("tab", { name: "Kategorien", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await visit("Angebote");
    await offers.locator("#closeOfferWorkflow").click();
    console.log(
      "offer draft deletion, failure/cancel handling and category navigation passed",
    );
    await visit("Stammdaten");
    await page
      .getByRole("button", { name: "Firma anlegen", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Firmenname", exact: false })
      .fill("UI-Testfirma " + Date.now());
    const name = await page
      .getByRole("textbox", { name: "Firmenname", exact: false })
      .inputValue();
    const writes = requests.filter(
      (r) => r.url.endsWith("/api/contractors") && r.method === "POST",
    ).length;
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert(await page.getByText(name, { exact: true }).isVisible());
    assert.equal(
      requests.filter(
        (r) => r.url.endsWith("/api/contractors") && r.method === "POST",
      ).length - writes,
      1,
    );
    console.log("native company saved");
    await page
      .getByRole("button", { name: "Firma anlegen", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Firmenname", exact: false })
      .fill("Nicht speichern");
    await page.goBack();
    await page
      .getByRole("dialog", { name: "Bitte bestätigen", exact: true })
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    assert.equal(new URL(page.url()).pathname.replace(/^\/p\/1/,''), "/stammdaten");
    await page.waitForTimeout(350);
    await page.screenshot({
      path: "/tmp/react-guard-state.png",
      fullPage: true,
    });
    await page
      .getByRole("dialog", { name: "Neue Firma", exact: true })
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Bitte bestätigen", exact: true })
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    console.log("dirty guard passed");
    await visit("Energetische Planung");
    await page
      .getByRole("button", { name: "Förderung erfassen", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Maßnahme", exact: false })
      .fill("Förderung Browser-Test");
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert(
      await page
        .getByText("Förderung Browser-Test", { exact: true })
        .first()
        .isVisible(),
    );
    console.log("funding saved");
    await visit("Dokumente");
    await page
      .getByRole("button", { name: "Dokumente hochladen", exact: true })
      .click();
    await page.locator("input[type=file]").setInputFiles({
      name: "Browser-Test-" + Date.now() + ".txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Lokales Projektdokument für den UI-Browsertest. " + Date.now(),
      ),
    });
    await page
      .getByRole("button", { name: "Dateien einlesen", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Dokument pflegen", exact: true })
      .waitFor({ timeout: 20000 });
    await page
      .getByRole("dialog", { name: "Dokument pflegen", exact: true })
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    console.log("document uploaded and reviewed");
    const backgroundName = "Browser-Test-background-" + Date.now() + ".txt";
    await page
      .getByRole("button", { name: "Dokumente hochladen", exact: true })
      .click();
    await page.locator("input[type=file]").setInputFiles({
      name: backgroundName,
      mimeType: "text/plain",
      buffer: Buffer.from("Background document " + Date.now()),
    });
    await page
      .getByRole("textbox", { name: "Verarbeitung", exact: true })
      .click();
    await page
      .getByRole("option", {
        name: "Im Hintergrund – später prüfen",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Dateien einlesen", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Dokumente hochladen", exact: true })
      .waitFor({ state: "hidden" });
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
    await page
      .getByRole("button", { name: "Warteschlange", exact: true })
      .click();
    const queue = page.getByRole("dialog", {
      name: "Verarbeitung & Prüfung",
      exact: true,
    });
    await queue
      .getByText(backgroundName, { exact: true })
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Prüfen und bearbeiten", exact: true })
      .click({ timeout: 20000 });
    await page
      .getByRole("dialog", { name: "Dokument pflegen", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Titel", exact: false })
        .inputValue(),
      backgroundName.replace(/\.[^.]+$/, ""),
    );
    await page
      .getByRole("dialog", { name: "Dokument pflegen", exact: true })
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    console.log("background document review passed");

    await visit("Bauzeitenplan");
    const plan = page.frameLocator('iframe[title="Bauzeitenplan"]');
    await plan.locator("#newTask").click();
    await plan.locator("#taskForm [name=name]").fill("Browser-Arbeitspaket");
    await plan.locator("#taskForm button[type=submit]").click();
    await plan.locator("#overlay").waitFor({ state: "hidden" });
    await plan
      .locator("#gantt .task-name")
      .filter({ hasText: "Browser-Arbeitspaket" })
      .first()
      .waitFor();
    console.log("work package saved");
    await visit("Kredite & Eigenkapital");
    const finance = page.frameLocator('iframe[title="Kredite & Eigenkapital"]');
    await finance.locator("#newLoan").click();
    await finance.locator("#loanForm [name=name]").fill("UI-Testkredit");
    await finance.locator("#loanForm [name=principal]").fill("10000");
    await finance.locator("#loanSaveButton").click();
    await finance
      .locator("#loanSaveStatus")
      .filter({ hasText: "gespeichert" })
      .waitFor();
    await finance.locator("#closeLoan").click();
    await finance.locator("#loanDialog").waitFor({ state: "hidden" });
    assert(
      await finance
        .getByText("UI-Testkredit", { exact: true })
        .first()
        .isVisible(),
    );
    assert(
      new URL(page.url()).searchParams.has("loan_id"),
      "saved loan is deep-linked in parent URL",
    );
    console.log("loan saved");
    await visit("Rechnungen & Belege");
    let invoices = page.frameLocator(
      'iframe[title="Rechnungen & Belege"]:not([hidden])',
    );
    await invoices.locator("#openReceiptWorkflow").click();
    await invoices.locator("#upload input[type=file]").setInputFiles({
      name: "UI-Test-Rechnung-" + Date.now() + ".pdf",
      mimeType: "application/pdf",
      buffer: invoicePDF(),
    });
    await invoices.locator("#receiptUploadButton").click();
    await page.waitForURL(
      (url) => url.pathname.endsWith("/belege") && url.searchParams.has("receipt_id"),
      { timeout: 20000 },
    );
    invoices = page.frameLocator(
      'iframe[title="Rechnungen & Belege"]:not([hidden])',
    );
    await invoices.locator("#review").waitFor();
    await invoices.locator("#review [name=supplier]").fill("UI-Testlieferant");
    await invoices.locator("#review [name=document_date]").fill("2026-10-31");
    await invoices.locator("#review [name=gross_amount]").fill("120,00");
    await invoices.locator("#book").click();
    await invoices
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await invoices
      .locator("#receiptReviewState")
      .filter({ hasText: "Gebucht" })
      .waitFor();
    await invoices.locator("#closeReceiptWorkflow").click();
    await invoices
      .locator("#receiptWorkflowDialog")
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "review transition did not trigger an unrelated navigation warning",
    );
    console.log("retained PDF import and invoice booking passed");
    await visit("Kosten & Budget");
    await page.goBack();
    await page.waitForURL((url) => url.pathname.endsWith("/belege"));
    await page.goForward();
    await page.waitForURL("**/kosten");
    await page
      .getByRole("textbox", { name: "Darstellung", exact: true })
      .click();
    await page.getByRole("option", { name: "Dunkel", exact: true }).click();
    assert.equal(
      await page.locator("html").getAttribute("data-mantine-color-scheme"),
      "dark",
    );
    for (const name of [
      "Kosten & Budget",
      "Energetische Planung",
      "Stammdaten",
      "Dokumente",
    ]) {
      await visit(name);
      assert.equal(
        await page
          .locator("main")
          .evaluate((node) => getComputedStyle(node).backgroundColor),
        "rgb(16, 24, 34)",
      );
      assert.equal(
        await page
          .locator("html")
          .evaluate((node) =>
            getComputedStyle(node)
              .getPropertyValue("--mantine-color-body")
              .trim(),
          ),
        "#1c2835",
      );
    }
    await visit("Kosten & Budget");
    assert.equal(
      await page
        .locator("html")
        .evaluate((node) =>
          getComputedStyle(node)
            .getPropertyValue("--mantine-color-placeholder")
            .trim(),
        ),
      "#9db2bd",
    );
    assert.equal(
      await page
        .getByText("Rechnungen fachlich zuordnen", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByText("Aufträge ohne Arbeitspaket", { exact: true })
        .count(),
      0,
    );
    await page.screenshot({ path: "/tmp/phb-react-dark.png", fullPage: true });

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      locale: "de-DE",
    });
    mobile.on("pageerror", (e) => errors.push(e.message));
    await mobile.addInitScript(() =>
      localStorage.setItem("phb-sidebar-collapsed", "1"),
    );
    await mobile.goto(base + "/stammdaten");
    await mobile
      .getByRole("button", { name: "Navigation öffnen", exact: true })
      .click();
    await mobile
      .getByRole("link", { name: "Kosten & Budget", exact: true })
      .click();
    await mobile.waitForURL("**/kosten");
    await mobile
      .getByRole("button", { name: "Navigation öffnen", exact: true })
      .waitFor();
    await mobile.waitForTimeout(350); // Allow the sidebar transition to settle before layout capture.
    assert(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await mobile.screenshot({ path: "/tmp/phb-react-mobile.png" });
    await mobile.close();
    const failedView = await browser.newPage();
    failedView.on("pageerror", (e) => errors.push(e.message));
    await failedView.goto(base + "/kosten");
    await failedView.route("**/belege?*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/html",
        body: "<html><body>Temporarily unavailable</body></html>",
      }),
    );
    await failedView
      .getByRole("link", { name: "Rechnungen & Belege", exact: true })
      .click();
    await failedView
      .getByText("Ansicht konnte nicht geladen werden", { exact: true })
      .waitFor();
    await failedView.unroute("**/belege?*");
    await failedView
      .getByRole("button", { name: "Erneut laden", exact: true })
      .click();
    await failedView
      .frameLocator('iframe[title="Rechnungen & Belege"]:not([hidden])')
      .locator("#openReceiptWorkflow")
      .waitFor();
    await failedView.close();
    const consent = await browser.newPage();
    consent.on("pageerror", (e) => errors.push(e.message));
    let researchCalls = 0;
    await consent.route("**/api/ai/status", (route) =>
      route.fulfill({
        json: {
          connected: true,
          sharing: true,
          credits_acknowledged: false,
          email: "ui-test@example.test",
          usage: {},
        },
      }),
    );
    await consent.route("**/api/ai/models", (route) =>
      route.fulfill({
        json: { models: [{ slug: "test-model", name: "Testmodell" }] },
      }),
    );
    consent.on("request", (req) => {
      if (req.url().endsWith("/api/contractors/research")) researchCalls++;
    });
    await consent.goto(base + "/stammdaten");
    await consent.waitForFunction(
      () => window.PHBReactBridge?.ai.status().sharing,
    );
    await consent
      .getByRole("button", { name: "Firma anlegen", exact: true })
      .click();
    await consent
      .getByRole("textbox", { name: "Firmenname", exact: false })
      .fill("Verbindungstest");
    await consent
      .getByRole("textbox", { name: "Ansprechpartner", exact: true })
      .click();
    await consent
      .getByRole("button", { name: "Mit ChatGPT recherchieren", exact: true })
      .click();
    const connection = consent.getByRole("dialog", {
      name: "ChatGPT-Verbindung",
      exact: true,
    });
    await connection.waitFor();
    await connection.getByRole("checkbox").focus();
    await consent.keyboard.press("Tab");
    assert(
      await connection.evaluate((node) =>
        node.contains(document.activeElement),
      ),
    );
    await connection
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    assert.equal(
      await consent
        .getByRole("textbox", { name: "Firmenname", exact: false })
        .inputValue(),
      "Verbindungstest",
    );
    assert.equal(
      researchCalls,
      0,
      "missing consent never sends a research request",
    );
    await consent.close();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: persistent navigation, native company/funding/document workflows, upload review, retained work-package/loan saves, dirty guards, history and dark mode.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

function invoicePDF() {
  const text = [
    "UI Test Lieferant GmbH",
    "Rechnung " + Date.now(),
    "Datum 31.10.2026",
    "Gesamtbetrag 120,00 EUR",
  ];
  const stream =
    "BT /F1 12 Tf 50 780 Td 16 TL " +
    text.map((t) => "(" + t + ") Tj T*").join(" ") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      Buffer.byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += i + 1 + " 0 obj\n" + obj + "\nendobj\n";
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF";
  return Buffer.from(pdf);
}

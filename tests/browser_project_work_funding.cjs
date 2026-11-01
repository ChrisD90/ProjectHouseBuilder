/* Mutates only the disposable project specified in PHB_TEST_URL. No real AI calls. */
const { chromium } = require("../frontend/node_modules/playwright");
const assert = require("node:assert/strict");
const base = process.env.PHB_TEST_URL;
if (!base) throw Error("PHB_TEST_URL must point to a disposable project.");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (require("node:fs").existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : undefined),
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({ locale: "de-DE" }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const token = Date.now();
    await page.route("**/api/ai/status", (r) =>
      r.fulfill({
        json: {
          connected: true,
          sharing: true,
          credits_acknowledged: true,
          email: "fixture@example.test",
        },
      }),
    );
    await page.route("**/api/ai/models", (r) =>
      r.fulfill({ json: { models: [{ slug: "test", name: "Testmodell" }] } }),
    );
    let estimates = 0;
    await page.route("**/api/funding/estimate", async (r) => {
      estimates++;
      assert.equal(r.request().headers()["x-phb-ai"], "1");
      assert.equal(r.request().postDataJSON().consent, true);
      await new Promise((done) => setTimeout(done, 300));
      await r.fulfill({
        json: {
          eligible: true,
          amount: 3000,
          explanation: "Simulierte Förderorientierung",
          missing: [],
          assumptions: ["Fachliche Prüfung erforderlich"],
          sources: [
            {
              title: "BAFA",
              url: "https://www.bafa.de/DE/Energie/Effiziente_Gebaeude/effiziente_gebaeude_node.html",
            },
          ],
          notice:
            "Unverbindliche KI-Schätzung ohne Gewähr, keine Förderzusage.",
          checked_on: "2026-11-01",
        },
      });
    });
    const created = await page.request.post(base + "/api/offers/manual", {
      data: {
        vendor: "Browser Förderfenster " + token,
        gross: 20000,
        category: "Sonstiges",
      },
    });
    assert.equal(created.status(), 201, await created.text());
    const oid = (await created.json()).id;
    const accepted = await page.request.post(
      base + "/api/offers/" + oid + "/accept",
      { form: { mode: "offer", confirm: "true" } },
    );
    assert.equal(accepted.status(), 201, await accepted.text());
    await page.goto(base + "/angebote?offer_id=" + oid);
    let frame = page.frameLocator('iframe[title="Angebote"]:not([hidden])');
    await frame.locator("#offerDetailsDialog").waitFor();
    assert.equal(
      await frame.locator("#offerList [data-offer-unaccept]").count(),
      0,
    );
    assert.equal(
      await frame
        .locator('#offerDetailsContent [data-work-open="offer"]')
        .count(),
      0,
    );
    await frame.locator("#closeOfferDetails").click();
    await frame
      .locator(
        '#offerList [data-work-open="offer"][data-work-id="' + oid + '"]',
      )
      .click();
    const linked = page.getByRole("dialog", {
      name: "To-dos & Notizen",
      exact: true,
    });
    await linked
      .getByRole("button", { name: "Neues To-do", exact: true })
      .click();
    const title = "Angebotsrückfrage " + token;
    const editor = page.getByRole("dialog", {
      name: "Neues To-do",
      exact: true,
    });
    await editor
      .getByRole("textbox", { name: "Titel", exact: true })
      .fill(title);
    await editor
      .getByRole("textbox", { name: "Details", exact: true })
      .fill("Technische Werte bestätigen lassen");
    await editor
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await editor.waitFor({ state: "hidden" });
    await linked
      .getByRole("checkbox", {
        name: "To-do abschließen: " + title,
        exact: true,
      })
      .check();
    await linked
      .getByRole("checkbox", {
        name: "To-do wieder öffnen: " + title,
        exact: true,
      })
      .waitFor();
    await linked
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await page
      .getByRole("link", { name: "To-dos & Notizen", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Erledigte anzeigen", exact: true })
      .check();
    await page.getByText(title, { exact: true }).waitFor();
    await page
      .getByRole("checkbox", {
        name: "To-do wieder öffnen: " + title,
        exact: true,
      })
      .uncheck();
    await page
      .getByRole("checkbox", {
        name: "To-do abschließen: " + title,
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Eintrag bearbeiten: " + title,
        exact: true,
      })
      .click();
    await page
      .getByRole("textbox", { name: "Details", exact: true })
      .fill("Auch Liefertermin klären");
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", {
        name: "Angebot · Browser Förderfenster " + token,
        exact: true,
      })
      .click();
    frame = page.frameLocator('iframe[title="Angebote"]:not([hidden])');
    await frame.locator("#offerDetailsDialog").waitFor();
    assert.equal(
      await frame
        .locator('#offerDetailsContent [data-work-open="offer"]')
        .count(),
      0,
    );
    await frame.locator("#closeOfferDetails").click();
    await frame
      .locator(
        '#offerList [data-work-open="offer"][data-work-id="' + oid + '"]',
      )
      .click();
    await linked
      .getByText("Auch Liefertermin klären", { exact: true })
      .waitFor();
    await linked
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await frame.locator('[data-offer-edit="' + oid + '"]').click();
    await frame.locator("#reverseOfferAcceptance").click();
    await frame
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await frame.locator("#offerEditDialog").waitFor({ state: "hidden" });
    const offer = (
      await (await page.request.get(base + "/api/offers")).json()
    ).offers.find((o) => o.id === oid);
    assert.equal(offer.status, "Angebot");
    assert.equal(offer.acceptance_reversals.length, 1);
    console.log(
      "PASS: linked todos shared in both directions and acceptance reversed only in editor",
    );
    await page
      .getByRole("link", { name: "Energetische Planung", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Unterlagen hochladen", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Förderunterlagen hochladen", exact: true })
      .waitFor();
    const documentName = "isfp-" + token + ".txt";
    await page.locator("input[type=file]").setInputFiles({
      name: documentName,
      mimeType: "text/plain",
      buffer: Buffer.from("Individueller Sanierungsfahrplan Test " + token),
    });
    await page
      .getByRole("button", { name: "Dateien einlesen", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Förderunterlage prüfen", exact: true })
      .waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.waitForURL("**/energieplanung");
    await page.getByText("isfp-" + token, { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Förderung erfassen", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Förderung erfassen",
      exact: true,
    });
    await dialog
      .getByRole("textbox", { name: "Maßnahme", exact: true })
      .fill("Fenstersanierung " + token);
    const choose = async (label, option) => {
      await dialog.getByRole("textbox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await choose(
      "Angebot",
      "Browser Förderfenster " + token + " · Sonstiges · Angebot",
    );
    await choose("Zugeordnete Förderunterlagen", "isfp-" + token + " · iSFP");
    await dialog
      .getByRole("button", {
        name: "Förderhöhe unverbindlich schätzen",
        exact: true,
      })
      .click();
    assert(
      await dialog
        .getByRole("button", { name: "Mit ChatGPT schätzen", exact: true })
        .isDisabled(),
    );
    await dialog
      .getByRole("button", { name: "Voraussetzungen prüfen", exact: true })
      .click();
    await dialog.getByText("Bitte noch klären", { exact: true }).waitFor();
    assert.equal(estimates, 0);
    await choose("Programm für die Schätzung", "BAFA – Gebäudehülle (BEG EM)");
    for (const [label, value] of [
      ["Objekt-Postleitzahl", "80331"],
      ["Bauantrag / Bauanzeige am", "1990-01-01"],
      ["Geplanter Förderantrag am", "2027-02-01"],
      [
        "Maßnahme und technische Ausführung",
        "Fenster inklusive fachlich geprüfter technischer Mindestwerte",
      ],
    ])
      await dialog
        .getByRole("textbox", { name: label, exact: true })
        .fill(value);
    for (const [label, value] of [
      ["Wohneinheiten im Gebäude", "1"],
      ["Förderfähiger Angebotsanteil (€)", "15000"],
      ["Kostengrenze bereits ausgeschöpft (€)", "0"],
    ])
      await dialog
        .getByRole("textbox", { name: label, exact: true })
        .fill(value);
    for (const [label, value] of [
      ["Antragsteller", "Privateigentümer eines Wohngebäudes"],
      ["Nutzung", "Vollständig selbst genutzt"],
      ["Vorsteuerabzugsberechtigt?", "Nein"],
      ["Liefer-/Leistungsvertrag", "Noch nicht unterschrieben"],
      ["Ausführung bereits begonnen?", "Nein"],
      ["Energieberatung / erforderlicher Fachbetrieb eingebunden?", "Ja"],
      ["Technische Mindestanforderungen fachlich geprüft?", "Ja"],
      ["TPB / BzA-Nachweis", "Wird fachlich vorbereitet"],
      ["Doppelförderung / Steuerermäßigungen geprüft?", "Ja"],
      ["Passender geförderter iSFP vorhanden?", "Nein"],
    ])
      await choose(label, value);
    await dialog
      .getByRole("checkbox", { name: /Prüfangaben, ausgewähltes Angebot/ })
      .check();
    await dialog
      .getByRole("button", { name: "Mit ChatGPT schätzen", exact: true })
      .click();
    assert(
      await dialog
        .getByRole("button", { name: "Speichern", exact: true })
        .isDisabled(),
    );
    await dialog
      .getByText("Simulierte Förderorientierung", { exact: true })
      .waitFor();
    assert.equal(estimates, 1);
    assert.equal(
      await dialog
        .getByRole("textbox", { name: "Erwartet (€)", exact: true })
        .inputValue(),
      "0",
    );
    await dialog
      .getByRole("button", {
        name: "Als erwartete Förderung übernehmen",
        exact: true,
      })
      .click();
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    const funding = (
      await (await page.request.get(base + "/api/energy-planning")).json()
    ).funding.find((f) => f.name === "Fenstersanierung " + token);
    assert.equal(funding.expected, 3000);
    assert.equal(funding.confirmed, 0);
    assert.equal(funding.received, 0);
    assert.equal(funding.document_ids.length, 1);
    console.log(
      "PASS: direct funding document upload/review stays in funding, readiness gates AI, proposal requires explicit adoption/save",
    );
    await page.getByText("Fenstersanierung " + token, { exact: true }).click();
    const edit = page.getByRole("dialog", {
      name: "Förderung bearbeiten",
      exact: true,
    });
    await edit
      .getByRole("button", { name: "To-dos & Notizen", exact: true })
      .click();
    const fundingWork = page.getByRole("dialog", {
      name: "To-dos & Notizen",
      exact: true,
    });
    await fundingWork
      .getByRole("button", { name: "Neues To-do", exact: true })
      .click();
    const work = page.getByRole("dialog", { name: "Neues To-do", exact: true });
    await work.waitFor();
    await page.keyboard.press("Escape");
    await work.waitFor({ state: "hidden" });
    await fundingWork.waitFor();
    await edit.waitFor();
    await fundingWork
      .getByRole("button", { name: "Neues To-do", exact: true })
      .click();
    await work
      .getByRole("textbox", { name: "Titel", exact: true })
      .fill("Förderantrag nachreichen " + token);
    await work.getByRole("button", { name: "Speichern", exact: true }).click();
    await work.waitFor({ state: "hidden" });
    const all = (
      await (await page.request.get(base + "/api/project-work")).json()
    ).items;
    assert(
      all.some(
        (x) =>
          x.title === "Förderantrag nachreichen " + token &&
          x.source_type === "funding" &&
          x.source_id === funding.id,
      ),
    );
    await page.keyboard.press("Escape");
    await fundingWork.waitFor({ state: "hidden" });
    await edit.waitFor();
    await edit.getByRole("button", { name: "Schließen", exact: true }).click();
    await page
      .getByRole("link", { name: "To-dos & Notizen", exact: true })
      .click();
    await page.getByRole("button", { name: "Neue Notiz", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Titel", exact: true })
      .fill("Projektidee " + token);
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("tab", { name: "Notizen", exact: true }).click();
    await page.getByText("Projektidee " + token, { exact: true }).waitFor();
    await page
      .getByRole("textbox", { name: "Darstellung", exact: true })
      .click();
    await page.getByRole("option", { name: "Dunkel", exact: true }).click();
    await page.screenshot({
      path: "/tmp/phb-work-notes-dark.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: context capture from funding and independent notes, no page errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/* Run via dev/funding_plan_browser_smoke.py: fresh DB, fixture offers, simulated AI. */
const {
  chromium,
  expect,
} = require("../frontend/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const base = process.env.PHB_TEST_URL;
if (!base) throw Error("Use dev/funding_plan_browser_smoke.py.");
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
    const page = await browser.newPage({
        locale: "de-DE",
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/ai/models", (r) =>
      r.fulfill({ json: { models: [{ slug: "test", title: "Testmodell" }] } }),
    );
    await page.goto(base + "/p/1/energieplanung");
    await page
      .getByRole("button", { name: "Förderung planen", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Neue Förderplanung",
      exact: true,
    });
    await dialog
      .getByRole("textbox", { name: "Titel des Vorhabens", exact: true })
      .fill("Fensterprojekt");
    await dialog
      .getByRole("textbox", {
        name: "Maßnahme und technische Ausführung",
        exact: true,
      })
      .fill(
        "Neue dreifachverglaste Fenster, technische Ausführung wird fachlich bestätigt.",
      );
    await dialog
      .getByRole("button", { name: "Entwurf anlegen", exact: true })
      .click();
    const plan = page.getByRole("dialog", {
      name: "Förderung planen",
      exact: true,
    });
    await plan
      .getByRole("button", { name: "Prüfung vorbereiten", exact: true })
      .click();
    const consent = plan.getByRole("checkbox", {
      name: /Planungsangaben, ausgewählte Angebotspositionen/,
    });
    await consent.check();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    await page.route("**/api/funding/plans/*/check", async (route) => {
      await gate;
      await route.continue();
    });
    await plan
      .getByRole("button", { name: "Möglichkeiten prüfen", exact: true })
      .click();
    await expect(
      plan.getByRole("button", { name: "Schließen", exact: true }),
    ).toBeDisabled();
    await expect(
      plan.getByRole("button", { name: "Möglichkeiten prüfen", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      plan.getByText("Bauantragsdatum und Antragstermin ergänzen.", {
        exact: true,
      }),
    ).toBeVisible();
    assert.equal(
      await plan
        .getByRole("button", {
          name: "Als erwartete Förderung übernehmen",
          exact: true,
        })
        .count(),
      0,
    );
    const rows = (
      await (await page.request.get(base + "/api/energy-planning")).json()
    ).funding;
    const fid = rows.find((x) => x.name === "Fensterprojekt").id;
    assert.equal(rows.find((x) => x.id === fid).expected, 0);
    await plan.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(page.getByText("Noch offen", { exact: true })).toBeVisible();
    await page.getByText("Fensterprojekt", { exact: true }).click();
    await expect(
      plan.getByText("Bauantragsdatum und Antragstermin ergänzen.", {
        exact: true,
      }),
    ).toBeVisible();
    console.log(
      "PASS saved draft without offer, early orientation, questions resume, busy lock and unknown amount",
    );
    await plan.getByRole("button", { name: "Zurück", exact: true }).click();
    const choose = async (label, option) => {
      await plan.getByRole("textbox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await choose("Programm", "BAFA – Gebäudehülle (BEG EM)");
    for (const [label, value] of [
      ["Objekt-Postleitzahl", "80331"],
      ["Bauantrag / Bauanzeige am", "1990-01-01"],
      ["Geplanter Förderantrag am", "2027-02-01"],
    ])
      await plan.getByRole("textbox", { name: label, exact: true }).fill(value);
    await plan
      .getByRole("textbox", { name: "Wohneinheiten", exact: true })
      .fill("1");
    await choose("Antragsteller", "Privateigentümer eines Wohngebäudes");
    await choose("Nutzung", "Selbst genutzt");
    await plan
      .getByRole("button", { name: "Unterlagen hochladen", exact: true })
      .click();
    const upload = page.getByRole("dialog", {
      name: "Förderunterlagen hochladen",
      exact: true,
    });
    await upload
      .locator("input[type=file]")
      .setInputFiles({
        name: "Planungsunterlage.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Technische Unterlage zum Fördervorhaben"),
      });
    await upload
      .getByRole("button", { name: "Dateien einlesen", exact: true })
      .click();
    const document = page.getByRole("dialog", {
      name: "Förderunterlage prüfen",
      exact: true,
    });
    await document.waitFor({ timeout: 20000 });
    await document
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await document.waitFor({ state: "hidden" });
    await expect(
      plan.getByRole("textbox", { name: "Objekt-Postleitzahl", exact: true }),
    ).toHaveValue("80331");
    const linked = (
      await (await page.request.get(base + "/api/funding/plans/" + fid)).json()
    ).document_ids;
    assert.equal(linked.length, 1);

    await plan
      .getByRole("button", {
        name: "Vertrag, Beginn und Kostenbasis",
        exact: true,
      })
      .click();
    await choose("Liefer-/Leistungsvertrag", "Noch nicht unterschrieben");
    await choose("Ausführung bereits begonnen?", "Nein");
    await choose("Vorsteuerabzugsberechtigt?", "Nein");
    await plan
      .getByRole("textbox", {
        name: "Bereits genutzte förderfähige Kosten (€)",
        exact: true,
      })
      .fill("0");
    await choose("Weitere Förderung / Steuerermäßigungen geprüft?", "Ja");
    await plan
      .getByRole("button", {
        name: "Technik und fachliche Vorbereitung",
        exact: true,
      })
      .click();
    await choose("Passenden geförderten iSFP berücksichtigen?", "Nein");
    await choose(
      "Technische Mindestanforderungen fachlich geprüft?",
      "Noch fachlich zu bestätigen",
    );
    await choose(
      "Energieberatung / erforderlicher Fachbetrieb eingebunden?",
      "Nein",
    );
    await choose("TPB / BzA", "Noch nicht vorhanden");
    await plan.getByRole("button", { name: "Zurück", exact: true }).click();
    const offers = plan.getByRole("textbox", {
      name: "Angebote (optional für den Entwurf)",
      exact: true,
    });
    await offers.click();
    await page.getByRole("option", { name: /Plan-Angebot 1/ }).click();
    await offers.press("Escape");
    await offers.click();
    await page.getByRole("option", { name: /Plan-Angebot 2/ }).click();
    await offers.press("Escape");
    await plan.getByRole("button", { name: /Plan-Angebot 1 ·/ }).click();
    await plan.getByRole("checkbox", { name: /Fensterposition 1-2/ }).uncheck();
    await expect(
      plan.getByRole("textbox", {
        name: "Berücksichtigte förderfähige Kosten (€)",
        exact: true,
      }),
    ).toHaveValue(/^5\.000(?:,00)?$/);
    await plan.getByRole("button", { name: "Weiter", exact: true }).click();
    await plan
      .getByRole("button", { name: "Prüfung vorbereiten", exact: true })
      .click();
    await consent.check();
    await plan
      .getByRole("button", { name: "Förderung schätzen", exact: true })
      .click();
    await expect(
      plan.getByRole("heading", { name: /Unverbindliche Vorschau:/ }),
    ).toBeVisible();
    let current = await (
      await page.request.get(base + "/api/funding/plans/" + fid)
    ).json();
    assert.equal(current.funding.expected, 0);
    assert.equal(current.selections.length, 2);
    assert.equal(
      current.selections.find((x) => x.offer_id === 1).position_ids.length,
      1,
    );
    const amount = plan.getByRole("textbox", {
      name: "Als erwartet übernehmen (€)",
      exact: true,
    });
    await amount.fill("1500");
    await plan
      .getByRole("checkbox", { name: /Ich bestätige die gewählte Variante/ })
      .check();
    await plan
      .getByRole("button", {
        name: "Als erwartete Förderung übernehmen",
        exact: true,
      })
      .click();
    await expect(plan.getByText(/Übernommener Erwartungswert:/)).toContainText(
      "1.500,00",
    );
    current = await (
      await page.request.get(base + "/api/funding/plans/" + fid)
    ).json();
    assert.equal(current.funding.expected, 1500);
    assert.equal(current.funding.confirmed, 0);
    assert.equal(current.funding.received, 0);
    assert.equal(
      (await (await page.request.get(base + "/api/financing")).json()).events
        .length,
      0,
    );
    console.log(
      "PASS multiple offers, position costs, conditional checklist, saved AI range and explicit adoption without bookings",
    );
    await plan.getByRole("button", { name: "Schließen", exact: true }).click();
    await page.getByText("Fensterprojekt", { exact: true }).click();
    const manual = page.getByRole("dialog", {
      name: "Förderung bearbeiten",
      exact: true,
    });
    await manual.waitFor();
    await manual
      .getByRole("button", {
        name: "Förderplanung & Prüfbericht öffnen",
        exact: true,
      })
      .click();
    await plan.getByRole("button", { name: "Zurück", exact: true }).click();
    await choose("Nutzung", "Vermietet");
    await plan
      .getByRole("button", { name: "Prüfung vorbereiten", exact: true })
      .click();
    await expect(
      plan.getByText(/Grundlage geändert oder Prüfung/),
    ).toBeVisible();
    await expect(
      plan.getByRole("button", {
        name: "Als erwartete Förderung übernehmen",
        exact: true,
      }),
    ).toBeDisabled();
    current = await (
      await page.request.get(base + "/api/funding/plans/" + fid)
    ).json();
    assert.equal(current.funding.expected, 1500);
    await plan.getByRole("button", { name: "Schließen", exact: true }).click();
    await page.request.post(base + "/__fixture/connection", {
      data: { sharing: false },
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Förderung planen", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Förderung erfassen", exact: true }),
    ).toBeVisible();
    await page.getByText("Fensterprojekt", { exact: true }).click();
    await manual
      .getByRole("button", {
        name: "Förderplanung & Prüfbericht öffnen",
        exact: true,
      })
      .click();
    await expect(
      plan.getByRole("button", { name: "Möglichkeiten prüfen", exact: true }),
    ).toBeDisabled();
    await plan
      .getByRole("button", { name: "Entwurf speichern", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      )
      .toBe(false);
    await page.screenshot({ path: "/tmp/phb-funding-plan-mobile.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS stale-result protection, manual continuation, disconnected draft editing and mobile layout",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

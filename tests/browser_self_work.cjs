/* Disposable runner only: manual planning offline and opt-in simulated AI. */
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
    const page = await browser.newPage({
        locale: "de-DE",
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const owner = (
        await (
          await page.request.post(base + "/api/projects", {
            data: { title: "Eigenleistungsprüfung" },
          })
        ).json()
      ).project.id,
      headers = { "X-PHB-Project": String(owner) };
    const task = await page.request.post(base + "/api/tasks", {
      headers,
      data: {
        code: "E-1",
        name: "Wände streichen",
        trade: "Maler",
        execution_type: "Eigenleistung",
        duration: 3,
      },
    });
    assert.equal(task.status(), 201, await task.text());
    const before = await (
      await page.request.get(base + "/api/project", { headers })
    ).json();
    const costs = await (
      await page.request.get(base + "/api/costs", { headers })
    ).json();
    await page.goto(base + "/p/" + owner + "/eigenleistungen");
    await expect(
      page.getByRole("heading", { name: "Eigenleistungen", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Eigenleistung planen", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Neue Eigenleistung",
      exact: true,
    });
    await editor
      .getByRole("textbox", { name: "Bezeichnung", exact: true })
      .fill("Wohnzimmer streichen");
    await editor
      .getByRole("textbox", { name: "Was möchtest du machen?", exact: true })
      .fill("Wände auf festem Putz streichen.");
    await expect(
      editor.getByRole("button", { name: "Mit ChatGPT planen", exact: true }),
    ).toHaveCount(0);
    await editor
      .getByRole("textbox", {
        name: "Arbeitspaket verknüpfen (optional)",
        exact: true,
      })
      .click();
    await page
      .getByRole("option", { name: "E-1 · Wände streichen", exact: true })
      .click();
    await editor
      .getByRole("tab", { name: "Schritte (0)", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Arbeitsschritt hinzufügen", exact: true })
      .click();
    await editor
      .getByRole("textbox", { name: "Arbeitsschritt 1", exact: true })
      .fill("Abkleben");
    await editor
      .getByRole("checkbox", { name: "Schritt 1 erledigt", exact: true })
      .check();
    await editor
      .getByRole("tab", { name: "Material (0)", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Material hinzufügen", exact: true })
      .click();
    await editor
      .getByRole("textbox", { name: "Material 1", exact: true })
      .fill("Wandfarbe");
    await editor.getByRole("textbox", { name: "Menge", exact: true }).fill("5");
    await editor
      .getByRole("textbox", { name: "Einheit", exact: true })
      .fill("l");
    await editor
      .getByRole("textbox", { name: "Einzelpreis (€)", exact: true })
      .fill("12");
    await editor
      .getByRole("tab", { name: "Werkzeuge (0)", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Werkzeug hinzufügen", exact: true })
      .click();
    await editor
      .getByRole("textbox", { name: "Werkzeug 1", exact: true })
      .fill("Farbrolle");
    await editor
      .getByRole("textbox", { name: "Beschaffung", exact: true })
      .click();
    await page.getByRole("option", { name: "Mieten", exact: true }).click();
    await editor
      .getByRole("textbox", { name: "Geplante Kosten (€)", exact: true })
      .fill("10");
    await editor
      .getByRole("button", { name: "Eigenleistung speichern", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    const read = async () =>
      await (
        await page.request.get(base + "/api/self-work", { headers })
      ).json();
    let saved = (await read()).plans[0];
    assert.equal(saved.estimated_cost, 70);
    assert.equal(saved.steps[0].done, true);
    assert.deepEqual(
      await (await page.request.get(base + "/api/project", { headers })).json(),
      before,
    );
    assert.deepEqual(
      await (await page.request.get(base + "/api/costs", { headers })).json(),
      costs,
    );
    assert.equal(
      (
        await (
          await page.request.get(base + "/__fixture/self-work/state")
        ).json()
      ).calls,
      0,
    );
    console.log(
      "PASS offline DIY plan, steps, materials, tool rental and optional task link; schedule and budget untouched.",
    );
    await page.request.post(base + "/__fixture/self-work/connection", {
      data: { sharing: true },
    });
    await page.reload();
    await page
      .getByRole("button", { name: "ChatGPT-Verbindung", exact: true })
      .click();
    const connection = page.getByRole("dialog", {
      name: "ChatGPT-Verbindung",
      exact: true,
    });
    await connection
      .getByRole("textbox", { name: "Modell", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Testmodell 2", exact: true })
      .click();
    const modelInfo = connection.getByRole("button", {
      name: "Informationen zum Modell Testmodell 2",
      exact: true,
    });
    await modelInfo.click();
    await expect(
      page.getByText("Token-Nutzung", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Für dieses Modell wurde noch kein Token-Verbrauch gemeldet.",
        { exact: true },
      ),
    ).toBeVisible();
    await modelInfo.click();
    await connection
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "ChatGPT-Verbindung", exact: true }),
    ).toContainText("Testmodell 2");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ChatGPT-Verbindung", exact: true }),
    ).toContainText("Testmodell 2");
    await page
      .getByRole("button", {
        name: "Eigenleistung bearbeiten: Wohnzimmer streichen",
        exact: true,
      })
      .click();
    const edit = page.getByRole("dialog", {
      name: "Eigenleistung bearbeiten",
      exact: true,
    });
    await edit
      .getByRole("button", { name: "Mit ChatGPT planen", exact: true })
      .click();
    const ai = page.getByRole("dialog", {
      name: "Eigenleistung mit ChatGPT planen",
      exact: true,
    });
    await expect(
      ai.getByRole("button", { name: "Vorhaben besprechen", exact: true }),
    ).toBeDisabled();
    await ai
      .getByRole("checkbox", { name: /Ich möchte die Vorhabensangaben/ })
      .check();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    await page.route("**/api/self-work/ai/consult", async (route) => {
      await gate;
      await route.continue();
    });
    await ai
      .getByRole("button", { name: "Vorhaben besprechen", exact: true })
      .click();
    await expect(
      ai.getByRole("button", { name: "Schließen", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      ai.getByText("Wie groß ist die zu streichende Fläche?", { exact: true }),
    ).toBeVisible();
    await ai.getByRole("button", { name: "Schließen", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Bitte bestätigen", exact: true })
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    await expect(ai).toBeVisible();
    await expect(
      ai.getByRole("button", { name: "Planvorschlag erstellen", exact: true }),
    ).toHaveCount(0);
    await ai
      .getByRole("textbox", {
        name: "Deine Antwort oder Ergänzung",
        exact: true,
      })
      .fill("20 m², fester Putz, zwei Anstriche.");
    await ai
      .getByRole("button", { name: "Antwort senden", exact: true })
      .click();
    await expect(
      ai.getByRole("checkbox", {
        name: "Die Angaben reichen mir für einen Planvorschlag.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      ai.getByRole("button", { name: "Planvorschlag erstellen", exact: true }),
    ).toBeDisabled();
    await ai
      .getByRole("checkbox", {
        name: "Die Angaben reichen mir für einen Planvorschlag.",
        exact: true,
      })
      .check();
    await ai
      .getByRole("button", { name: "Planvorschlag erstellen", exact: true })
      .click();
    await expect(
      ai.getByRole("heading", { name: "Dein Planvorschlag", exact: true }),
    ).toBeVisible();
    assert.deepEqual((await read()).plans[0].steps, saved.steps);
    await ai
      .getByRole("button", {
        name: "Vorschlag übernehmen & bearbeiten",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog", { name: "Bitte bestätigen", exact: true })
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await expect(ai).toHaveCount(0);
    await edit
      .getByRole("textbox", { name: "Arbeitsschritt 1", exact: true })
      .fill("Untergrund prüfen und abkleben");
    await edit
      .getByRole("button", { name: "Eigenleistung speichern", exact: true })
      .click();
    await expect(edit).toHaveCount(0);
    saved = (await read()).plans[0];
    assert.equal(saved.steps[0].title, "Untergrund prüfen und abkleben");
    assert.equal(saved.steps[0].done, false);
    assert.equal(saved.materials[0].unit_price, null);
    console.log(
      "PASS opt-in interactive ChatGPT, busy lock, mutual readiness, preview, explicit replacement, manual correction and save.",
    );
    assert.equal(
      (
        await (
          await page.request.get(base + "/__fixture/self-work/state")
        ).json()
      ).last_model,
      "fixture-model-2",
    );
    await page
      .getByRole("button", {
        name: "Eigenleistung bearbeiten: Wohnzimmer streichen",
        exact: true,
      })
      .click();
    await edit
      .getByRole("button", { name: "Eigenleistung archivieren", exact: true })
      .click();
    await expect(edit).toHaveCount(0);
    await page.getByRole("textbox", { name: "Ansicht", exact: true }).click();
    await page.getByRole("option", { name: "Archiv", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Eigenleistung bearbeiten: Wohnzimmer streichen",
        exact: true,
      })
      .click();
    await edit
      .getByRole("button", { name: "Aus Archiv zurückholen", exact: true })
      .click();
    await expect(edit).toHaveCount(0);
    await page.getByRole("textbox", { name: "Ansicht", exact: true }).click();
    await page
      .getByRole("option", { name: "Aktuelle Vorhaben", exact: true })
      .click();
    for (const theme of ["light", "dark"])
      for (const width of [390, 1440]) {
        await page.evaluate(
          (theme) => localStorage.setItem("mantine-color-scheme-value", theme),
          theme,
        );
        await page.setViewportSize({ width, height: 1000 });
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "Eigenleistungen", exact: true }),
        ).toBeVisible();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        );
        await page
          .getByRole("button", {
            name: "Eigenleistung bearbeiten: Wohnzimmer streichen",
            exact: true,
          })
          .click();
        await expect(edit).toBeVisible();
        assert(
          await edit.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        );
        if (width === 390 && theme === "dark")
          await page.screenshot({
            path: "test-results/self-work-dark-mobile.png",
            animations: "disabled",
          });
        await edit
          .getByRole("button", { name: "Schließen", exact: true })
          .click();
      }
    await page
      .getByRole("button", {
        name: "Eigenleistung bearbeiten: Wohnzimmer streichen",
        exact: true,
      })
      .click();
    await edit
      .getByRole("button", { name: "Eigenleistung löschen", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Bitte bestätigen", exact: true })
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await expect(edit).toHaveCount(0);
    assert.equal((await read()).plans.length, 0);
    assert.deepEqual(errors, []);
    console.log("PASS archive/reopen/delete and responsive light/dark DIY UI.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

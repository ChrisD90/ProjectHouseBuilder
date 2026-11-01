/* Use a disposable server: creates projects, offers, phases, tasks, todos and notes. */
const {
  chromium,
  expect,
} = require("../frontend/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const base = process.env.PHB_TEST_URL;
if (!base) throw Error("Use a disposable PHB_TEST_URL.");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (require("node:fs").existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      locale: "de-DE",
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const stamp = Date.now();
    async function request(path, data) {
      const r = await page.request.post(base + path, { data });
      assert.equal(r.status(), 201, await r.text());
      return r.json();
    }
    const project = (
      await request("/api/projects", { title: "To-do Dialogtest " + stamp })
    ).project.id;
    const root = base + "/p/" + project;
    // API fixtures explicitly address the same project as the UI.
    async function fixture(path, data) {
      const r = await page.request.post(base + path, {
        headers: { "X-PHB-Project": String(project) },
        data,
      });
      assert.equal(r.status(), 201, await r.text());
      return r.json();
    }
    const offer = await fixture("/api/offers/manual", {
      vendor: "Dialogfirma " + stamp,
      gross: 1000,
      category: "Sonstiges",
    });
    const acceptance = await page.request.post(
      base + "/api/offers/" + offer.id + "/accept",
      {
        headers: { "X-PHB-Project": String(project) },
        form: { mode: "offer", confirm: "true" },
      },
    );
    assert.equal(acceptance.status(), 201, await acceptance.text());
    const phase = (
      await fixture("/api/phases", {
        title: "Dialogphase",
        start_date: "2027-01-01",
      })
    ).phase;
    const task = await fixture("/api/tasks", {
      code: "D1",
      name: "Dialogarbeitspaket",
      phase_id: phase.id,
      trade: "Sonstiges",
      duration: 3,
      status: "Offen",
    });
    await page.goto(root + "/angebote");
    const offers = page.frameLocator('iframe[title="Angebote"]');
    const offerButton = offers.locator(
      '#offerList [data-work-open="offer"][data-work-id="' + offer.id + '"]',
    );
    await offerButton.waitFor();
    assert(
      await offerButton.evaluate((el) =>
        el.previousElementSibling.hasAttribute("data-offer-invoices"),
      ),
    );
    await expect(offerButton.locator("[data-work-count]")).toBeHidden();
    await offerButton.click();
    const list = page.getByRole("dialog", {
      name: "To-dos & Notizen",
      exact: true,
    });
    await list.waitFor();
    await expect(offers.locator("#offerDetailsDialog")).toBeHidden();
    async function create(kind, title) {
      await list
        .getByRole("button", {
          name: kind === "note" ? "Neue Notiz" : "Neues To-do",
          exact: true,
        })
        .click();
      const editor = page.getByRole("dialog", {
        name: kind === "note" ? "Neue Notiz" : "Neues To-do",
        exact: true,
      });
      await editor
        .getByRole("textbox", { name: "Titel", exact: true })
        .fill(title);
      await editor
        .getByRole("textbox", { name: "Details", exact: true })
        .fill("Gemeinsamer Dialog");
      await expect(
        editor.getByRole("checkbox", { name: "Erledigt", exact: true }),
      ).toHaveCount(kind === "note" ? 0 : 1);
      await editor
        .getByRole("button", { name: "Speichern", exact: true })
        .click();
      await editor.waitFor({ state: "hidden" });
      await expect(list.getByText(title, { exact: true })).toBeVisible();
    }
    const title = "Rückfrage " + stamp;
    await create("todo", title);
    await expect(offerButton.locator("[data-work-count]")).toHaveText("1");
    await list
      .getByRole("checkbox", {
        name: "To-do abschließen: " + title,
        exact: true,
      })
      .check();
    await expect(
      list.getByRole("checkbox", {
        name: "To-do wieder öffnen: " + title,
        exact: true,
      }),
    ).toBeChecked();
    await list
      .getByRole("button", {
        name: "Eintrag bearbeiten: " + title,
        exact: true,
      })
      .click();
    let edit = page.getByRole("dialog", {
      name: "To-do bearbeiten",
      exact: true,
    });
    await edit
      .getByRole("textbox", { name: "Titel", exact: true })
      .fill(title + " geändert");
    await edit.getByRole("button", { name: "Schließen", exact: true }).click();
    let confirm = page.getByRole("dialog", {
      name: "Bitte bestätigen",
      exact: true,
    });
    await confirm
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    await expect(edit).toBeVisible();
    await edit.getByRole("button", { name: "Speichern", exact: true }).click();
    await edit.waitFor({ state: "hidden" });
    const updated = title + " geändert";
    await list
      .getByRole("button", { name: "Archivieren: " + updated, exact: true })
      .click();
    await expect(list.getByText(updated, { exact: true })).toHaveCount(0);
    await expect(offerButton.locator("[data-work-count]")).toBeHidden();
    await list
      .getByRole("checkbox", { name: "Archiv anzeigen", exact: true })
      .check();
    await expect(list.getByText(updated, { exact: true })).toBeVisible();
    await expect(
      list.getByRole("checkbox", {
        name: "To-do wieder öffnen: " + updated,
        exact: true,
      }),
    ).toBeDisabled();
    await list
      .getByRole("button", {
        name: "Wiederherstellen: " + updated,
        exact: true,
      })
      .click();
    await expect(list.getByText(updated, { exact: true })).toHaveCount(0);
    await list
      .getByRole("checkbox", { name: "Archiv anzeigen", exact: true })
      .uncheck();
    await expect(
      list.getByRole("checkbox", {
        name: "To-do wieder öffnen: " + updated,
        exact: true,
      }),
    ).toBeChecked();
    const note = "Angebotsnotiz " + stamp;
    await create("note", note);
    await list
      .getByRole("button", { name: "Archivieren: " + note, exact: true })
      .click();
    await list
      .getByRole("checkbox", { name: "Archiv anzeigen", exact: true })
      .check();
    await expect(list.getByText(note, { exact: true })).toBeVisible();
    await list
      .getByRole("button", { name: "Löschen: " + note, exact: true })
      .click();
    confirm = page.getByRole("dialog", {
      name: "Bitte bestätigen",
      exact: true,
    });
    await confirm
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await expect(list.getByText(note, { exact: true })).toHaveCount(0);
    await list.getByRole("button", { name: "Schließen", exact: true }).click();
    console.log(
      "PASS offer tile, live counter, shared editor, dirty guard, completion, archive/restore and delete",
    );

    await page
      .getByRole("link", { name: "Bauzeitenplan", exact: true })
      .click();
    const gantt = page.frameLocator('iframe[title="Bauzeitenplan"]');
    for (const [type, id, name] of [
      ["task", task.id, "Arbeitspaket-To-do"],
      ["phase", phase.id, "Bauphasen-To-do"],
    ]) {
      const trigger = gantt.locator(
        '#gantt [data-work-open="' + type + '"][data-work-id="' + id + '"]',
      );
      await trigger.click();
      await list.waitFor();
      await expect(gantt.locator("#overlay")).toBeHidden();
      await expect(gantt.locator("#phaseDialog")).toBeHidden();
      await create("todo", name);
      await expect(trigger.locator("[data-work-count]")).toHaveText("1");
      await list
        .getByRole("button", { name: "Schließen", exact: true })
        .click();
    }
    // Preserve both native dialog layers while opening and closing the shared source dialog.
    await gantt
      .locator('#gantt button.phase-edit[data-phase-id="' + phase.id + '"]')
      .click();
    await gantt.locator("#phaseTaskDetails").evaluate((el) => (el.open = true));
    await gantt.locator('[data-phase-task="' + task.id + '"]').click();
    await gantt.locator("#taskWorkButton button").click();
    await list.waitFor();
    await list
      .getByRole("button", {
        name: "Eintrag bearbeiten: Arbeitspaket-To-do",
        exact: true,
      })
      .click();
    edit = page.getByRole("dialog", { name: "To-do bearbeiten", exact: true });
    await edit.waitFor();
    await page.keyboard.press("Escape");
    await edit.waitFor({ state: "hidden" });
    await expect(list).toBeVisible();
    await list.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(gantt.locator("#overlay")).toBeVisible();
    await expect(gantt.locator("#phaseDialog")).toBeVisible();
    await gantt.locator("#closeTask").click();
    await expect(gantt.locator("#phaseDialog")).toBeVisible();
    await gantt.locator("#phaseWorkButton button").click();
    await list.waitFor();
    await expect(
      list.getByText("Bauphasen-To-do", { exact: true }),
    ).toBeVisible();
    await list.getByRole("button", { name: "Schließen", exact: true }).click();
    await gantt.locator("#closePhaseDialog").click();
    console.log(
      "PASS Gantt source buttons and counters; phase/task/source/editor dialog stacking retained",
    );

    await page
      .getByRole("link", { name: "To-dos & Notizen", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Neues To-do", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Erledigte anzeigen", exact: true })
      .check();
    await expect(page.getByText(updated, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Neue Notiz", exact: true }).click();
    edit = page.getByRole("dialog", { name: "Neue Notiz", exact: true });
    await edit
      .getByRole("textbox", { name: "Titel", exact: true })
      .fill("Freie Notiz");
    let posts = 0,
      release;
    const gate = new Promise((resolve) => (release = resolve));
    await page.route("**/api/project-work", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      await gate;
      await route.continue();
    });
    await edit.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(
      edit.getByRole("button", { name: "Speichern", exact: true }),
    ).toBeDisabled();
    await expect(
      edit.getByRole("button", { name: "Schließen", exact: true }),
    ).toBeDisabled();
    release();
    await edit.waitFor({ state: "hidden" });
    assert.equal(posts, 1);
    await expect(page.getByText("Freie Notiz", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Archivieren: Freie Notiz", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Archiv anzeigen", exact: true })
      .check();
    await expect(page.getByText("Freie Notiz", { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: "Wiederherstellen: Freie Notiz",
        exact: true,
      })
      .click();
    await page
      .getByRole("checkbox", { name: "Archiv anzeigen", exact: true })
      .uncheck();
    await page
      .getByRole("button", { name: "Löschen: Freie Notiz", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Bitte bestätigen", exact: true })
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await expect(page.getByText("Freie Notiz", { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Neues To-do", exact: true })
      .click();
    edit = page.getByRole("dialog", { name: "Neues To-do", exact: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      edit.getByRole("button", { name: "Speichern", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      )
      .toBe(false);
    await page.screenshot({ path: "/tmp/phb-work-dialog-mobile.png" });
    await edit
      .getByRole("textbox", { name: "Titel", exact: true })
      .fill("Eingabe nach Fehler behalten");
    await page.unroute("**/api/project-work");
    await page.route("**/api/project-work", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 500,
            json: { error: "Simulierter Speicherfehler" },
          })
        : route.continue(),
    );
    await edit.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(
      edit.getByText("Simulierter Speicherfehler", { exact: true }),
    ).toBeVisible();
    await expect(
      edit.getByRole("textbox", { name: "Titel", exact: true }),
    ).toHaveValue("Eingabe nach Fehler behalten");
    await expect(
      edit.getByRole("button", { name: "Speichern", exact: true }),
    ).toBeEnabled();
    await page.unroute("**/api/project-work");
    await edit.getByRole("button", { name: "Speichern", exact: true }).click();
    await edit.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS separate todo/note creation, shared central records, pending-write lock, error/retry, mobile layout and no page errors",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

/* Requires a disposable PHB_TEST_URL. Creates multiple projects and their records. */
const { chromium } = require("../frontend/node_modules/playwright"),
  assert = require("node:assert/strict");
const base = process.env.PHB_TEST_URL;
if (!base) throw Error("Use a disposable PHB_TEST_URL.");
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
    const context = await browser.newContext({ locale: "de-DE" });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const token = Date.now();
    await page.goto(base + "/");
    await page
      .getByRole("heading", { name: "Deine Projekte", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Neues Projekt", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Projekttitel", exact: true })
      .fill("Garten " + token);
    await page
      .getByRole("textbox", { name: "Art des Projekts", exact: true })
      .click();
    await page.getByRole("option", { name: "Garten", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Geplanter Projektstart", exact: true })
      .fill("2027-04-01");
    await page
      .getByRole("button", { name: "Projekt anlegen", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const projects = (
        await (await page.request.get(base + "/api/projects")).json()
      ).projects,
      project = projects.find((x) => x.title === "Garten " + token);
    assert(project);
    assert.equal(project.tasks, 0);
    assert.equal(project.forecast, 0);
    await page
      .getByRole("link")
      .filter({
        has: page.getByRole("heading", { name: project.title, exact: true }),
      })
      .click();
    await page.waitForURL("**/p/" + project.id + "/");
    await page
      .getByRole("link", { name: "Alle Projekte", exact: true })
      .waitFor();
    const frame = page.frameLocator('iframe[title="Bauzeitenplan"]');
    await frame.locator("#count").filter({ hasText: "0" }).waitFor();
    await frame.locator("#managePhases").click();
    await frame.locator("#phaseForm [name=title]").fill("Gartenphase");
    await frame.locator("#phaseForm [name=start_date]").fill("2027-04-01");
    await frame.locator("#phaseForm button[type=submit]").click();
    await frame
      .locator("#phaseList")
      .getByText("Gartenphase", { exact: true })
      .waitFor();
    await frame.locator("#closePhaseDialog").click();
    const header = { "X-PHB-Project": String(project.id) };
    let data = await (
      await page.request.get(base + "/api/project", { headers: header })
    ).json();
    const phase = data.phases.find((x) => x.title === "Gartenphase");
    assert(phase);
    await frame.locator("#newTask").click();
    await frame
      .locator("#taskForm [name=name]")
      .fill("Rasen vorbereiten " + token);
    await frame
      .locator("#taskForm [name=phase_id]")
      .selectOption(String(phase.id));
    await frame.locator("#taskForm button[type=submit]").click();
    await frame.locator("#overlay").waitFor({ state: "hidden" });
    const bar = frame.locator('.phase-bar[data-phase-id="' + phase.id + '"]');
    await bar.waitFor();
    const before = await bar.evaluate(
      (x) => getComputedStyle(x).backgroundColor,
    );
    await bar.click();
    await frame.locator("#completePhase").click();
    await frame
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    // Wait for the asynchronous completion/reload before closing its busy dialog.
    await frame.locator("#completePhase").waitFor({ state: "hidden" });
    await frame.locator("#closePhaseDialog").click();
    await frame.locator("#phaseDialog").waitFor({ state: "hidden" });
    await frame
      .locator('.phase-bar.is-complete[data-phase-id="' + phase.id + '"]')
      .waitFor();
    assert.notEqual(
      await bar.evaluate((x) => getComputedStyle(x).backgroundColor),
      before,
    );
    await frame
      .locator("#gantt .task-name")
      .filter({ hasText: "Rasen vorbereiten " + token })
      .click();
    assert(
      await frame
        .locator("#taskForm .task-dialog-actions #reopenTask")
        .isVisible(),
    );
    assert(!(await frame.locator("#taskForm button[type=submit]").isVisible()));
    assert(!(await frame.locator("#taskForm #delete").isVisible()));
    await frame.locator("#reopenTask").click();
    await frame
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await frame.locator("#taskForm button[type=submit]").waitFor();
    assert.equal(
      await frame.locator("#overlay .modalhead #complete").count(),
      0,
    );
    await frame.locator("#closeTask").click();
    assert.equal(
      await frame
        .locator('.phase-bar.is-complete[data-phase-id="' + phase.id + '"]')
        .count(),
      0,
    );
    console.log(
      "PASS: dashboard creation, scoped empty schedule, completed phase color, coherent task actions and reopen",
    );
    const result = await page.request.post(base + "/api/projects", {
      data: { title: "Hof " + token, kind: "Hof" },
    });
    assert.equal(result.status(), 201);
    const other = (await result.json()).project;
    const second = await context.newPage();
    second.on("pageerror", (e) => errors.push(e.message));
    await second.goto(base + "/p/" + other.id + "/");
    const otherFrame = second.frameLocator('iframe[title="Bauzeitenplan"]');
    await otherFrame.locator("#count").filter({ hasText: "0" }).waitFor();
    await otherFrame.locator("#newTask").click();
    await otherFrame
      .locator("#taskForm [name=name]")
      .fill("Hof planen " + token);
    await otherFrame.locator("#taskForm button[type=submit]").click();
    await otherFrame.locator("#overlay").waitFor({ state: "hidden" });
    const a = await (
        await page.request.get(base + "/api/project", { headers: header })
      ).json(),
      b = await (
        await page.request.get(base + "/api/project", {
          headers: { "X-PHB-Project": String(other.id) },
        })
      ).json();
    assert.equal(a.tasks.length, 1);
    assert.equal(b.tasks.length, 1);
    assert(a.tasks[0].name.startsWith("Rasen vorbereiten"));
    assert(b.tasks[0].name.startsWith("Hof planen"));
    await page.getByRole("link", { name: "Stammdaten", exact: true }).click();
    await page
      .getByRole("button", { name: "Firma anlegen", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Firmenname", exact: false })
      .fill("Gartenbetrieb " + token);
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await second.getByRole("link", { name: "Stammdaten", exact: true }).click();
    assert.equal(
      await second.getByText("Gartenbetrieb " + token, { exact: true }).count(),
      0,
    );
    await page.getByRole("link", { name: "Dokumente", exact: true }).click();
    await page
      .getByRole("button", { name: "Dokumente hochladen", exact: true })
      .click();
    const name = "Gartenbeleg-" + token;
    await page.locator("input[type=file]").setInputFiles({
      name: name + ".txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Nur Garten " + token),
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
    await second.getByRole("link", { name: "Dokumente", exact: true }).click();
    const deadline = Date.now() + 20000;
    let document;
    while (Date.now() < deadline) {
      const list = await (
        await page.request.get(base + "/api/project-documents", {
          headers: header,
        })
      ).json();
      document = list.documents.find((d) => d.title === name);
      if (document) break;
      await page.waitForTimeout(200);
    }
    assert(document, "background upload saved in garden project");
    assert.equal(
      (
        await (
          await second.request.get(base + "/api/project-documents", {
            headers: { "X-PHB-Project": String(other.id) },
          })
        ).json()
      ).documents.length,
      0,
    );
    await page.getByRole("link", { name: "Stammdaten", exact: true }).click();
    await page.getByRole("link", { name: "Dokumente", exact: true }).click();
    const documentRow = page
      .locator(".mantine-Paper-root")
      .filter({ has: page.getByText(name, { exact: true }) })
      .last();
    const preview = documentRow.getByRole("link", {
      name: "Ansehen",
      exact: true,
    });
    assert(
      (await preview.getAttribute("href")).includes("project_id=" + project.id),
    );
    const popupPromise = page.waitForEvent("popup");
    await preview.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert(
      (await popup.locator("body").innerText()).includes("Nur Garten " + token),
    );
    await popup.close();
    assert.equal(
      (
        await page.request.get(
          base + "/api/project-documents/" + document.id + "/preview",
          { headers: { "X-PHB-Project": String(other.id) } },
        )
      ).status(),
      404,
    );
    await page
      .getByRole("link", { name: "Alle Projekte", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Deine Projekte", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Darstellung wechseln", exact: true })
      .click();
    await page.screenshot({
      path: "/tmp/phb-project-dashboard.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: separate tabs, firms, background queue ownership, scoped file links/previews and dashboard return",
    );
    await second.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

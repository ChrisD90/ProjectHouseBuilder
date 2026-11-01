/* Run only against a disposable PHB_TEST_URL. Exercises project lifecycle and offer detail themes. */
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
    const title = "Archivtest " + Date.now();
    await page.goto(base + "/");
    await page
      .getByRole("button", { name: "Neues Projekt", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Projekttitel", exact: true })
      .fill(title);
    await page
      .getByRole("button", { name: "Projekt anlegen", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const projects = (
      await (await page.request.get(base + "/api/projects")).json()
    ).projects;
    const project = projects.find((row) => row.title === title);
    assert(project?.can_delete);
    await page
      .getByRole("button", {
        name: "Projekt archivieren: " + title,
        exact: true,
      })
      .click();
    const archive = page.getByRole("button", {
      name: /Archivierte Projekte \(/,
    });
    await expect(archive).toBeVisible();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeHidden();
    await archive.click();
    await page
      .getByRole("button", {
        name: "Projekt wiederherstellen: " + title,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Projekt löschen: " + title, exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Leeres Projekt löschen",
      exact: true,
    });
    const remove = dialog.getByRole("button", {
      name: "Endgültig löschen",
      exact: true,
    });
    await expect(remove).toBeDisabled();
    await dialog
      .getByRole("textbox", {
        name: "Projekttitel zur Bestätigung",
        exact: true,
      })
      .fill("falsch");
    await expect(remove).toBeDisabled();
    await dialog
      .getByRole("textbox", {
        name: "Projekttitel zur Bestätigung",
        exact: true,
      })
      .fill(title);
    await remove.click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toHaveCount(0);
    const newProject = await (
      await page.request.post(base + "/api/projects", {
        data: { title: "Belegt " + title },
      })
    ).json();
    const owner = newProject.project.id;
    assert(owner > project.id);
    const headers = { "X-PHB-Project": String(owner) };
    const note = await page.request.post(base + "/api/project-work", {
      headers,
      data: { kind: "note", title: "Sperrt Löschung" },
    });
    assert.equal(note.status(), 201, await note.text());
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Projekt löschen: Belegt " + title,
        exact: true,
      }),
    ).toBeDisabled();
    const offer = await page.request.post(base + "/api/offers/manual", {
      headers,
      data: { vendor: "Darkmode " + title, gross: 1000, category: "Sonstiges" },
    });
    assert.equal(offer.status(), 201, await offer.text());
    const oid = (await offer.json()).id;
    const accepted = await page.request.post(
      base + "/api/offers/" + oid + "/accept",
      { headers, form: { mode: "offer", confirm: "true" } },
    );
    assert.equal(accepted.status(), 201, await accepted.text());
    await page.goto(base + "/p/" + owner + "/angebote?offer_id=" + oid);
    const frame = page.frameLocator('iframe[title="Angebote"]:not([hidden])');
    await expect(frame.locator("#offerDetailsDialog")).toBeVisible();
    await expect(
      frame.locator("#offerDetailsContent [data-work-open]"),
    ).toHaveCount(0);
    await expect(
      frame.locator(
        '#offerList [data-work-open="offer"][data-work-id="' + oid + '"]',
      ),
    ).toHaveCount(1);
    // Theme and semantic stage variations retain readable shared foregrounds and surfaces.
    for (const theme of ["dark", "light"]) {
      await page.evaluate((theme) => {
        localStorage.setItem("mantine-color-scheme-value", theme);
      }, theme);
      await page.reload();
      await expect(frame.locator("#offerDetailsDialog")).toBeVisible();
      for (const stage of ["normal", "warning", "overrun", "fully_billed"]) {
        const colors = await frame.locator(".offer-billing").evaluate(
          (element, { stage, theme }) => {
            element.className = "offer-billing offer-billing-" + stage;
            const body = document.body;
            if (document.documentElement.dataset.phbTheme !== theme)
              throw Error("Embedded theme was not propagated");
            const sample = document.createElement("span");
            sample.style.color = "var(--ui-ink)";
            body.append(sample);
            const ink = getComputedStyle(sample).color;
            sample.remove();
            return {
              foreground: getComputedStyle(element.querySelector("b")).color,
              ink,
              background: getComputedStyle(element).backgroundColor,
              theme:
                document.documentElement.dataset.theme || body.dataset.theme,
            };
          },
          { stage, theme },
        );
        assert.equal(colors.foreground, colors.ink, JSON.stringify(colors));
        assert.notEqual(colors.background, "rgba(0, 0, 0, 0)");
      }
      await page.screenshot({
        path: "/tmp/phb-offer-detail-" + theme + ".png",
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS project archive/reopen/delete safety and offer detail light/dark; tile to-dos retained.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

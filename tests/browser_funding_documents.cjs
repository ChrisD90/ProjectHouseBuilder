/* Requires a disposable PHB_TEST_URL. Creates a project, grant and local text documents. */
const {
  chromium,
  expect,
} = require("../frontend/node_modules/@playwright/test");
const assert = require("node:assert/strict");
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
    const page = await browser.newPage({
        locale: "de-DE",
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const token = Date.now();
    const created = await page.request.post(base + "/api/projects", {
      data: { title: "Förderunterlagen " + token },
    });
    assert.equal(created.status(), 201);
    const pid = (await created.json()).project.id;
    const headers = { "X-PHB-Project": String(pid) };
    const grant = await page.request.post(base + "/api/funding", {
      headers,
      data: { name: "Fördervorhaben " + token },
    });
    assert.equal(grant.status(), 200);
    const fid = (await grant.json()).id;
    const workspace = base + "/p/" + pid;
    await page.goto(workspace + "/energieplanung");
    const upload = page.getByRole("dialog", {
      name: "Förderunterlagen hochladen",
      exact: true,
    });
    const review = page.getByRole("dialog", {
      name: "Förderunterlage prüfen",
      exact: true,
    });
    await page
      .getByRole("button", { name: "Unterlagen hochladen", exact: true })
      .click();
    await upload.waitFor();
    assert.equal(new URL(page.url()).pathname, "/p/" + pid + "/energieplanung");
    await upload
      .locator("input[type=file]")
      .setInputFiles({
        name: "isfp-" + token + ".txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Individueller Sanierungsfahrplan"),
      });
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    await page.route("**/api/import-jobs/batches/**", async (route) => {
      await gate;
      await route.continue();
    });
    await upload
      .getByRole("button", { name: "Dateien einlesen", exact: true })
      .click();
    await expect(
      upload.getByRole("button", { name: "Schließen", exact: true }),
    ).toBeDisabled();
    await expect(
      upload.getByRole("button", { name: "Dateien einlesen", exact: true }),
    ).toBeDisabled();
    release();
    await review.waitFor({ timeout: 20000 });
    await expect(
      review.getByRole("textbox", { name: "Bereich", exact: true }),
    ).toBeDisabled();
    await review
      .getByRole("textbox", { name: "Titel", exact: true })
      .fill("Geprüfter iSFP " + token);
    await review
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await review.waitFor({ state: "hidden" });
    assert.equal(new URL(page.url()).pathname, "/p/" + pid + "/energieplanung");
    await expect(
      page.getByText("Geprüfter iSFP " + token, { exact: true }),
    ).toBeVisible();
    let docs = (
      await (
        await page.request.get(base + "/api/project-documents", { headers })
      ).json()
    ).documents;
    const first = docs.find((x) => x.title === "Geprüfter iSFP " + token);
    assert(first);
    const energy = (
      await (
        await page.request.get(base + "/api/energy-planning", { headers })
      ).json()
    ).documents;
    assert(energy.some((x) => x.id === first.id));
    console.log(
      "PASS header upload, foreground busy state, metadata review stays in funding; same original visible in document library",
    );

    await page.getByText("Fördervorhaben " + token, { exact: true }).click();
    const parent = page.getByRole("dialog", {
      name: "Förderung bearbeiten",
      exact: true,
    });
    await parent
      .getByRole("textbox", { name: "Notizen / Voraussetzungen", exact: true })
      .fill("Ungespeicherte Fördernotiz bleibt erhalten");
    await parent
      .getByRole("button", {
        name: "Unterlagen zu dieser Förderung hochladen",
        exact: true,
      })
      .click();
    await upload.waitFor();
    await page.keyboard.press("Escape");
    await upload.waitFor({ state: "hidden" });
    await expect(parent).toBeVisible();
    await parent
      .getByRole("button", {
        name: "Unterlagen zu dieser Förderung hochladen",
        exact: true,
      })
      .click();
    await upload
      .locator("input[type=file]")
      .setInputFiles({
        name: "nachweis-" + token + ".txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Technischer Nachweis"),
      });
    await upload
      .getByRole("textbox", { name: "Verarbeitung", exact: true })
      .click();
    await page
      .getByRole("option", {
        name: "Im Hintergrund – später prüfen",
        exact: true,
      })
      .click();
    await upload
      .getByRole("button", { name: "Dateien einlesen", exact: true })
      .click();
    await upload.waitFor({ state: "hidden" });
    await expect(parent).toBeVisible();
    await expect
      .poll(
        async () => {
          const jobs = (
            await (
              await page.request.get(base + "/api/import-jobs", { headers })
            ).json()
          ).jobs;
          return jobs.find((x) => x.filename === "nachweis-" + token + ".txt")
            ?.status;
        },
        { timeout: 20000 },
      )
      .toBe("Fertig");
    const jobs = (
      await (
        await page.request.get(base + "/api/import-jobs", { headers })
      ).json()
    ).jobs;
    const job = jobs.find((x) => x.filename === "nachweis-" + token + ".txt");
    assert.equal(
      job.review_url,
      "/energieplanung?funding_document=" +
        job.result_id +
        "&document_funding_id=" +
        fid,
    );
    // Exercise the same internal review navigation used by the queue, while grant edits remain dirty.
    await page.evaluate(
      (url) => window.PHBReactBridge.navigate(url),
      job.review_url,
    );
    await review.waitFor();
    await expect(parent).toBeVisible();
    await expect(
      parent.getByRole("textbox", {
        name: "Notizen / Voraussetzungen",
        exact: true,
      }),
    ).toHaveValue("Ungespeicherte Fördernotiz bleibt erhalten");
    await review
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await review.waitFor({ state: "hidden" });
    await expect(parent).toBeVisible();
    let funding = (
      await (
        await page.request.get(base + "/api/energy-planning", { headers })
      ).json()
    ).funding.find((x) => x.id === fid);
    assert.deepEqual(funding.document_ids, [job.result_id]);
    await parent
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await parent.waitFor({ state: "hidden" });
    funding = (
      await (
        await page.request.get(base + "/api/energy-planning", { headers })
      ).json()
    ).funding.find((x) => x.id === fid);
    assert.deepEqual(funding.document_ids, [job.result_id]);
    assert.equal(funding.notes, "Ungespeicherte Fördernotiz bleibt erhalten");
    console.log(
      "PASS background review routes to funding and links atomically; nested grant edits and document selection survive",
    );
    await page.getByRole("link", { name: "Dokumente", exact: true }).click();
    await expect(
      page.getByText("Geprüfter iSFP " + token, { exact: true }),
    ).toBeVisible();
    docs = (
      await (
        await page.request.get(base + "/api/project-documents", { headers })
      ).json()
    ).documents;
    assert.equal(
      docs.filter((x) => x.title === "Geprüfter iSFP " + token).length,
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS central document view retains a single original, no browser errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

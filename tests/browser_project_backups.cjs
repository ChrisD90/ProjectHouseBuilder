/* Requires a disposable server with a configured backup target. Never use production data. */
const {
  chromium,
  expect,
} = require("../frontend/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const base = process.env.PHB_TEST_URL;
if (!base)
  throw Error("Use a disposable PHB_TEST_URL with a configured backup folder.");
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
    async function create(path, data, owner) {
      const r = await page.request.post(base + path, {
        headers: owner ? { "X-PHB-Project": String(owner) } : {},
        data,
      });
      assert.equal(r.status(), 201, await r.text());
      return r.json();
    }
    const a = (await create("/api/projects", { title: "Backup A " + token }))
      .project.id;
    const b = (await create("/api/projects", { title: "Backup B " + token }))
      .project.id;
    for (const id of [a, b]) {
      await create(
        "/api/project-work",
        { title: "Bleibt " + id, kind: "note" },
        id,
      );
      const upload = await page.request.post(base + "/api/project-documents", {
        headers: { "X-PHB-Project": String(id) },
        multipart: {
          file: {
            name: "original.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("Original Projekt " + id),
          },
        },
      });
      assert.equal(upload.status(), 201, await upload.text());
    }
    const bBefore = (
      await (
        await page.request.get(base + "/api/project-work", {
          headers: { "X-PHB-Project": String(b) },
        })
      ).json()
    ).items;
    const bDocs = (
      await (
        await page.request.get(base + "/api/project-documents", {
          headers: { "X-PHB-Project": String(b) },
        })
      ).json()
    ).documents;
    const backupB = await create("/api/backup/create", {}, b);
    await page.goto(base + "/p/" + a + "/daten");
    const frame = page.frameLocator('iframe[title="Daten & Sicherung"]');
    await expect(frame.locator("#backupInfo")).toContainText(
      "Backup A " + token,
    );
    await frame
      .getByRole("button", {
        name: "Jetzt Projektbackup erstellen",
        exact: true,
      })
      .click();
    await expect(frame.locator("#dataNotice")).toContainText(
      "Projektbackup erstellt und geprüft",
    );
    const downloadEvent = page.waitForEvent("download");
    await frame
      .getByRole("link", { name: /Projektarchiv herunterladen/ })
      .click();
    const download = await downloadEvent;
    assert(download.suggestedFilename().startsWith("PHB_Project_" + a + "_"));
    await download.saveAs("/tmp/phb-browser-project-backup-" + a + ".zip");
    await frame.locator("#openRestore").click();
    await expect(frame.locator("#restoreBackupSelect option")).toHaveCount(2);
    assert(
      !(await frame.locator("#restoreBackupSelect").textContent()).includes(
        backupB.filename,
      ),
    );
    const other = await page.request.get(base + "/api/project-archive.zip", {
      headers: { "X-PHB-Project": String(b) },
    });
    assert.equal(other.status(), 200, await other.text());
    await frame
      .locator("#restoreBackupUpload")
      .setInputFiles({
        name: "other.zip",
        mimeType: "application/zip",
        buffer: await other.body(),
      });
    await frame.locator("#verifyRestore").click();
    await expect(frame.locator("#restoreVerifyInfo")).toContainText(
      "anderen Projekt",
    );
    await expect(frame.locator("#performRestore")).toBeDisabled();
    await frame
      .locator("#restoreBackupUpload")
      .setInputFiles("/tmp/phb-browser-project-backup-" + a + ".zip");
    await frame.locator("#verifyRestore").click();
    await expect(frame.locator("#restoreVerifyInfo")).toContainText(
      "Backup geprüft",
    );
    await create(
      "/api/project-work",
      { title: "Nach dem Backup", kind: "note" },
      a,
    );
    await frame.locator("#restorePhrase").fill("BACKUP WIEDERHERSTELLEN");
    await frame.locator("#performRestore").click();
    await frame
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await expect(frame.locator("#dataNotice")).toContainText(
      "Dieses Projekt wurde wiederhergestellt",
      { timeout: 15000 },
    );
    let aRows = (
      await (
        await page.request.get(base + "/api/project-work", {
          headers: { "X-PHB-Project": String(a) },
        })
      ).json()
    ).items;
    assert.deepEqual(
      aRows.map((x) => x.title),
      ["Bleibt " + a],
    );
    await frame.locator("#cancelRestore").click();
    await frame.locator("details.phb-danger summary").click();
    await frame.locator("#resetUnderstand").check();
    await frame.locator("#resetText").fill("ALLE DATEN LÖSCHEN");
    await frame.locator("#resetButton").click();
    await frame
      .locator("dialog.phb-messagebox[open]")
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await expect(frame.locator("#dataNotice")).toContainText(
      "Projekt zurückgesetzt",
    );
    aRows = (
      await (
        await page.request.get(base + "/api/project-work", {
          headers: { "X-PHB-Project": String(a) },
        })
      ).json()
    ).items;
    assert.deepEqual(aRows, []);
    assert.deepEqual(
      (
        await (
          await page.request.get(base + "/api/project-work", {
            headers: { "X-PHB-Project": String(b) },
          })
        ).json()
      ).items,
      bBefore,
    );
    const otherDocs = (
      await (
        await page.request.get(base + "/api/project-documents", {
          headers: { "X-PHB-Project": String(b) },
        })
      ).json()
    ).documents;
    assert.deepEqual(otherDocs, bDocs);
    const preview = await page.request.get(
      base + "/api/project-documents/" + otherDocs[0].id + "/preview",
      { headers: { "X-PHB-Project": String(b) } },
    );
    assert.equal(preview.status(), 200);
    assert((await preview.text()).includes("Original Projekt " + b));
    assert.deepEqual(errors, []);
    console.log(
      "PASS project-specific backup UI, scoped ZIP download, foreign backup rejection, restore and reset; other project records and originals unchanged",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

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
    await expect(editor.getByRole('button',{name:'Arbeitsschritt hinzufügen',exact:true})).toHaveCount(0);
    await editor.getByRole('button',{name:'Zurück zur Schrittliste',exact:true}).click();
    await editor.getByRole('checkbox',{name:'Schritt 1 erledigt',exact:true}).uncheck();
    await editor.getByRole('checkbox',{name:'Schritt 1 erledigt',exact:true}).check();
    await expect(editor.getByRole('textbox',{name:'Arbeitsschritt 1',exact:true})).toHaveCount(0);
    await expect(editor.getByRole('button',{name:'Details: Abkleben',exact:true})).toBeVisible();
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
    await editor.getByRole("button", {name:"Zurück zur Materialliste",exact:true}).click();
    const materialRow=editor.getByRole("button", {name:"Details: Wandfarbe",exact:true});
    await expect(materialRow).toContainText("5 l");
    await expect(materialRow).toContainText("ca.");
    await expect(editor.getByRole("textbox",{name:"Menge",exact:true})).toHaveCount(0);
    await materialRow.click();
    await expect(editor.getByRole("textbox",{name:"Menge",exact:true})).toHaveValue("5");
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
    await editor.getByRole("button",{name:"Zurück zur Werkzeugliste",exact:true}).click();
    const toolRow=editor.getByRole("button",{name:"Details: Farbrolle",exact:true});
    await expect(toolRow).toContainText("Mieten");
    await toolRow.click();
    await expect(editor.getByRole("textbox",{name:"Geplante Kosten (€)",exact:true})).toHaveValue("10");
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
    assert.equal(
      (await (await page.request.get(base + "/api/costs", { headers })).json()).summary.planned,
      costs.summary.planned + 70,
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
      "PASS offline DIY plan, steps, materials, tool rental and optional task link; schedule untouched and forecast includes planned DIY costs.",
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
    const modelInfo = page.getByRole("button", {
      name: "Informationen zum Modell Testmodell 2",
      exact: true,
    });
    await modelInfo.click();
    await expect(
      page.getByText("Für komplexe Planung mit ausführlichen Antworten.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      connection.getByRole("textbox", { name: "Modell", exact: true }),
    ).toHaveValue("Testmodell");
    await modelInfo.click();
    await page.setViewportSize({ width: 900, height: 480 });
    const astraInfo = page.getByRole("button", {
      name: "Informationen zum Modell GPT-6 Astra",
      exact: true,
    });
    await astraInfo.click();
    const guidePopover = page
      .locator(".mantine-Popover-dropdown")
      .filter({ hasText: "Maximale Qualität" });
    await expect(guidePopover).toContainText("API-Kosten im Standardmodus");
    const popoverBox = await guidePopover.boundingBox();
    assert.ok(popoverBox && popoverBox.y >= 15);
    assert.ok(popoverBox.y + popoverBox.height <= 465);
    const guideViewport = guidePopover.locator(".mantine-ScrollArea-viewport");
    await expect(guideViewport).toHaveCount(1);
    assert.equal(
      await guideViewport.evaluate((node) => node.scrollHeight > node.clientHeight),
      true,
    );
    await guideViewport.hover();
    await page.mouse.wheel(0, 700);
    await expect
      .poll(() => guideViewport.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await astraInfo.click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("option", { name: /^Testmodell 2/ })
      .click();
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
    await edit.getByRole('button',{name:'Details: Flächen vorbereiten',exact:true}).click();
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
    const longPlan=await page.request.post(base+'/api/self-work',{headers,data:{title:'Lange Listen',
      steps:Array.from({length:25},(_,i)=>({title:'Schritt '+(i+1),done:false})),
      materials:Array.from({length:25},(_,i)=>({title:'Material '+(i+1),quantity:2,unit:'Stück',unit_price:5})),
      tools:Array.from({length:25},(_,i)=>({title:'Werkzeug '+(i+1),source:'Kaufen',cost:10}))}});
    assert.equal(longPlan.status(),201);
    const longID=(await longPlan.json()).plan.id;
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    await page.getByRole('button',{name:'Eigenleistung bearbeiten: Lange Listen',exact:true}).click();
    for(const [tabName,itemName,backName,addName] of [
      ['Schritte (25)','Schritt 25','Zurück zur Schrittliste','Arbeitsschritt hinzufügen'],
      ['Material (25)','Material 25','Zurück zur Materialliste','Material hinzufügen'],
      ['Werkzeuge (25)','Werkzeug 25','Zurück zur Werkzeugliste','Werkzeug hinzufügen']]) {
      await edit.getByRole('tab',{name:tabName,exact:true}).click();
      if(tabName.startsWith('Schritte')) {
        const first=await edit.getByRole('button',{name:'Arbeitsschritt 1 verschieben',exact:true}).boundingBox();
        const third=await edit.getByRole('button',{name:'Arbeitsschritt 3 verschieben',exact:true}).boundingBox();
        await page.mouse.move(first.x+first.width/2,first.y+first.height/2);
        await page.mouse.down();
        await page.mouse.move(third.x+third.width/2,third.y+third.height/2,{steps:12});
        await page.mouse.up();
        await expect(edit.locator('.self-work-step-link').first()).toHaveText('Schritt 2');
        await expect(edit.locator('.self-work-step-link').nth(2)).toHaveText('Schritt 1');
        const grip=edit.getByRole('button',{name:'Arbeitsschritt 3 verschieben',exact:true});
        await grip.focus();await page.keyboard.press('Space');
        await expect(grip).toHaveAttribute('aria-pressed','true');
        await page.keyboard.press('ArrowUp');
        await expect(page.locator('[id^="DndLiveRegion-"]')).toContainText('Neue Position 2.');
        await page.keyboard.press('Space');
        await expect(edit.locator('.self-work-step-link').nth(1)).toHaveText('Schritt 1');
        const cancelGrip=edit.getByRole('button',{name:'Arbeitsschritt 2 verschieben',exact:true});
        await cancelGrip.focus();await page.keyboard.press('Space');
        await expect(cancelGrip).toHaveAttribute('aria-pressed','true');
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[id^="DndLiveRegion-"]')).toContainText('Neue Position 3.');
        await page.keyboard.press('Escape');
        await expect(edit.locator('.self-work-step-link').nth(1)).toHaveText('Schritt 1');
        await expect(edit.locator('.self-work-step-number').first()).toHaveText('1.');
      }
      const header=edit.locator('.self-work-list-header'),content=edit.locator('.self-work-list-content');
      const beforeHeader=await header.boundingBox();
      assert(await content.evaluate(n=>n.scrollHeight>n.clientHeight));
      await content.evaluate(n=>n.scrollTop=n.scrollHeight);
      const afterHeader=await header.boundingBox();
      assert(Math.abs(beforeHeader.y-afterHeader.y)<1);
      await expect(header.getByRole('button',{name:addName,exact:true})).toBeVisible();
      if(tabName.startsWith('Schritte')) await edit.getByRole('checkbox',{name:'Schritt 25 erledigt',exact:true}).check();
      await edit.getByRole('button',{name:'Details: '+itemName,exact:true}).click();
      await expect(header.getByRole('button',{name:addName,exact:true})).toHaveCount(0);
      await header.getByRole('button',{name:backName,exact:true}).click();
      assert(await edit.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    }
    await edit.getByRole('button',{name:'Eigenleistung speichern',exact:true}).click();
    await expect(edit).toHaveCount(0);
    assert.equal((await read()).plans[0].steps[24].done,true);
    assert.deepEqual((await read()).plans[0].steps.slice(0,3).map(x=>x.title),['Schritt 2','Schritt 1','Schritt 3']);
    await page.request.delete(base+'/api/self-work/'+longID,{headers});
    assert.deepEqual(errors, []);
    console.log("PASS archive/reopen/delete and responsive light/dark DIY UI.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const {
  test,
  expect,
} = require("../../frontend/node_modules/@playwright/test");
for (const theme of ["light", "dark"])
  for (const width of [390, 1440]) {
    test(`project card ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(
        (theme) => localStorage.setItem("mantine-color-scheme-value", theme),
        theme,
      );
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Deine Projekte", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".paper").first()).toHaveScreenshot(
        `project-card-${theme}-${width}.png`,
        { style: "* { font-family: Arial, sans-serif !important; }" },
      );
    });
    test(`receipt tools ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(
        (theme) => localStorage.setItem("mantine-color-scheme-value", theme),
        theme,
      );
      // A route fixture makes the screenshot independent of OCR, dates and random record IDs.
      await page.route("**/api/receipts*", async (route) => {
        if (new URL(route.request().url()).pathname != "/api/receipts")
          return route.continue();
        await route.fulfill({
          json: {
            categories: ["Dach", "Sonstiges"],
            trades: [],
            drafts: 0,
            booked_gross: 1250,
            paid: 1250,
            receipts: [
              {
                id: 7101,
                supplier: "Musterbetrieb Dach & Holz",
                filename: "Musterrechnung.pdf",
                invoice_number: "R-100",
                status: "Gebucht",
                gross_amount: 1250,
                counted_amount: 1250,
                paid_amount: 1250,
                category: "Dach",
                assignment_type: "Eigenleistung",
                document_date: "2026-01-15",
                labor_amount: 250,
                labor_source: "Manuell",
                payment_assignment: "Zugewiesen",
                unassigned_amount: 0,
              },
            ],
          },
        });
      });
      await page.goto("/p/1/belege");
      const frame = page.frameLocator('iframe[title="Rechnungen & Belege"]');
      const card = frame.locator(".receipt-entry-row").first();
      await expect(card).toBeVisible();
      await expect(card.locator("[data-work-open]")).toBeVisible();
      const status = await card.locator(".status").boundingBox();
      const assigned = await card
        .locator(".receipt-payment-badge")
        .boundingBox();
      const todo = await card.locator("[data-work-open]").boundingBox();
      const bounds = await card.boundingBox();
      expect(assigned.x).toBeGreaterThan(status.x + status.width);
      expect(todo.x).toBeGreaterThan(assigned.x + assigned.width);
      expect(
        Math.abs(bounds.x + bounds.width - todo.x - todo.width - 13),
      ).toBeLessThan(2);
      await expect(card).toHaveScreenshot(
        `receipt-card-${theme}-${width}.png`,
        { style: "* { font-family: Arial, sans-serif !important; }" },
      );
    });
  }

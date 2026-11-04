const {
  test,
  expect,
} = require("../../frontend/node_modules/@playwright/test");
for (const theme of ["light", "dark"])
  for (const width of [390, 1440]) {
    test(`DIY card ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(
        (theme) => localStorage.setItem("mantine-color-scheme-value", theme),
        theme,
      );
      await page.route("**/api/self-work", (route) =>
        route.fulfill({
          json: {
            tasks: [],
            plans: [
              {
                id: 9201,
                title: "Wohnzimmer selbst streichen",
                description:
                  "Wände vorbereiten und zweimal mit Dispersionsfarbe streichen.",
                location: "Wohnzimmer",
                experience: "Einsteiger",
                status: "In Arbeit",
                task_id: 301,
                task_label: "E-01 · Malerarbeiten",
                task_missing: false,
                steps: [
                  {
                    id: "a",
                    title: "Untergrund vorbereiten",
                    notes: "",
                    done: true,
                  },
                  { id: "b", title: "Wände streichen", notes: "", done: false },
                ],
                materials: [],
                tools: [],
                receipt_ids: [],
                receipts: [],
                actual_cost: 0,
                procured_material_cost: 0,
                notes: "",
                archived: false,
                estimated_cost: 125.5,
                costs_complete: true,
                updated_at: "2026-11-02T00:00:00",
              },
            ],
          },
        }),
      );
      await page.goto("/p/1/eigenleistungen");
      const card = page.locator(".self-work-card").first();
      await expect(card).toBeVisible();
      await expect(
        card.getByRole("button", {
          name: "Eigenleistung bearbeiten: Wohnzimmer selbst streichen",
          exact: true,
        }),
      ).toBeVisible();
      await expect(card).toHaveScreenshot(
        `self-work-card-${theme}-${width}.png`,
        { style: '* { font-family: "Liberation Sans", sans-serif !important; }' },
      );
    });
  }

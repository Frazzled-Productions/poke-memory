import { test, expect, type Page } from "@playwright/test";

async function seedSuperuser(
  page: Page,
  opts: { unlocked: boolean; pretendAllMastered: boolean },
): Promise<void> {
  await page.addInitScript((o) => {
    if (o.unlocked) {
      window.localStorage.setItem("poke-memory:superuser", "true");
    } else {
      window.localStorage.removeItem("poke-memory:superuser");
    }
    window.localStorage.setItem(
      "poke-memory:superuser:flags:v1",
      JSON.stringify({ pretendAllMastered: o.pretendAllMastered }),
    );
  }, opts);
}

test.describe("Stats page — badge gallery", () => {
  test("badge gallery section is visible on the stats page", async ({
    page,
  }) => {
    await page.goto("/stats");
    // Wait for the page to hydrate past the loading skeleton — the heading
    // only renders once stats are loaded.
    await expect(
      page.getByRole("heading", { level: 2, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("locked badges show hint text", async ({ page }) => {
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    // A fresh guest session has no earned badges; at least one locked tile
    // should be present. The Boulder Badge is the first catalog entry.
    await expect(
      page.getByLabel(/Boulder Badge \(locked\):/i).first(),
    ).toBeVisible();
  });

  test("pretendAllMastered shows all badges as earned", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    // Under the flag every badge tile has ", earned" in its accessible name.
    // Boulder Badge is the first catalog entry.
    await expect(
      page.getByLabel("Boulder Badge, earned"),
    ).toBeVisible();
  });
});

test.describe("Stats page — review charts", () => {
  test("the three new chart sections render", async ({ page }) => {
    await page.goto("/stats");
    // The recall-vs-target indicator, per-direction breakdown and difficulty
    // histogram are pure-derive, so they render even for a fresh guest with
    // an empty grade log (each shows its own empty state).
    await expect(
      page.getByRole("heading", { level: 2, name: "Recall vs target" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Accuracy by card direction",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Card difficulty spread" }),
    ).toBeVisible();
  });
});

test.describe("Stats page — Pokédex completion projection", () => {
  test("the completion projection section is visible for a guest with no history", async ({
    page,
  }) => {
    await page.goto("/stats");
    // The section always renders (either insufficient-history or projected).
    // A fresh guest session has no mastery history, so the heading and the
    // insufficient-history copy should both be present.
    await expect(
      page.getByRole("heading", { level: 2, name: "Pokédex completion" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Not enough data yet")).toBeVisible();
  });

  test("pretendAllMastered shows the completion state", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Pokédex completion" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Complete!")).toBeVisible();
  });
});

test.describe("Stats page — daily activity chart", () => {
  test("daily activity section renders with empty state for a guest", async ({
    page,
  }) => {
    await page.goto("/stats");
    // The section heading appears once the page has hydrated past the skeleton.
    await expect(
      page.getByRole("heading", { level: 2, name: "Daily activity" }),
    ).toBeVisible({ timeout: 15_000 });
    // A fresh guest session has no grade log — the empty-state message should
    // be visible instead of the chart.
    await expect(
      page.getByText("No activity recorded yet"),
    ).toBeVisible();
  });
});

test.describe("Stats page — accuracy window tabs", () => {
  test("switching accuracy windows updates the sparkline label", async ({
    page,
  }) => {
    await page.goto("/stats");
    // Wait for the page to hydrate past the loading skeleton.
    await expect(
      page.getByRole("heading", { level: 2, name: "Recent accuracy" }),
    ).toBeVisible({ timeout: 15_000 });

    // The window selector is a tablist with three tab buttons.
    const tablist = page.getByRole("tablist", { name: "Accuracy window" });
    await expect(tablist).toBeVisible();

    // Default window is 7d — the "7d" tab should be selected.
    const tab7d = page.getByRole("tab", { name: "7d" });
    await expect(tab7d).toHaveAttribute("aria-selected", "true");

    // Switch to 30d — the "30d" tab should become selected.
    const tab30d = page.getByRole("tab", { name: "30d" });
    await tab30d.click();
    await expect(tab30d).toHaveAttribute("aria-selected", "true");
    await expect(tab7d).toHaveAttribute("aria-selected", "false");

    // The sparkline SVG label should now reference the 30-day window.
    await expect(page.getByRole("img", { name: "30-day accuracy sparkline" })).toBeVisible();

    // Switch to 1yr.
    const tab1yr = page.getByRole("tab", { name: "1yr" });
    await tab1yr.click();
    await expect(tab1yr).toHaveAttribute("aria-selected", "true");
    await expect(tab30d).toHaveAttribute("aria-selected", "false");

    // The sparkline SVG label should now reference the 1-year window.
    await expect(page.getByRole("img", { name: "1-year accuracy sparkline" })).toBeVisible();
  });
});

test.describe("Stats page — mastery over time chart", () => {
  test("the mastery over time section is visible on a fresh guest session", async ({
    page,
  }) => {
    await page.goto("/stats");
    // The section heading is always rendered once the stats page hydrates.
    await expect(
      page.getByRole("heading", { level: 2, name: "Mastery over time" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows the empty state when no species are mastered", async ({
    page,
  }) => {
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Mastery over time" }),
    ).toBeVisible({ timeout: 15_000 });
    // A fresh guest has no mastered cards — the empty state copy should appear.
    await expect(
      page.getByText(/No mastered species yet/i),
    ).toBeVisible();
  });

  test("pretendAllMastered shows a non-zero mastery count", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Mastery over time" }),
    ).toBeVisible({ timeout: 15_000 });
    // Under the flag the headline count is the full species count — non-zero.
    // We can't assert the exact number without knowing the seed size, so just
    // confirm the empty-state copy is NOT shown.
    await expect(
      page.getByText(/No mastered species yet/i),
    ).not.toBeVisible();
  });
});

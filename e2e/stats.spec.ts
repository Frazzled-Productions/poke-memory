import { test, expect, type Page } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

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

test.describe("Stats page — review charts", () => {
  test("the three analytical chart sections render", async ({ page }) => {
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
    await expect(page.getByText("Projection not available yet")).toBeVisible();
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
  test("switching accuracy windows updates the selected tab", async ({
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

    // A fresh guest session has no accuracy data — the empty-state message
    // is shown instead of the sparkline SVG.
    await expect(
      page.getByText("No reviews yet in the last 7 days"),
    ).toBeVisible();

    // Switch to 30d — the "30d" tab should become selected and the 7d tab
    // deselected. The empty-state message updates to reflect the new window.
    const tab30d = page.getByRole("tab", { name: "30d" });
    await tab30d.click();
    await expect(tab30d).toHaveAttribute("aria-selected", "true");
    await expect(tab7d).toHaveAttribute("aria-selected", "false");
    await expect(
      page.getByText("No reviews yet in the last 30 days"),
    ).toBeVisible();

    // Switch to 1yr — same pattern.
    const tab1yr = page.getByRole("tab", { name: "1yr" });
    await tab1yr.click();
    await expect(tab1yr).toHaveAttribute("aria-selected", "true");
    await expect(tab30d).toHaveAttribute("aria-selected", "false");
    await expect(
      page.getByText("No reviews yet in the last year"),
    ).toBeVisible();
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

test.describe("Stats page — section headings", () => {
  test("analytical section headings are present", async ({ page }) => {
    await page.goto("/stats");
    // Wait for hydration.
    await expect(
      page.getByRole("heading", { level: 2, name: "Accuracy", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { level: 2, name: "Activity", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Scheduling", exact: true }),
    ).toBeVisible();
  });

  test("celebratory content (trainer card, badge gallery) has moved to Journey", async ({
    page,
  }) => {
    await page.goto("/stats");
    // Wait for the page to hydrate.
    await expect(
      page.getByRole("heading", { level: 2, name: "Accuracy", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    // Trainer card and badge gallery must NOT appear on Stats.
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Gym badges" }),
    ).toHaveCount(0);
  });
});

test.describe("Stats page — due forecast bar popup", () => {
  test("tapping a forecast bar reveals a popup with date and card count (mobile)", async ({
    page,
    isMobile,
  }) => {
    // This test targets the mobile tap flow. Skip on non-mobile projects
    // (the hover flow is covered by the desktop test below).
    test.skip(!isMobile, "mobile tap test - skipped on desktop project");

    await page.goto("/stats");

    // Wait for the Scheduling section to appear (due forecast is inside it).
    await expect(
      page.getByRole("heading", { level: 2, name: "Scheduling", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // The forecast chart is a list of bars. Each bar is a button.
    const forecastList = page.getByRole("list", { name: "14-day due forecast" });
    await expect(forecastList).toBeVisible();

    // Tap the first bar (Today).
    const firstBar = forecastList.getByRole("button").first();
    await expect(firstBar).toBeVisible();
    await firstBar.tap();

    // A tooltip should appear with a date and card count.
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    // The tooltip always shows a count in the form "N card(s)".
    await expect(tooltip).toContainText(/card/i);

    // Tapping outside the chart dismisses the popup.
    await page.getByRole("heading", { level: 1, name: "Stats" }).tap();
    await expect(tooltip).not.toBeVisible();
  });

  test("hovering a forecast bar reveals a popup with date and card count (desktop)", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "hover() is unreliable on the mobile-safari (Webkit touch) project",
    );

    await page.goto("/stats");

    // Wait for the Scheduling section to appear.
    await expect(
      page.getByRole("heading", { level: 2, name: "Scheduling", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    const forecastList = page.getByRole("list", { name: "14-day due forecast" });
    await expect(forecastList).toBeVisible();

    // Hover the first bar (Today).
    const firstBar = forecastList.getByRole("button").first();
    await firstBar.hover();

    // The tooltip should appear.
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/card/i);
  });

  test("keyboard: Enter on a forecast bar toggles the popup", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "keyboard focus navigation varies across projects",
    );

    await page.goto("/stats");

    await expect(
      page.getByRole("heading", { level: 2, name: "Scheduling", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    const forecastList = page.getByRole("list", { name: "14-day due forecast" });
    const firstBar = forecastList.getByRole("button").first();

    // Focus and activate the bar with keyboard.
    await firstBar.focus();
    await page.keyboard.press("Enter");

    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();

    // Pressing Enter again should close it.
    await page.keyboard.press("Enter");
    await expect(tooltip).not.toBeVisible();
  });
});

test.describe("Stats page — time-to-first-mastery hint (#1083)", () => {
  test("renders the hint when the user has introduced cards but none mastered", async ({
    page,
  }) => {
    // Seed two introduced-but-unmastered name cards. introduced > 0,
    // mastered === 0 → the hint should appear in the Scheduling section.
    await page.addInitScript(() => {
      const cards = [1, 4].map((id) => ({
        id,
        speciesId: id,
        cardType: "name",
        subjectKey: String(id),
        name: `Pokemon ${id}`,
        spriteUrl: `/sprites/pokemon/${id}.png`,
        types: ["normal"],
        state: {
          // Graduated but well below the 21-day mastery interval.
          stability: 1,
          difficulty: 5,
          elapsedDays: 0,
          scheduledDays: 1,
          reps: 1,
          lapses: 0,
          fsrsState: "review",
          dueDate: "2099-01-01",
          lastReview: "2026-05-19",
          firstSeen: "2026-05-19",
          learningStep: null,
          stepStartedAt: null,
          hiddenSince: null,
          seenInPasture: false,
        },
      }));
      window.localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify({
          cards,
          limits: {
            name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
            reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          },
        }),
      );
    });
    await page.goto("/stats");
    // Wait for hydration.
    await expect(
      page.getByRole("heading", { level: 2, name: "Scheduling", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    const hint = page.getByTestId("first-mastery-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("First mastery in roughly");
    await expect(hint).toContainText("if you keep reviewing daily");
  });

  test("hides the hint once at least one card is mastered", async ({
    page,
  }) => {
    // Seed one mastered card plus one not-yet-mastered card. mastered >= 1
    // suppresses the hint.
    await page.addInitScript(() => {
      const cards = [
        {
          id: 1,
          speciesId: 1,
          cardType: "name",
          subjectKey: "1",
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          types: ["grass", "poison"],
          state: {
            stability: 30,
            difficulty: 5,
            elapsedDays: 0,
            scheduledDays: 30,
            reps: 5,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2099-01-01",
            lastReview: "2025-01-01",
            firstSeen: "2024-12-01",
            learningStep: null,
            stepStartedAt: null,
            hiddenSince: null,
            seenInPasture: false,
          },
        },
        {
          id: 4,
          speciesId: 4,
          cardType: "name",
          subjectKey: "4",
          name: "Charmander",
          spriteUrl: "/sprites/pokemon/4.png",
          types: ["fire"],
          state: {
            stability: 1,
            difficulty: 5,
            elapsedDays: 0,
            scheduledDays: 1,
            reps: 1,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2099-01-01",
            lastReview: "2026-05-19",
            firstSeen: "2026-05-19",
            learningStep: null,
            stepStartedAt: null,
            hiddenSince: null,
            seenInPasture: false,
          },
        },
      ];
      window.localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify({
          cards,
          limits: {
            name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
            reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          },
        }),
      );
    });
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Scheduling", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("first-mastery-hint")).toHaveCount(0);
  });

  test("hides the hint when the pretendAllMastered superuser flag is on", async ({
    page,
  }) => {
    // Seed an introduced-but-unmastered name card so the introduced > 0 /
    // mastered === 0 gate would otherwise render the hint. The
    // pretendAllMastered flag should suppress the hint anyway — that is the
    // behaviour this test guards.
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.addInitScript(() => {
      const cards = [1, 4].map((id) => ({
        id,
        speciesId: id,
        cardType: "name",
        subjectKey: String(id),
        name: `Pokemon ${id}`,
        spriteUrl: `/sprites/pokemon/${id}.png`,
        types: ["normal"],
        state: {
          stability: 1,
          difficulty: 5,
          elapsedDays: 0,
          scheduledDays: 1,
          reps: 1,
          lapses: 0,
          fsrsState: "review",
          dueDate: "2099-01-01",
          lastReview: "2026-05-19",
          firstSeen: "2026-05-19",
          learningStep: null,
          stepStartedAt: null,
          hiddenSince: null,
          seenInPasture: false,
        },
      }));
      window.localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify({
          cards,
          limits: {
            name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
            reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          },
        }),
      );
    });
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Scheduling", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    // With pretendAllMastered on, computeStats overlays mastered = totalCards,
    // and projectTimeToFirstMastery short-circuits to null — both guards
    // independently hide the hint. The introduced > 0 gate is exercised by
    // the seed above, so this test now actually covers the superuser path.
    await expect(page.getByTestId("first-mastery-hint")).toHaveCount(0);
  });
});

test.describe("Stats page — streak protection card (#1227)", () => {
  test("renders with zero tokens for a fresh guest", async ({ page }) => {
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Streak protection" }),
    ).toBeVisible({ timeout: 15_000 });
    // 0 + " tokens" — verified via the explicit aria-label on the count.
    await expect(page.getByLabel("0 protection tokens")).toBeVisible();
  });

  test("reflects a seeded non-zero balance and shows the spend history line", async ({
    page,
  }) => {
    // Seed a settings record with two tokens held and one prior spend so the
    // card renders the balance and the history line. The Stats page also runs
    // `runStreakProtection` on mount; with a fresh single-day streakDates set
    // and yesterday gap, that pass is a no-op on this seed because the streak
    // was never alive before yesterday.
    await page.addInitScript(() => {
      const KEY = "poke-memory:settings:v1";
      const raw = localStorage.getItem(KEY);
      const existing =
        raw !== null
          ? (JSON.parse(raw) as Record<string, unknown>)
          : { mobileNav: "bottom" };
      const onboarding =
        typeof existing.onboarding === "object" && existing.onboarding !== null
          ? (existing.onboarding as Record<string, unknown>)
          : {};
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...existing,
          onboarding: { ...onboarding, firstVisitOnboardingDismissed: true },
          streakProtection: {
            balance: 2,
            spendDates: ["2026-05-08"],
            daysSinceLastEarn: 5,
            lastEarnCheckDate: "2026-05-09",
          },
        }),
      );
    });
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Streak protection" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("2 protection tokens")).toBeVisible();
    await expect(page.getByTestId("streak-protection-last-spend")).toBeVisible();
    await expect(page.getByTestId("streak-protection-last-spend")).toContainText(
      /Streak preserved on/,
    );
  });
});

test.describe("Stats page — heatmap hover tooltip", () => {
  test("hovering a heatmap cell shows a tooltip with the date and review count", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "hover() is unreliable on the mobile-safari (Webkit touch) project",
    );

    await page.goto("/stats");

    // Wait for the heatmap section to be present.
    const heatmapSvg = page.getByRole("img", { name: /heatmap/i });
    await expect(heatmapSvg).toBeVisible({ timeout: 15_000 });

    // Locate the first rect cell in the heatmap SVG and hover it.
    const firstCell = heatmapSvg.locator("rect").first();
    await firstCell.hover();

    // The tooltip should appear with a date and review count.
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    // Tooltip format: "<weekday>, <day> <Month> <year> - N review(s)"
    await expect(tooltip).toContainText(/review/i);
  });
});

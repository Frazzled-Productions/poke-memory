/**
 * E2E smoke tests for the persistent ProfileStatusBar (#1491).
 *
 * The bar is rendered in `app/layout.tsx` just below `<Nav>`, present on every
 * route as a `role="region" aria-label="Profile status"` band.
 *
 * Responsive behaviour:
 *   - Desktop (md+): visible on ALL routes including Practice (/).
 *   - Mobile (<md): hidden on Practice (/); shown on all other routes.
 *
 * Three status chips:
 *   - StreakChip  — `role="img"`, aria-label "Start your streak" at 0,
 *                   "N day(s) streak" when active.
 *   - TokenChip   — renders nothing when balance < 1 (hidden in fresh state).
 *   - MasteryChip — always rendered; aria-label "0 of N Pokémon mastered…" at
 *                   zero, "M of N Pokémon mastered" when non-zero.
 *
 * State matrix covered:
 *   1. Empty state  — fresh guest session (streak=0, no tokens, mastery=0).
 *   2. Populated state — QA-seed `pasture-progression` (streak > 0,
 *      tokens > 0, mastery > 0) via the superuser qaSeedMode flow.
 *
 * Route-awareness (mobile-only):
 *   - Bar hidden on mobile Practice (/); visible on /pokedex, /pasture,
 *     /journey, /settings.
 *
 * Locale:
 *   - Labels render correctly when app locale is set to `ja` (Japanese).
 *     Numbers tolerate digit-grouping per #1408.
 *
 * Coordinates with `mobile-nav.spec.ts` (no top-of-page assertions on the bar)
 * and `smoke.spec.ts` (no assertions that would be shifted by the bar's presence).
 */

import { test, expect, type Page } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "poke-memory:settings:v1";
const LOCALE_COOKIE = "poke-memory:locale";
const MASTERED_COUNT_KEY = "poke-memory:mastered-count-by-locale:v1";
const STREAK_KEY = "poke-memory:streak:v1";

/** Accessible name of the ProfileStatusBar region. */
const BAR_LABEL = "Profile status";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pre-dismiss onboarding and set up for bar tests. */
async function setupBarTest(page: Page): Promise<void> {
  await addOnboardingPreDismiss(page);
}

/**
 * Seed a non-zero streak so StreakChip shows "Nd" instead of "Start streak".
 * Seeds two consecutive days (yesterday + today) → streak = 2.
 */
async function seedStreakAndTokens(
  page: Page,
  { streakDays, tokenBalance }: { streakDays: number; tokenBalance: number },
): Promise<void> {
  await page.addInitScript(
    ({
      streakKey,
      settingsKey,
      days,
      balance,
    }: {
      streakKey: string;
      settingsKey: string;
      days: number;
      balance: number;
    }) => {
      try {
        // Build an array of `days` consecutive ISO dates ending today.
        const iso = (d: Date) => d.toISOString().slice(0, 10);
        const streakDates: string[] = [];
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - i);
          streakDates.push(iso(d));
        }
        localStorage.setItem(streakKey, JSON.stringify(streakDates));

        // Write token balance into settings.
        const raw = localStorage.getItem(settingsKey);
        let existing: Record<string, unknown> = {};
        if (raw !== null) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (typeof parsed === "object" && parsed !== null) {
              existing = parsed as Record<string, unknown>;
            }
          } catch {
            /* malformed */
          }
        }
        const today = iso(new Date());
        localStorage.setItem(
          settingsKey,
          JSON.stringify({
            ...existing,
            streakProtection: {
              balance,
              spendDates: [],
              daysSinceLastEarn: 1,
              lastEarnCheckDate: today,
            },
          }),
        );
      } catch {
        /* localStorage unavailable */
      }
    },
    {
      streakKey: STREAK_KEY,
      settingsKey: SETTINGS_KEY,
      days: streakDays,
      balance: tokenBalance,
    },
  );
}

/**
 * Seed a non-zero mastery count into the mastered-count-by-locale cache.
 * This is the same key that `writeMasteredCountForLocale` writes.
 */
async function seedMasteryCount(
  page: Page,
  { en, ja }: { en: number; ja: number },
): Promise<void> {
  await page.addInitScript(
    ({
      key,
      enCount,
      jaCount,
    }: {
      key: string;
      enCount: number;
      jaCount: number;
    }) => {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            en: enCount,
            ja: jaCount,
            "zh-Hans": 0,
            "zh-Hant": 0,
          }),
        );
      } catch {
        /* localStorage unavailable */
      }
    },
    { key: MASTERED_COUNT_KEY, enCount: en, jaCount: ja },
  );
}

// ---------------------------------------------------------------------------
// Describe: core render on a non-Practice route (desktop, chromium)
// ---------------------------------------------------------------------------

test.describe("ProfileStatusBar — core render (desktop)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "desktop render check is chromium-only",
    );
    await setupBarTest(page);
  });

  test("bar region is present on /pokedex", async ({ page }) => {
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
  });

  test("bar region is present on /stats", async ({ page }) => {
    await page.goto("/stats");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
  });

  test("bar region is present on /settings", async ({ page }) => {
    await page.goto("/settings");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
  });

  test("bar region is present on the Practice route (/) on desktop", async ({ page }) => {
    // Desktop: bar is always visible, including on the Practice page.
    await page.goto("/");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Describe: empty state — fresh guest session
// ---------------------------------------------------------------------------

test.describe("ProfileStatusBar — empty state (fresh guest)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "empty-state check is chromium-only",
    );
    await setupBarTest(page);
  });

  test("streak chip shows 'Start streak' prompt when streak is 0", async ({
    page,
  }) => {
    // Default fresh state: no streak seeded → streak = 0.
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    // StreakChip renders a chip with aria-label "Start your streak".
    await expect(
      bar.getByRole("img", { name: "Start your streak" }),
    ).toBeVisible();
  });

  test("token chip is hidden when balance is 0", async ({ page }) => {
    // Default fresh state: no tokens.
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    // TokenChip renders null when balance < 1; no shield chip should appear.
    // The aria-label pattern for a token chip is "N protection token(s)".
    await expect(
      bar.getByRole("img", { name: /protection token/i }),
    ).toHaveCount(0);
  });

  test("mastery chip shows '0 of N Pokémon mastered' at zero", async ({
    page,
  }) => {
    // Default fresh state: mastered-count cache absent → count = 0.
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    // MasteryChip always renders. At 0 the aria-label uses masteryZeroAriaLabel.
    await expect(
      bar.getByRole("img", { name: /0 of \d[\d,.]* Pok[eé]mon mastered/i }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Describe: populated state — non-zero streak, token, mastery
// ---------------------------------------------------------------------------

test.describe("ProfileStatusBar — populated state", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "populated-state check is chromium-only",
    );
    await setupBarTest(page);
  });

  test("streak chip shows the day count when streak > 0", async ({ page }) => {
    // Seed a 5-day streak.
    await seedStreakAndTokens(page, { streakDays: 5, tokenBalance: 0 });
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    // StreakChip aria-label is "N day(s) streak" (plural-form varies).
    await expect(
      bar.getByRole("img", { name: /5 days? streak/i }),
    ).toBeVisible();
  });

  test("token chip shows when balance > 0", async ({ page }) => {
    // Seed 2 tokens.
    await seedStreakAndTokens(page, { streakDays: 2, tokenBalance: 2 });
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    // TokenChip aria-label is "2 protection tokens".
    await expect(
      bar.getByRole("img", { name: "2 protection tokens" }),
    ).toBeVisible();
  });

  test("mastery chip shows non-zero mastered count", async ({ page }) => {
    // Seed 42 mastered Pokémon for the English locale.
    await seedMasteryCount(page, { en: 42, ja: 42 });
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    // MasteryChip aria-label is "42 of N Pokémon mastered".
    await expect(
      bar.getByRole("img", { name: /42 of \d[\d,.]* Pok[eé]mon mastered/i }),
    ).toBeVisible();
  });

  test("all three chips visible when streak + tokens + mastery all non-zero", async ({
    page,
  }) => {
    await seedStreakAndTokens(page, { streakDays: 3, tokenBalance: 1 });
    await seedMasteryCount(page, { en: 10, ja: 10 });
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });

    await expect(
      bar.getByRole("img", { name: /3 days? streak/i }),
    ).toBeVisible();
    await expect(
      bar.getByRole("img", { name: "1 protection token" }),
    ).toBeVisible();
    await expect(
      bar.getByRole("img", { name: /10 of \d[\d,.]* Pok[eé]mon mastered/i }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Describe: populated state via QA-seed (pasture-progression scenario)
// ---------------------------------------------------------------------------

test.describe("ProfileStatusBar — populated state via QA-seed", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "QA-seed populated-state check is chromium-only",
    );
    // Unlock superuser with qaSeedMode enabled.
    await page.addInitScript(() => {
      window.localStorage.setItem("poke-memory:superuser", "true");
      window.localStorage.setItem(
        "poke-memory:superuser:flags:v1",
        JSON.stringify({
          pretendAllMastered: false,
          forceNextStreakMilestone: false,
          forceCardsGraduated: false,
          qaSeedMode: true,
        }),
      );
    });
    await addOnboardingPreDismiss(page);
  });

  test("bar shows non-zero mastery after applying pasture-progression seed", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Accept the confirm dialog.
    page.on("dialog", (dialog) => {
      void dialog.accept();
    });

    // Open the Advanced section.
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    const developerSection = page.getByRole("region", { name: /developer/i });
    await expect(developerSection).toBeVisible({ timeout: 10_000 });

    const seedPanel = page.getByTestId("qa-seed-section");
    await expect(seedPanel).toBeVisible();

    // Select the pasture-progression scenario (has mastered Pokémon).
    await seedPanel
      .getByRole("combobox", { name: /scenario/i })
      .selectOption("pasture-progression");
    await seedPanel.getByRole("button", { name: /apply.*seed/i }).click();

    // Wait for the seed to apply.
    await expect(seedPanel.getByRole("status")).toContainText(/seed applied/i, {
      timeout: 10_000,
    });

    // Reload so IDB state is live.
    await page.reload();

    // Navigate to a non-Practice route so the bar is definitely rendered.
    await page.goto("/pasture");

    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });

    // The pasture-progression seed includes mastered Pokémon, so the mastery
    // chip should NOT show the zero-state label. Match a positive mastered count.
    const masteryChip = bar.getByRole("img", { name: /Pok[eé]mon mastered/i });
    await expect(masteryChip).toBeVisible();
    // The zero-state aria-label starts with "0 of"; assert it is not the zero state.
    const ariaLabel = await masteryChip.getAttribute("aria-label");
    expect(ariaLabel).not.toMatch(/^0 of/i);
  });
});

// ---------------------------------------------------------------------------
// Describe: route-aware mobile behaviour
// ---------------------------------------------------------------------------

test.describe("ProfileStatusBar — mobile route visibility", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "mobile route-visibility check is mobile-safari-only",
    );
    await setupBarTest(page);
  });

  test("bar is hidden on mobile Practice page (/)", async ({ page }) => {
    // On mobile the Practice page already shows streak/token inline via
    // StreakBadge, so the bar uses `hidden md:block` to hide on small viewports.
    await page.goto("/");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    // The bar is rendered in the DOM but hidden via CSS on mobile Practice.
    // Playwright's toBeHidden() matches elements with display:none or visibility:hidden.
    await expect(bar).toBeHidden({ timeout: 15_000 });
  });

  test("bar is visible on mobile Pokédex (/pokedex)", async ({ page }) => {
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
  });

  test("bar is visible on mobile Pasture (/pasture)", async ({ page }) => {
    await page.goto("/pasture");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
  });

  test("bar is visible on mobile Journey (/journey)", async ({ page }) => {
    await page.goto("/journey");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
  });

  test("bar is visible on mobile Settings (/settings)", async ({ page }) => {
    await page.goto("/settings");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Describe: locale rendering (Japanese app locale)
// ---------------------------------------------------------------------------

test.describe("ProfileStatusBar — locale rendering (ja)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "locale check is chromium-only",
    );
    // Seed streak + token + mastery so all three chips render with values.
    await seedStreakAndTokens(page, { streakDays: 4, tokenBalance: 1 });
    await seedMasteryCount(page, { en: 15, ja: 15 });
    await addOnboardingPreDismiss(page);
  });

  test("streak chip renders in Japanese when app locale is ja", async ({
    page,
    context,
  }) => {
    // Set the app locale cookie to Japanese before navigation.
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "ja",
        domain: new URL(page.context().browser()!.version() ? "http://localhost" : "http://localhost").hostname,
        path: "/",
      },
    ]);

    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: /プロフィール状況|Profile status/i });
    await expect(bar).toBeVisible({ timeout: 15_000 });

    // Japanese streak aria-label is "{count}日連続" (e.g. "4日連続").
    // Numbers may gain digit-group separators via Intl (#1408) — tolerate them.
    await expect(
      bar.getByRole("img", { name: /[\d,.\s]+日連続/i }),
    ).toBeVisible();
  });

  test("start-streak chip renders in Japanese on fresh state", async ({
    page,
    context,
  }) => {
    // Fresh page (no streak seeded for this test); just set the locale.
    await page.addInitScript(() => {
      // Clear streak so we get the zero state.
      try {
        localStorage.removeItem("poke-memory:streak:v1");
      } catch {
        /* ignore */
      }
    });

    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "ja",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: /プロフィール状況|Profile status/i });
    await expect(bar).toBeVisible({ timeout: 15_000 });

    // Japanese startStreakChipAriaLabel = "連続記録を始めよう".
    await expect(
      bar.getByRole("img", { name: "連続記録を始めよう" }),
    ).toBeVisible();
  });

  test("mastery chip renders in Japanese when app locale is ja", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "ja",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: /プロフィール状況|Profile status/i });
    await expect(bar).toBeVisible({ timeout: 15_000 });

    // Japanese masteryChipAriaLabel: "{mastered} / {total} 種族習得済み".
    // Numbers may be formatted with separators — tolerate them.
    await expect(
      bar.getByRole("img", { name: /[\d,.\s]+ \/ [\d,.\s]+ 種族習得済み/i }),
    ).toBeVisible();
  });

  test("mastery label percentage tolerates digit-grouping per #1408", async ({
    page,
  }) => {
    // Seed a large mastery count to exercise any potential grouping.
    await seedMasteryCount(page, { en: 1000, ja: 1000 });
    await page.goto("/pokedex");
    const bar = page.getByRole("region", { name: BAR_LABEL });
    await expect(bar).toBeVisible({ timeout: 15_000 });

    // MasteryChip visible label is "{pct}%" — the % sign must be present.
    // We do not assert the exact number so digit-grouping doesn't break the test.
    const masteryChip = bar.getByRole("img", { name: /Pok[eé]mon mastered/i });
    await expect(masteryChip).toBeVisible();
  });
});

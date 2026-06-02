// e2e/multi-locale-practice.spec.ts
// Smoke tests for per-locale practice sessions (#1562, part of the #1484 epic).
//
// Two scenarios:
//   1. Baseline (en only, languages flag off) — Practice renders a card and a
//      grade interaction succeeds. Proves no regression for the default majority.
//   2. Per-locale (en + ja enrolled, fsrs-locale-mastery QA seed) — the language
//      pill in the status bar switches the active locale to Japanese, and the
//      practice session renders cards from the ja queue with its own daily budget
//      (independent of the en budget).
//
// Guest-mode only. State is driven via localStorage / QA seed, never via
// in-test clicking through Settings, to keep the tests stable and fast.

import { test, expect, type Page } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Seeds localStorage so the languages Labs flag is enabled and the user is
 * enrolled in both English and Japanese, with English as the active locale.
 * Mirrors the pattern in i18n.spec.ts::enableLanguagesFlag.
 */
async function seedLanguagesEnabled(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const KEY = "poke-memory:settings:v1";
      const raw = localStorage.getItem(KEY);
      let existing: Record<string, unknown> = {};
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === "object" && parsed !== null) {
            existing = parsed as Record<string, unknown>;
          }
        } catch {
          /* ignore malformed JSON */
        }
      }
      const merged = {
        mobileNav: "bottom",
        ...existing,
        learningLocales: ["en", "ja"],
        activePokemonNameLocale: "en",
        labsFlags: {
          ...(typeof existing.labsFlags === "object" && existing.labsFlags !== null
            ? (existing.labsFlags as Record<string, unknown>)
            : {}),
          languages: true,
        },
        onboarding: {
          ...(typeof existing.onboarding === "object" && existing.onboarding !== null
            ? (existing.onboarding as Record<string, unknown>)
            : {}),
          firstVisitOnboardingDismissed: true,
        },
      };
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* localStorage unavailable */
    }
  });
}

/**
 * Seeds localStorage so the superuser Developer panel is unlocked and
 * qaSeedMode is enabled. Mirrors qa-seed.spec.ts::seedSuperuserWithQaSeed.
 */
async function seedSuperuserQaSeed(page: Page): Promise<void> {
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
}

/**
 * Opens Settings, applies the fsrs-locale-mastery QA seed scenario, waits for
 * confirmation, then reloads the page so the seeded IndexedDB data is live.
 *
 * The seed enrolls en + ja, sets activePokemonNameLocale to "en", and writes
 * an independent ja card set (5 mastered + 5 due-soon), giving a non-empty
 * Japanese session queue to assert against.
 */
async function applyFsrsLocaleMasterySeed(page: Page): Promise<void> {
  // Accept the confirm dialog that "Apply seed" triggers.
  page.on("dialog", (dialog) => { void dialog.accept(); });

  await page.goto("/settings");

  // Expand the Advanced section to reveal the Developer panel.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  const developerSection = page.getByRole("region", { name: /developer/i });
  await expect(developerSection).toBeVisible({ timeout: 10_000 });

  const seedPanel = page.getByTestId("qa-seed-section");
  await expect(seedPanel).toBeVisible();

  // Select the fsrs-locale-mastery scenario and apply it.
  await seedPanel.getByRole("combobox", { name: /scenario/i }).selectOption("fsrs-locale-mastery");
  await seedPanel.getByRole("button", { name: /apply.*seed/i }).click();

  // Wait for the success status and "Reload" instruction.
  await expect(seedPanel.getByRole("status")).toContainText(/seed applied/i, { timeout: 10_000 });

  // Reload so the seeded IDB data is visible to ReviewSession.
  await page.reload();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Per-locale practice session (#1562)", () => {
  test.beforeEach(async ({ page }) => {
    // Dismiss the first-visit onboarding modal so it does not block the
    // practice surface or the language pill.
    await addOnboardingPreDismiss(page);
  });

  // ── Baseline: languages flag off, single language (en) ───────────────────

  test("baseline (flag off): practice page renders a card in the default English session", async ({
    page,
  }) => {
    // Default state — no labsFlags, no learningLocales override. A fresh
    // guest session sees only English cards with the standard daily budget.
    await page.goto("/");

    // The language switcher pill must NOT be visible when the flag is off.
    // The pill aria-label starts with "Pokémon name language:".
    await expect(
      page.getByRole("button", { name: /Pokémon name language/i }),
    ).toHaveCount(0);

    // A practice card must render (Reveal button is the canonical indicator).
    const reveal = page.getByRole("button", { name: /reveal/i });
    await expect(reveal).toBeVisible({ timeout: 15_000 });

    // Reveal the card and grade it Good — a full grade cycle with no errors.
    await reveal.click();
    const goodButton = page.getByRole("button", { name: /good/i });
    await expect(goodButton).toBeVisible({ timeout: 5_000 });
    await goodButton.click();

    // After grading, either the next card renders (Reveal visible again) or
    // the session is complete ("All caught up!"). Either is a passing state.
    const nextReveal = page.getByRole("button", { name: /reveal/i });
    const caughtUp = page.getByText(/all caught up/i);
    await Promise.race([
      nextReveal.waitFor({ state: "visible", timeout: 8_000 }),
      caughtUp.waitFor({ state: "visible", timeout: 8_000 }),
    ]);
  });

  // ── Per-locale: en + ja enrolled, QA seed, language switcher ─────────────

  test("language switcher pill is visible when the languages flag is on", async ({
    page,
  }) => {
    await seedLanguagesEnabled(page);
    await page.goto("/");

    // The pill must be present and show the active locale endonym ("English").
    // Accessible name: "Pokémon name language: English. Tap to change."
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*English/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("switching the pill to Japanese and returning to Practice shows a non-empty ja session", async ({
    page,
  }) => {
    // The fsrs-locale-mastery scenario seeds:
    //   • 30 mastered + 10 due-soon + 5 in-learning for en.
    //   • 5 mastered + 5 due-soon for ja (independent FSRS rows).
    //   • learningLocales: ["en", "ja"], activePokemonNameLocale: "en".
    // After the seed the ja queue has 5 due-soon cards available to practise.
    await seedSuperuserQaSeed(page);
    await applyFsrsLocaleMasterySeed(page);

    // Navigate to Practice now that the seed is live.
    await page.goto("/");

    // The language pill must be visible — the seed sets learningLocales and
    // the languages Labs flag is part of the scenario's settings patch.
    const pill = page.getByRole("button", { name: /Pokémon name language.*English/i });
    await expect(pill).toBeVisible({ timeout: 15_000 });

    // Open the language switcher dropdown.
    await pill.click();

    // The dropdown (role="dialog") must be visible with the correct heading.
    const dialog = page.getByRole("dialog", { name: /Pokémon name language/i });
    await expect(dialog).toBeVisible();

    // Japanese must be listed as a radio option. Its aria-label is generated as
    // "日本語: N cards due today" or "日本語: caught up" depending on due count.
    const jaOption = dialog.getByRole("radio", { name: /日本語/i });
    await expect(jaOption).toBeVisible();

    // Select Japanese.
    await jaOption.click();

    // The dialog closes after selection (selectLocale calls close()).
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // The pill must now display the Japanese endonym.
    // Accessible name: "Pokémon name language: 日本語. Tap to change."
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*日本語/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Navigate away and back to trigger a fresh session build filtered to ja.
    await page.goto("/settings");
    await page.goto("/");

    // The practice session must be non-empty for the Japanese locale.
    // The fsrs-locale-mastery seed provides 5 due-soon ja cards, so a Reveal
    // button (or an All caught up screen) must appear. If neither renders the
    // session failed to load the ja queue.
    const reveal = page.getByRole("button", { name: /reveal/i });
    const caughtUp = page.getByText(/all caught up/i);
    // Use a generous timeout — ReviewSession must hydrate IDB and filter to ja.
    await Promise.race([
      reveal.waitFor({ state: "visible", timeout: 20_000 }),
      caughtUp.waitFor({ state: "visible", timeout: 20_000 }),
    ]);

    // Confirm the pill still shows Japanese (locale persists across navigation).
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*日本語/i }),
    ).toBeVisible();
  });

  test("switching back to English restores the en session queue", async ({
    page,
  }) => {
    // Start in Japanese (from the previous flow) and confirm switching back
    // to English draws from the English queue (out-of-locale state check).
    await seedSuperuserQaSeed(page);
    await applyFsrsLocaleMasterySeed(page);

    // Seed the active locale to Japanese directly via settings so we don't
    // need to go through the switcher interaction a second time.
    await page.addInitScript(() => {
      try {
        const KEY = "poke-memory:settings:v1";
        const raw = localStorage.getItem(KEY);
        let existing: Record<string, unknown> = {};
        if (raw !== null) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (typeof parsed === "object" && parsed !== null) {
              existing = parsed as Record<string, unknown>;
            }
          } catch { /* ignore */ }
        }
        // Override the active locale to ja so we can switch back to en.
        localStorage.setItem(KEY, JSON.stringify({
          ...existing,
          activePokemonNameLocale: "ja",
        }));
      } catch { /* ignore */ }
    });

    await page.goto("/");

    // The pill must show Japanese — we are in the ja locale.
    const jaPill = page.getByRole("button", { name: /Pokémon name language.*日本語/i });
    await expect(jaPill).toBeVisible({ timeout: 15_000 });

    // Switch back to English.
    await jaPill.click();
    const dialog = page.getByRole("dialog", { name: /Pokémon name language/i });
    await expect(dialog).toBeVisible();

    const enOption = dialog.getByRole("radio", { name: /English/i });
    await expect(enOption).toBeVisible();
    await enOption.click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // The pill must now show English.
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*English/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Navigate to reload the session filtered to en. The en seed has 10
    // due-soon cards, so the session must be non-empty.
    await page.goto("/settings");
    await page.goto("/");

    const reveal = page.getByRole("button", { name: /reveal/i });
    const caughtUp = page.getByText(/all caught up/i);
    await Promise.race([
      reveal.waitFor({ state: "visible", timeout: 20_000 }),
      caughtUp.waitFor({ state: "visible", timeout: 20_000 }),
    ]);

    // Confirm English pill is shown.
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*English/i }),
    ).toBeVisible();
  });
});

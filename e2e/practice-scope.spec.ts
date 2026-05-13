import { test, expect } from "@playwright/test";

// E2E smoke for #333 "Allow filtering which cards to learn".
//
// Issue #258 (PR #337) already shipped a practice-page scope filter
// (`ScopeControl`). #333 layers (a) cross-device persistence in UserSettings
// and (b) a snooze model that shifts hidden cards' dueDate forward, plus
// UI polish (Roman-numeral gens, type-colored chips, live count).
//
// This file covers two user-facing surfaces:
//   1. Practice page — open the Scope panel, click "Generation I", verify
//      a card still renders (NOT the no-match empty state).
//   2. Empty-state path — seed UserSettings with a no-match scope, navigate
//      to /, verify the "No Pokémon match your scope" empty-state and the
//      "Clear scope" CTA appear.
//
// Snooze / un-hide SRS shifting is covered by unit tests in
// lib/review/filters.test.ts — not duplicated here.

const SETTINGS_STORAGE_KEY = "poke-memory:settings:v1";

test.describe("Practice scope (#333)", () => {
  test.beforeEach(async ({ page }) => {
    // Fresh slate — drop any settings/session state from a prior test so
    // the scope starts at its empty default.
    await page.addInitScript(() => localStorage.clear());
  });

  test("happy path: scope to Generation I, practice page still shows a card", async ({
    page,
  }) => {
    await page.goto("/");

    // Open the Scope panel. The collapsed header is a button whose
    // accessible name combines "Scope" and the current label ("All Pokémon"
    // by default).
    const scopeToggle = page
      .getByRole("button", { expanded: false })
      .filter({ hasText: /scope/i })
      .first();
    await scopeToggle.click();
    const scopePanel = page.locator("#scope-panel");
    await expect(scopePanel).toBeVisible();

    // Scope to the expanded panel so "Generation I" doesn't clash with
    // any other surfaces that mention generations (e.g. trainer card).
    const genI = scopePanel.getByRole("button", { name: "Generation I" });
    await expect(genI).toHaveAttribute("aria-pressed", "false");
    await genI.click();
    await expect(genI).toHaveAttribute("aria-pressed", "true");

    // Live count should now be a non-zero subset of the total pool.
    // Using a flexible regex avoids hardcoding the species count, which grows
    // when alternate-form cards are added (#446 / #447).
    await expect(scopePanel.getByText(/of \d+ Pok[ée]mon match/)).toBeVisible();

    // A practice card should still render — the no-match empty-state must
    // NOT appear. Reveal button visible is the canonical "session running"
    // indicator across the existing E2E suite.
    const reveal = page.getByRole("button", { name: /reveal/i });
    const noMatch = page.getByText(/no Pok[ée]mon match your scope/i);
    await expect(reveal).toBeVisible();
    await expect(noMatch).not.toBeVisible();
  });

  test("no-match scope renders empty state with Clear scope CTA", async ({
    page,
  }) => {
    // Pick a scope with zero matching species:
    //   - gens: [1] (Gen I, ids 1..151)
    //   - types: ["dark"]
    // Dark-type was introduced in Gen II, so no Gen-I Pokémon has it.
    // Verified by inspecting lib/pokemon/generated.json (Gen I × dark = 0).
    await page.addInitScript(
      ({ key }) => {
        const settings = {
          masteryRepetitions: 3,
          maxNewPerDay: 10,
          maxReviewsPerDay: 100,
          maxNewEvolutionPerDay: 5,
          maxReviewsEvolutionPerDay: 50,
          nameCardsEnabled: true,
          evolutionCardsEnabled: true,
          reverseCardsEnabled: false,
          maxNewReversePerDay: 10,
          maxReviewsReversePerDay: 100,
          playCryOnReveal: false,
          cryCardsEnabled: false,
          maxNewCryPerDay: 10,
          maxReviewsCryPerDay: 100,
          favouriteTheme: null,
          retentionTarget: 0.9,
          practiceScope: { gens: [1], types: ["dark"], presets: [] },
        };
        localStorage.setItem(key, JSON.stringify(settings));
      },
      { key: SETTINGS_STORAGE_KEY },
    );

    await page.goto("/");

    // Empty-state copy. Component renders this in a styled <p>, not a
    // heading element, so match by visible text rather than role.
    await expect(
      page.getByText(/no Pok[ée]mon match your scope/i),
    ).toBeVisible();

    // The "Clear scope" CTA is the only escape hatch surfaced in the
    // empty state — must be visible and operable.
    const clearScope = page.getByRole("button", { name: /clear scope/i });
    await expect(clearScope).toBeVisible();

    // Clicking it should restore the normal session — Reveal becomes
    // visible, empty state disappears.
    await clearScope.click();
    await expect(page.getByRole("button", { name: /reveal/i })).toBeVisible();
    await expect(
      page.getByText(/no Pok[ée]mon match your scope/i),
    ).not.toBeVisible();
  });
});

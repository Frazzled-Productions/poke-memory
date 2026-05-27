/**
 * E2E smoke tests for verified typed entry mode (#1251).
 *
 * Scope: guest mode only. Tests verify the Settings toggle renders and that
 * the TypedEntryNameCard renders with its input + submit controls when the
 * setting is on, and that submitting triggers the grade flow.
 */

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  buildCompletedSession,
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
} from "./helpers/completedSession";

// Helper: write settings to localStorage with verifiedTypedEntryMode on.
async function enableTypedEntry(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      const KEY = "poke-memory:settings:v1";
      const raw = localStorage.getItem(KEY);
      let existing: Record<string, unknown> = { mobileNav: "bottom" };
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === "object" && parsed !== null) {
            existing = parsed as Record<string, unknown>;
          }
        } catch {
          /* malformed — keep defaults */
        }
      }
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...existing,
          verifiedTypedEntryMode: true,
          onboarding: {
            ...(typeof existing.onboarding === "object" && existing.onboarding !== null
              ? (existing.onboarding as Record<string, unknown>)
              : {}),
            firstVisitOnboardingDismissed: true,
          },
        }),
      );
    } catch {
      /* localStorage unavailable */
    }
  });
}

// Build a deterministic session where Bulbasaur (id=1) is the only due review
// card. All other cards are future-due so hydrateSession adds nothing new.
// Bulbasaur's canonical name is "Bulbasaur" (from the seed data), making the
// happy-path typed-entry test fully deterministic.
const baseSession = buildCompletedSession({
  pokemonIds: SEED_POKEMON_IDS,
  evolutionCardIds: EVOLUTION_CARD_IDS,
});
const SESSION_WITH_BULBASAUR_DUE = {
  ...baseSession,
  cards: (baseSession.cards as Array<{ id: number; [key: string]: unknown }>).map((c) =>
    c.id === 1
      ? {
          ...c,
          state: {
            stability: 10,
            difficulty: 5,
            elapsedDays: 10,
            scheduledDays: 10,
            reps: 3,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2026-01-01",
            lastReview: "2026-04-01",
            firstSeen: "2026-03-01",
            learningStep: null,
            stepStartedAt: null,
            hiddenSince: null,
            seenInPasture: false,
          },
        }
      : c,
  ),
  limits: {
    name: { maxNewPerDay: 0, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  },
};

// Build a session where Bulbasaur (id=1) is a new (learning-phase) name card.
// All other cards are future-due so hydrateSession adds nothing new. With
// verifiedTypedEntryMode on and lastReview===null, ReviewSession renders
// MultipleChoiceNameCard instead of the flip card or typed-entry input.
//
// Bulbasaur's deterministic 4 options (FNV-1a seeded on "1"):
//   Arbok | Cubone | Bulbasaur (correct) | Wartortle
// The correct answer is always "Bulbasaur" regardless of button order.
const SESSION_WITH_BULBASAUR_LEARNING = {
  ...baseSession,
  cards: (baseSession.cards as Array<{ id: number; [key: string]: unknown }>).map((c) =>
    c.id === 1
      ? {
          ...c,
          state: {
            stability: 0,
            difficulty: 5,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "new",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: null,
            learningStep: null,
            stepStartedAt: null,
            hiddenSince: null,
            seenInPasture: false,
          },
        }
      : c,
  ),
  limits: {
    name: { maxNewPerDay: 1, maxReviewsPerDay: 0 },
    evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  },
};

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("Verified typed entry — Settings toggle (#1251)", () => {
  test("the toggle is present in the Practice - Name cards section", async ({ page }) => {
    await page.goto("/settings");

    // Expand the Practice section.
    await page.getByRole("button", { name: /^practice$/i }).click();

    // The toggle should be visible.
    const toggle = page.getByRole("switch", {
      name: /verified typed entry for name cards/i,
    });
    await expect(toggle).toBeVisible();
    // Default: off.
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("toggling the switch marks it as checked and toggling again unchecks it", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();

    const toggle = page.getByRole("switch", {
      name: /verified typed entry for name cards/i,
    });

    // Turn on.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Turn off.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("Verified typed entry — Practice flow (#1251)", () => {
  test("with the setting on, a name card shows the text input instead of the Reveal button", async ({
    page,
  }) => {
    // Pre-seed Bulbasaur as the only due card so the input appears quickly,
    // avoiding the fresh-visitor hydration cliff on WebKit (#1262 / #1257).
    await enableTypedEntry(page);
    await seedSessionIdb(page, SESSION_WITH_BULBASAUR_DUE);
    await page.goto("/");
    await awaitSeedIdb(page);

    // The practice page should render without crashing.
    await expect(page.getByRole("main")).toBeVisible();

    // Wait for the session to load. With a pre-seeded session the input should
    // appear well within the default assertion timeout.
    await expect(
      page.getByRole("textbox", { name: /type the pokémon name/i }),
    ).toBeVisible({ timeout: 10000 });

    // The honour-system Reveal button should not be present.
    await expect(page.getByRole("button", { name: /^reveal$/i })).not.toBeVisible();

    // The Submit and I don't know buttons should be present.
    await expect(page.getByRole("button", { name: /^submit$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /i don.t know/i })).toBeVisible();
  });

  test("clicking I don't know fires a grade and moves off the input", async ({ page }) => {
    // Pre-seed Bulbasaur as the only due card so the input appears in <2 s,
    // avoiding the fresh-visitor hydration cliff under 2 050 cards (#1262 / #1257).
    await enableTypedEntry(page);
    await seedSessionIdb(page, SESSION_WITH_BULBASAUR_DUE);
    await page.goto("/");
    await awaitSeedIdb(page);

    // Wait for the typed-entry input to appear.
    const input = page.getByRole("textbox", { name: /type the pokémon name/i });
    await expect(input).toBeVisible({ timeout: 10000 });

    // Click I don't know — this should fire Again (1) and show feedback.
    await page.getByRole("button", { name: /i don.t know/i }).click();

    // After submitting, the input form disappears and feedback appears.
    await expect(input).not.toBeVisible();

    // Feedback copy for a wrong answer: "Not quite."
    await expect(page.getByText(/not quite/i)).toBeVisible();
  });

  test("typing the correct name and submitting shows 'Correct!' feedback", async ({ page }) => {
    // Seed typed-entry mode on, then seed Bulbasaur as the only due card so
    // we know the canonical name to type. Pre-seeding avoids the fresh-visitor
    // hydration cliff under 2 050 cards (#1262 / #1257).
    await enableTypedEntry(page);
    await seedSessionIdb(page, SESSION_WITH_BULBASAUR_DUE);
    await page.goto("/");
    await awaitSeedIdb(page);

    // With a pre-seeded session the input appears in <2 s (not the fresh-visitor
    // ~10 s cliff), so the default assertion timeout is sufficient.
    const input = page.getByRole("textbox", { name: /type the pokémon name/i });
    await expect(input).toBeVisible({ timeout: 10000 });

    // Type the exact canonical name (case-insensitive normalisation means any
    // casing works, but the exact cased name is the clearest happy-path signal).
    await input.fill("Bulbasaur");

    // Submit the answer.
    await page.getByRole("button", { name: /^submit$/i }).click();

    // The input form should disappear and the "Correct!" feedback should appear.
    await expect(input).not.toBeVisible();
    await expect(page.getByText(/correct!/i)).toBeVisible();
  });
});

test.describe("MC learning step — Practice flow (#1237)", () => {
  test("a new name card in learning phase shows 4 MC buttons, not the typed-entry input", async ({
    page,
  }) => {
    // Pre-seed typed-entry mode on + Bulbasaur in learning phase (lastReview: null).
    // With verifiedTypedEntryMode on and isInLearningPhase true, ReviewSession
    // renders MultipleChoiceNameCard instead of the typed-entry input.
    await enableTypedEntry(page);
    await seedSessionIdb(page, SESSION_WITH_BULBASAUR_LEARNING);
    await page.goto("/");
    await awaitSeedIdb(page);

    // The MC card renders 4 option buttons. We wait for any one of the expected
    // distractor names to confirm the MC card is present.
    // Bulbasaur's deterministic 4 options: Arbok, Cubone, Bulbasaur, Wartortle.
    await expect(
      page.getByRole("button", { name: /^Arbok$/i }),
    ).toBeVisible({ timeout: 10000 });

    // All 4 buttons must be present.
    await expect(page.getByRole("button", { name: /^Arbok$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cubone$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bulbasaur$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Wartortle$/i })).toBeVisible();

    // The typed-entry input must NOT be present.
    await expect(
      page.getByRole("textbox", { name: /type the pokémon name/i }),
    ).not.toBeVisible();
  });

  test("clicking the correct MC option shows 'Correct!' feedback", async ({ page }) => {
    // Same session: Bulbasaur in learning phase, typed-entry mode on.
    await enableTypedEntry(page);
    await seedSessionIdb(page, SESSION_WITH_BULBASAUR_LEARNING);
    await page.goto("/");
    await awaitSeedIdb(page);

    // Wait for the MC card to render.
    await expect(
      page.getByRole("button", { name: /^Bulbasaur$/i }),
    ).toBeVisible({ timeout: 10000 });

    // Click the correct answer.
    await page.getByRole("button", { name: /^Bulbasaur$/i }).click();

    // "Correct!" feedback should appear.
    await expect(page.getByText(/correct!/i)).toBeVisible();
  });
});

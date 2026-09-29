/**
 * E2E: practice-page Undo for a guest (#2052).
 *
 * #2052 changed how a grade is held before it reaches the cloud for SIGNED-IN
 * users (an undoable grade is parked on the device; Undo discards it, so the
 * cloud never sees it). Guests never sync, so their observable behaviour must
 * be unchanged: grade, Undo affordance appears, click it, the same card is
 * back in its revealed state and the affordance is gone. This spec locks that
 * in across the four supported UI locales and the card states a QA seed can
 * produce (graduated, mastered, relearning), on the real production build.
 *
 * Deferred (documented in the PR): signed-in network assertions (nothing
 * reaches /rest/v1 or /api/sync while Undo is available). There is no auth
 * stub in e2e, and a service worker only registers in prod builds and bypasses
 * page.route stubs (docs/testing.md, #1650 / #1773), so the cloud contract is
 * covered by unit tests over an in-memory fake Supabase
 * (components/sync/undoHoldAcceptance.test.tsx), the ReviewSession wiring
 * tests, and the real-Postgres integration test
 * (lib/sync/integration/beacon-grade-log.test.ts) instead.
 */
import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  buildCompletedSession,
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
} from "./helpers/completedSession";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

const LOCALE_COOKIE = "poke-memory:locale";

// Strings copied from messages/<locale>.json (practice.reveal,
// practice.gradeYourAnswer, practice.undoLastGradeAriaLabel).
const LOCALES = [
  { locale: "en", reveal: "Reveal", grade: "Grade your answer", undo: "Undo last grade" },
  { locale: "ja", reveal: "めくる", grade: "回答を採点する", undo: "最後の採点を取り消す" },
  { locale: "zh-Hans", reveal: "翻牌", grade: "为您的回答评分", undo: "撤销上次评分" },
  { locale: "zh-Hant", reveal: "翻牌", grade: "為您的回答評分", undo: "撤銷上次評分" },
] as const;

const STATES = {
  graduated: {
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
  // stability >= MASTERY_STABILITY_DAYS (21): a mastered species.
  mastered: {
    stability: 40,
    difficulty: 4,
    elapsedDays: 40,
    scheduledDays: 40,
    reps: 8,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-01-01",
    lastReview: "2026-04-01",
    firstSeen: "2026-01-01",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  },
  // A lapsed card in its relearning step, long overdue.
  relearning: {
    stability: 2,
    difficulty: 6,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 4,
    lapses: 1,
    fsrsState: "relearning",
    dueDate: "2026-04-01",
    lastReview: "2026-04-01",
    firstSeen: "2026-03-01",
    learningStep: 0,
    stepStartedAt: 1_000_000,
    hiddenSince: null,
    seenInPasture: false,
  },
} as const;

function sessionWith(state: (typeof STATES)[keyof typeof STATES]) {
  const base = buildCompletedSession({
    pokemonIds: SEED_POKEMON_IDS,
    evolutionCardIds: EVOLUTION_CARD_IDS,
  });
  return {
    ...base,
    // Bulbasaur (id 1) is the only due card; everything else is future-due so
    // hydrateSession adds nothing and the queue is exactly one card.
    cards: (base.cards as Array<{ id: number; [key: string]: unknown }>).map((c) =>
      c.id === 1 ? { ...c, state } : c,
    ),
    limits: {
      name: { maxNewPerDay: 0, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    },
  };
}

test.describe("Practice Undo (guest, #2052)", () => {
  // Keyboard-driven and engine-independent; one engine keeps the matrix
  // (4 locales x 3 states) cheap.
  test.skip(({ browserName }) => browserName !== "chromium", "chromium only");

  for (const { locale, reveal, grade, undo } of LOCALES) {
    for (const [stateName, state] of Object.entries(STATES)) {
      test(`grade then Undo restores the revealed card (${locale}, ${stateName})`, async ({
        page,
        context,
      }) => {
        await context.addCookies([
          { name: LOCALE_COOKIE, value: locale, domain: "localhost", path: "/" },
        ]);
        await addOnboardingPreDismiss(page);
        await seedSessionIdb(page, sessionWith(state));
        await page.goto("/");
        await awaitSeedIdb(page);

        const revealBtn = page.getByRole("button", { name: reveal, exact: true });
        await expect(revealBtn).toBeVisible({ timeout: 10_000 });
        // No Undo before any grade.
        await expect(page.getByRole("button", { name: undo })).toHaveCount(0);

        await page.keyboard.press("Space");
        const gradeGroup = page.getByRole("group", { name: grade });
        await expect(gradeGroup).toBeVisible();

        // "1" = Again.
        await page.keyboard.press("1");
        const undoBtn = page.getByRole("button", { name: undo });
        await expect(undoBtn).toBeVisible({ timeout: 10_000 });

        await undoBtn.click();

        // The undone card is back, already revealed, ready to be graded again;
        // the affordance is consumed.
        await expect(gradeGroup).toBeVisible();
        await expect(undoBtn).toHaveCount(0);
      });
    }
  }

  test("Cmd/Ctrl+Z also undoes the last grade", async ({ page }) => {
    await addOnboardingPreDismiss(page);
    await seedSessionIdb(page, sessionWith(STATES.graduated));
    await page.goto("/");
    await awaitSeedIdb(page);

    await expect(page.getByRole("button", { name: "Reveal", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.keyboard.press("Space");
    await page.keyboard.press("1");
    const undoBtn = page.getByRole("button", { name: "Undo last grade" });
    await expect(undoBtn).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.getByRole("group", { name: "Grade your answer" })).toBeVisible();
    await expect(undoBtn).toHaveCount(0);
  });
});

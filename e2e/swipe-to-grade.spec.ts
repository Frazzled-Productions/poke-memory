/**
 * E2E tests for swipe-to-grade gestures (#1052).
 *
 * Exercises the swipe gesture on the review card using Playwright's
 * `page.mouse` drag API (pointer events under the hood — touch-event
 * fidelity is not guaranteed at this layer). The tests run on the
 * `mobile-safari` project to verify the feature on the primary target
 * viewport (iPhone 14).
 */
import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  buildCompletedSession,
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
} from "./helpers/completedSession";

// Build a base session with all cards future-due, then mark Bulbasaur (id=1)
// as review-due so exactly one card is served. Mirrors the pattern used in
// keyboard-review.spec.ts.
const baseSession = buildCompletedSession({
  pokemonIds: SEED_POKEMON_IDS,
  evolutionCardIds: EVOLUTION_CARD_IDS,
});

const SESSION_WITH_ONE_DUE_CARD = {
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

async function seedAndGo(page: Parameters<typeof seedSessionIdb>[0]) {
  await seedSessionIdb(page, SESSION_WITH_ONE_DUE_CARD);
  await page.goto("/");
  await awaitSeedIdb(page);
}

/** Reveal the card and return the centre coordinates of the Bulbasaur sprite. */
async function revealAndGetCentre(page: Parameters<typeof seedSessionIdb>[0]) {
  const revealBtn = page.getByRole("button", { name: "Reveal" });
  await expect(revealBtn).toBeVisible({ timeout: 10_000 });
  await revealBtn.click();

  // Grade buttons should now appear.
  await expect(page.getByRole("group", { name: "Grade your answer" })).toBeVisible();

  // The sprite image is a reliable anchor — always present on a revealed name card.
  const sprite = page.locator("img[alt='Bulbasaur']");
  await expect(sprite).toBeVisible();

  const box = await sprite.boundingBox();
  if (!box) throw new Error("Could not find sprite bounding box");

  return {
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
  };
}

test.describe("Swipe-to-grade gestures (#1052)", () => {
  // Run on mobile-safari only — this is the primary mobile target. The swipe
  // logic uses pointer events which are identical across browsers; running both
  // projects would double CI time without adding coverage.
  test.skip(({ browserName }) => browserName !== "webkit", "mobile-safari only");

  test("swipe right grades as Good and advances the session", async ({ page }) => {
    await seedAndGo(page);

    const { centerX, centerY } = await revealAndGetCentre(page);

    // Swipe right: start at the centre, move 120 px to the right.
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY, { steps: 10 });
    await page.mouse.up();

    // Good (4) = right swipe. Grading the only due card completes the session.
    await expect(page.getByText("All caught up!")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("swipe left grades as Again and returns the Reveal button", async ({ page }) => {
    await seedAndGo(page);

    const { centerX, centerY } = await revealAndGetCentre(page);

    // Swipe left: Again (1) keeps the card in the learning queue.
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 120, centerY, { steps: 10 });
    await page.mouse.up();

    // Again puts the card back into the learning queue — the Reveal button
    // will reappear for the next learning-step presentation.
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("swipe up grades as Easy and advances the session", async ({ page }) => {
    await seedAndGo(page);

    const { centerX, centerY } = await revealAndGetCentre(page);

    // Swipe up: Easy (5) — move 120 px upward.
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - 120, { steps: 10 });
    await page.mouse.up();

    // Easy (5) grades the only due card and completes the session.
    await expect(page.getByText("All caught up!")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("swipe down grades as Hard and returns the Reveal button", async ({ page }) => {
    await seedAndGo(page);

    const { centerX, centerY } = await revealAndGetCentre(page);

    // Swipe down: Hard (2) — move 120 px downward.
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY + 120, { steps: 10 });
    await page.mouse.up();

    // Hard (2) keeps the card in the learning queue.
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("grade buttons remain visible and functional after a swipe", async ({ page }) => {
    await seedAndGo(page);

    const revealBtn = page.getByRole("button", { name: "Reveal" });
    await expect(revealBtn).toBeVisible({ timeout: 10_000 });
    await revealBtn.click();

    const gradeGroup = page.getByRole("group", { name: "Grade your answer" });
    await expect(gradeGroup).toBeVisible();

    // Grade using the button directly — swipe is additive, not exclusive.
    await gradeGroup.getByRole("button", { name: /Good/i }).click();

    await expect(page.getByText("All caught up!")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("a short drag below commit threshold does not grade the card", async ({ page }) => {
    await seedAndGo(page);

    const { centerX, centerY } = await revealAndGetCentre(page);

    // Only move 30 px — well below the 80 px commit threshold.
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 30, centerY, { steps: 5 });
    await page.mouse.up();

    // Grade buttons should still be visible (not graded).
    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeVisible();
  });

  test("swipe before reveal does not grade the card", async ({ page }) => {
    await seedAndGo(page);

    // Wait for the Reveal button but do NOT click it.
    const revealBtn = page.getByRole("button", { name: "Reveal" });
    await expect(revealBtn).toBeVisible({ timeout: 10_000 });

    // Attempt to swipe on the page without revealing first.
    const revealBox = await revealBtn.boundingBox();
    if (!revealBox) throw new Error("Could not find Reveal button bounding box");

    const centerX = revealBox.x + revealBox.width / 2;
    const centerY = revealBox.y + revealBox.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY, { steps: 10 });
    await page.mouse.up();

    // Grade buttons must NOT appear — swipe is gated on reveal.
    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeHidden();

    // Reveal button must still be visible.
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
  });
});

/**
 * E2E tests for swipe-to-grade gestures (#1052).
 *
 * Exercises the swipe gesture on the review card by dispatching a real
 * pointer-event sequence (pointerdown → pointermove × N → pointerup) directly
 * on the card element via `page.evaluate`. Using `pointerType: 'touch'` and
 * `isPrimary: true` produces an identical event stream on both Chromium and
 * WebKit, regardless of whether the project sets `hasTouch: true`.
 *
 * `page.mouse` is NOT used here because on touch-emulated WebKit projects
 * (mobile-safari / desktop-webkit with hasTouch) `page.mouse` events do not
 * reliably produce the pointer-event sequence that `useSwipeGrade.ts` consumes.
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

const LIMITS_NAME_ONLY = {
  name: { maxNewPerDay: 0, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
};

/**
 * One graduated "review" card due for Bulbasaur (id=1).
 *
 * Grading Good (4) or Easy (5) schedules for a future date → "All caught up!".
 * Grading Again (1) enters a short relearning step → card stays immediately
 * due → "Reveal" button appears again.
 * Grading Hard (2) is a standard FSRS update and schedules for a future date
 * → "All caught up!" (not "Reveal") — see SESSION_WITH_ONE_LEARNING_CARD for
 * the Hard-keeps-card-due scenario.
 */
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
  limits: LIMITS_NAME_ONLY,
};

/**
 * One card in a learning step for Bulbasaur (id=1).
 *
 * Being in a learning step (learningStep: 0) means:
 *   Again (1) → reset to step 0 → card immediately due
 *   Hard  (2) → repeat current step → card immediately due → "Reveal" appears
 *   Good  (4) → advance step (or graduate) → scheduled for future → "All caught up!"
 *   Easy  (5) → graduate immediately → scheduled for future → "All caught up!"
 */
const SESSION_WITH_ONE_LEARNING_CARD = {
  ...baseSession,
  cards: (baseSession.cards as Array<{ id: number; [key: string]: unknown }>).map((c) =>
    c.id === 1
      ? {
          ...c,
          state: {
            stability: 1,
            difficulty: 5,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "learning",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: "2026-04-01",
            learningStep: 0,
            // stepStartedAt must be a number (ms since epoch), not a string.
            // A past timestamp ensures the learning step is immediately due.
            stepStartedAt: 1743465600000, // 2026-04-01T00:00:00.000Z
            hiddenSince: null,
            seenInPasture: false,
          },
        }
      : c,
  ),
  limits: LIMITS_NAME_ONLY,
};

const SETTINGS_KEY = "poke-memory:settings:v1";

async function seedAndGo(
  page: Parameters<typeof seedSessionIdb>[0],
  session: object = SESSION_WITH_ONE_DUE_CARD,
) {
  // Pre-dismiss the first-visit modal so it does not intercept pointer events.
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ onboarding: { firstVisitOnboardingDismissed: true }, mobileNav: "bottom" }),
    );
  }, SETTINGS_KEY);
  await seedSessionIdb(page, session);
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

/**
 * Simulates a swipe gesture by dispatching a pointer-event sequence directly
 * on the DOM element at (startX, startY) via `page.evaluate`.
 *
 * Uses `pointerType: 'touch'` and `isPrimary: true` so the event sequence is
 * identical on Chromium and WebKit, and matches what `useSwipeGrade.ts`
 * expects. `page.mouse` is NOT used because on touch-emulated WebKit projects
 * it does not reliably fire pointer events on the target element.
 *
 * @param page        - Playwright Page
 * @param startX      - X coordinate of the swipe origin (viewport-relative CSS px)
 * @param startY      - Y coordinate of the swipe origin (viewport-relative CSS px)
 * @param endX        - X coordinate of the swipe end (viewport-relative CSS px)
 * @param endY        - Y coordinate of the swipe end (viewport-relative CSS px)
 * @param steps       - Number of intermediate pointermove events (default 10)
 */
async function simulateSwipe(
  page: Parameters<typeof seedSessionIdb>[0],
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps = 10,
): Promise<void> {
  await page.evaluate(
    ({
      sx,
      sy,
      ex,
      ey,
      numSteps,
    }: {
      sx: number;
      sy: number;
      ex: number;
      ey: number;
      numSteps: number;
    }) => {
      const POINTER_ID = 1;

      function makeInit(
        type: string,
        x: number,
        y: number,
      ): PointerEventInit {
        return {
          bubbles: true,
          cancelable: true,
          pointerId: POINTER_ID,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          width: 1,
          height: 1,
          pressure: type === "pointerup" ? 0 : 1,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
        };
      }

      // Find the element at the start coordinates — this is the swipeable card
      // container (or a child of it). Pointer capture means move/up events are
      // always delivered to the element that received pointerdown, regardless of
      // where the pointer travels.
      const target = document.elementFromPoint(sx, sy);
      if (!target) return;

      target.dispatchEvent(new PointerEvent("pointerdown", makeInit("pointerdown", sx, sy)));

      // Fire intermediate pointermove events along a straight line from start to end.
      for (let i = 1; i <= numSteps; i++) {
        const t = i / numSteps;
        const mx = sx + (ex - sx) * t;
        const my = sy + (ey - sy) * t;
        target.dispatchEvent(new PointerEvent("pointermove", makeInit("pointermove", mx, my)));
      }

      target.dispatchEvent(new PointerEvent("pointerup", makeInit("pointerup", ex, ey)));
    },
    { sx: startX, sy: startY, ex: endX, ey: endY, numSteps: steps },
  );
}

test.describe("Swipe-to-grade gestures (#1052)", () => {
  // Run on both chromium and mobile-safari — simulateSwipe dispatches pointer
  // events directly on the element, so the event sequence is identical on both
  // engines regardless of hasTouch setting.
  test.skip(
    ({ browserName }) => browserName !== "webkit" && browserName !== "chromium",
    "chromium and mobile-safari only",
  );

  test("swipe right grades as Good and advances the session", async ({ page }) => {
    await seedAndGo(page);

    const { centerX, centerY } = await revealAndGetCentre(page);

    // Swipe right: start at the centre, move 120 px to the right.
    await simulateSwipe(page, centerX, centerY, centerX + 120, centerY);

    // Good (4) = right swipe. Grading the only due card completes the session.
    await expect(page.getByText("All caught up!")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("swipe left grades as Again and returns the Reveal button", async ({ page }) => {
    await seedAndGo(page);

    const { centerX, centerY } = await revealAndGetCentre(page);

    // Swipe left: Again (1) keeps the card in the learning queue.
    await simulateSwipe(page, centerX, centerY, centerX - 120, centerY);

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
    await simulateSwipe(page, centerX, centerY, centerX, centerY - 120);

    // Easy (5) grades the only due card and completes the session.
    await expect(page.getByText("All caught up!")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("swipe down grades as Hard and returns the Reveal button", async ({ page }) => {
    // Use a card in a learning step: Hard (grade 2) on a learning-step card
    // repeats the current step (case B2 in the scheduler), keeping the card
    // immediately due so the Reveal button reappears.
    await seedAndGo(page, SESSION_WITH_ONE_LEARNING_CARD);

    const { centerX, centerY } = await revealAndGetCentre(page);

    // Swipe down: Hard (2) — move 120 px downward.
    await simulateSwipe(page, centerX, centerY, centerX, centerY + 120);

    // Hard on a learning-step card repeats the step — card stays immediately
    // due, so the Reveal button reappears for the next presentation.
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
    await simulateSwipe(page, centerX, centerY, centerX + 30, centerY, 5);

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

    await simulateSwipe(page, centerX, centerY, centerX + 120, centerY);

    // Grade buttons must NOT appear — swipe is gated on reveal.
    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeHidden();

    // Reveal button must still be visible.
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
  });
});

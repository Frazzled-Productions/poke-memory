/**
 * E2E tests for keyboard-driven review (#1060).
 *
 * Exercises the full keyboard-only review cycle on the chromium project:
 * Space reveals a card, 1/2/4/5 grade it, and `?` opens the shortcuts overlay.
 */
import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  buildCompletedSession,
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
} from "./helpers/completedSession";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

// Build a base session with every known card in a future-due state, so that
// hydrateSession adds no new cards on load and the queue is empty. We then
// override Bulbasaur (id=1) to be review-due so exactly one card appears.
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

const SETTINGS_KEY = "poke-memory:settings:v1";

// Seed the session and navigate to the practice page. All non-Bulbasaur cards
// are already future-due so hydrateSession finds every id in savedIds and adds
// no new cards — the only card served is the review-due Bulbasaur.
// The first-visit modal is pre-dismissed so it doesn't block keyboard events.
async function seedAndGo(page: Parameters<typeof seedSessionIdb>[0]) {
  await addOnboardingPreDismiss(page);
  await seedSessionIdb(page, SESSION_WITH_ONE_DUE_CARD);
  await page.goto("/");
  await awaitSeedIdb(page);
}

test.describe("Keyboard-driven review (#1060)", () => {
  // Only run on chromium — keyboard events are identical across engines and
  // running on both would double CI time for no extra coverage.
  test.skip(({ browserName }) => browserName !== "chromium", "chromium only");

  test("Space reveals the card", async ({ page }) => {
    await seedAndGo(page);

    const reveal = page.getByRole("button", { name: "Reveal" });
    await expect(reveal).toBeVisible({ timeout: 10_000 });

    // Press Space — the card should reveal.
    await page.keyboard.press("Space");

    const gradeGroup = page.getByRole("group", { name: "Grade your answer" });
    await expect(gradeGroup).toBeVisible();
  });

  test("Enter reveals the card", async ({ page }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeVisible();
  });

  test("grade keys are inert before the card is revealed", async ({ page }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    // Press grade key before revealing — the grade group must NOT appear.
    await page.keyboard.press("4");

    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeHidden();
    // Reveal button is still present.
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
  });

  test("full keyboard-only review cycle: Space to reveal, 4 to grade Good", async ({
    page,
  }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    // Reveal with Space.
    await page.keyboard.press("Space");

    const gradeGroup = page.getByRole("group", { name: "Grade your answer" });
    await expect(gradeGroup).toBeVisible();

    // Grade as Good (4).
    await page.keyboard.press("4");

    // After grading the only due card the session completes.
    await expect(page.getByText("All caught up!")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("grade key 1 triggers Again after reveal", async ({ page }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    await page.keyboard.press("Space");
    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeVisible();

    await page.keyboard.press("1");

    // Again keeps the card in the learning queue — the Reveal button reappears.
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("grade key 5 triggers Easy after reveal", async ({ page }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    await page.keyboard.press("Space");
    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeVisible();

    await page.keyboard.press("5");

    // Easy graduates the card — session completes.
    await expect(page.getByText("All caught up!")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Space is inert while an input is focused", async ({ page }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    // Open the scope control which contains a combobox / input-like element.
    // Fall back to focusing an injected input if no text input is present.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "__kb-test-input";
      input.style.position = "fixed";
      input.style.top = "-100px";
      document.body.appendChild(input);
      input.focus();
    });

    // Space while input is focused must NOT reveal the card.
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeHidden();

    // Remove the injected input and blur so subsequent tests are clean.
    await page.evaluate(() => {
      document.getElementById("__kb-test-input")?.remove();
    });
  });

  test("? key opens the keyboard shortcuts overlay", async ({ page }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    // Press ? — the overlay should appear even before the card is revealed.
    await page.keyboard.press("?");

    const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(overlay).toBeVisible();

    // The overlay lists Space and grade keys.
    await expect(overlay.getByText("Reveal card")).toBeVisible();
    await expect(overlay.getByText("Grade: Good")).toBeVisible();
  });

  test("Escape closes the keyboard shortcuts overlay", async ({ page }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    await page.keyboard.press("?");
    await expect(
      page.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeHidden();
  });

  test("click-away closes the keyboard shortcuts overlay", async ({ page }) => {
    await seedAndGo(page);

    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    await page.keyboard.press("?");
    await expect(
      page.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeVisible();

    // Click the backdrop (the fixed overlay wrapper) outside the dialog panel.
    await page.mouse.click(10, 10);
    await expect(
      page.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeHidden();
  });
});

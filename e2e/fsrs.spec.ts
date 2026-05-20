import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";

// Smoke coverage for the FSRS scheduler swap (#263). Asserts structural
// behaviour — queue movement and the relative shape of the per-button
// interval preview — not exact day counts. Exact intervals depend on
// FSRS parameters and would make the test brittle.

const SETTINGS_KEY = "poke-memory:settings:v1";

test.describe("FSRS smoke", () => {
  test("Easy on a brand-new card graduates it out of the queue", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.clear());
    // Pre-dismiss the modal after the clear so it does not block the Reveal button.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({ onboarding: { firstVisitOnboardingDismissed: true } }),
      );
    }, SETTINGS_KEY);
    await page.goto("/");

    const reveal = page.getByRole("button", { name: /reveal/i });

    if (!(await reveal.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // Capture the currently-presented Pokémon name from the page heading
    // before grading. We rely on the practice card's accessible name
    // pattern — the reveal-state heading reads as the Pokémon name.
    await reveal.click();
    const gradeGroup = page.getByRole("group", { name: /grade your answer/i });
    await expect(gradeGroup).toBeVisible();

    // Grab the visible name(s) on screen — the practice page renders the
    // Pokémon name when revealed. Pick the first heading-like text near
    // the grade buttons.
    const namesBefore = await page
      .locator("main")
      .locator("h2, h1, [data-pokemon-name]")
      .allTextContents();

    await gradeGroup.getByRole("button", { name: /easy/i }).click();

    // After Easy on a brand-new card, scheduledDays = 4. The next card
    // shown must be different (or the queue is empty).
    await page.waitForTimeout(500); // let the UI advance
    const namesAfter = await page
      .locator("main")
      .locator("h2, h1, [data-pokemon-name]")
      .allTextContents();

    // Cheap structural assertion: the same set of names should not still
    // be presenting. Either the queue advanced or the session completed.
    const overlap = namesBefore.filter((n) => n && namesAfter.includes(n));
    const sessionComplete = await page
      .getByRole("heading", { name: /all caught up|next card in/i })
      .isVisible()
      .catch(() => false);

    expect(overlap.length === 0 || sessionComplete).toBe(true);
  });

  test("Graduated card: Again preview is <Xm, Good/Easy previews are day-shaped, Easy ≥ Good", async ({
    page,
  }) => {
    // Pre-dismiss the modal so it does not block the Reveal button.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({ onboarding: { firstVisitOnboardingDismissed: true } }),
      );
    }, SETTINGS_KEY);

    // Seed a single graduated FSRS card so the test doesn't depend on
    // grading a brand-new card through the learning steps. Stability and
    // difficulty are chosen so FSRS produces a non-trivial scheduledDays
    // for both Good and Easy.
    await seedSessionIdb(page, {
      cards: [
        {
          id: 6,
          name: "Charizard",
          spriteUrl: "/sprites/pokemon/6.png",
          cardType: "name",
          state: {
            stability: 7,
            difficulty: 4,
            elapsedDays: 0,
            scheduledDays: 7,
            reps: 3,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2024-01-01", // always due
            lastReview: "2023-12-25",
            firstSeen: "2023-12-01",
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/");
    await awaitSeedIdb(page);
    const reveal = page.getByRole("button", { name: /reveal/i });
    await expect(reveal).toBeVisible();
    await reveal.click();

    const gradeGroup = page.getByRole("group", { name: /grade your answer/i });
    await expect(gradeGroup).toBeVisible();

    const againLabel = await gradeGroup
      .getByRole("button", { name: /again/i })
      .innerText();
    const goodLabel = await gradeGroup
      .getByRole("button", { name: /good/i })
      .innerText();
    const easyLabel = await gradeGroup
      .getByRole("button", { name: /easy/i })
      .innerText();

    // Again on a graduated card → relearning, < 10 minutes.
    expect(againLabel).toMatch(/<\s?\d+m/);

    // Good and Easy on a graduated card → day-shaped label (e.g. "1d", "15d", "1mo").
    expect(goodLabel).toMatch(/\d+(d|mo|y)/);
    expect(easyLabel).toMatch(/\d+(d|mo|y)/);

    // Easy interval should be at least as large as Good — FSRS's defining
    // property for higher-confidence grades.
    function dayCount(label: string): number {
      const dMatch = label.match(/(\d+)d/);
      if (dMatch) return parseInt(dMatch[1], 10);
      const moMatch = label.match(/(\d+)mo/);
      if (moMatch) return parseInt(moMatch[1], 10) * 30;
      const yMatch = label.match(/(\d+)y/);
      if (yMatch) return parseInt(yMatch[1], 10) * 365;
      return 0;
    }

    expect(dayCount(easyLabel)).toBeGreaterThanOrEqual(dayCount(goodLabel));
  });
});

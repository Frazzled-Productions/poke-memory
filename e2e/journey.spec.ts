import { test, expect, type Page } from "@playwright/test";
import { isMobileProject } from "./helpers/navHelpers";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { REVERSE_ID_OFFSET, masteredReverseCard } from "./helpers/mastery";

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

test.describe("Journey page - basic load", () => {
  test("loads with the Journey heading", async ({ page }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { level: 1, name: "Journey" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("trainer card is visible after hydration", async ({ page }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("key sections render on a fresh guest session", async ({ page }) => {
    await page.goto("/journey");
    // Wait for the page to hydrate past the loading skeleton.
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });

    for (const heading of [
      "Current streak",
      "Mastery distribution",
      "Introduced",
      "By generation",
    ]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });
});

test.describe("Journey page - structural heading outline", () => {
  test("three super-section h2 headings are present", async ({ page }) => {
    await page.goto("/journey");
    // Wait for hydration past the loading skeleton.
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // Each super-section must emit a level-2 heading.
    await expect(
      page.getByRole("heading", { level: 2, name: "Your progress" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Collection" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Breakdown" }),
    ).toBeVisible();
  });
});

test.describe("Journey page - badge gallery", () => {
  test("badge gallery section is visible", async ({ page }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { level: 3, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("locked badges are hidden by default and revealed via toggle", async ({
    page,
  }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { level: 3, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    // A fresh guest has no earned badges - locked tiles must not be visible yet.
    await expect(
      page.getByLabel(/Boulder Badge \(locked\):/i).first(),
    ).not.toBeVisible();

    const toggle = page.locator('[aria-controls="badge-gallery-locked"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByLabel(/Boulder Badge \(locked\):/i).first(),
    ).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByLabel(/Boulder Badge \(locked\):/i).first(),
    ).not.toBeVisible();
  });

  test("pretendAllMastered shows all badges as earned", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { level: 3, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Boulder Badge, earned")).toBeVisible();
  });
});

test.describe("Journey page - superuser flag", () => {
  test("pretendAllMastered shows a non-zero mastered count in MasteryRings", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    // Wait for hydration.
    await expect(
      page.getByRole("heading", { level: 3, name: "Mastery distribution" }),
    ).toBeVisible({ timeout: 15_000 });
    // Under the flag every species is mastered - the "Mastered" ring label
    // should show a non-zero count. The exact count is the full species count;
    // we just verify the zero-state label is absent.
    await expect(
      page.getByRole("img", { name: /Mastery distribution/ }),
    ).toBeVisible();
  });

  test("gym badges are not hinted before any are earned (fresh guest)", async ({
    page,
  }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // No earned badges on a fresh guest - the badge list on the trainer card
    // must not be visible.
    await expect(
      page.getByRole("list", { name: "Gym badges earned" }),
    ).toHaveCount(0);
    for (const name of ["Cascade Badge", "Boulder Badge", "Eeveelutions", "Legendary Birds"]) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  });
});

test.describe("Journey page - collection timeline scrubber", () => {
  test("timeline section heading is visible", async ({ page }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Collection timeline" }),
    ).toBeVisible();
  });

  test("timeline scrubber is rendered and interactive", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });

    const scrubber = page.getByTestId("timeline-scrubber");
    await expect(scrubber).toBeVisible();
    await expect(scrubber).toHaveAttribute("type", "range");
    // Default position is the centre (value 200 of 0–400).
    await expect(scrubber).toHaveValue("200");
  });

  test("dragging the scrubber toward the past updates the direction label", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });

    const scrubber = page.getByTestId("timeline-scrubber");
    await expect(scrubber).toBeVisible();

    // Move the slider to the far left (value 0 = full past).
    await scrubber.fill("0");
    // The direction pill is uniquely identified by data-testid.
    const pill = page.getByTestId("timeline-direction-pill");
    await expect(pill).toHaveText("Past");
  });

  test("dragging the scrubber toward the future updates the direction label", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });

    const scrubber = page.getByTestId("timeline-scrubber");
    await expect(scrubber).toBeVisible();

    // Move the slider to the far right (value 400 = full future).
    await scrubber.fill("400");
    const pill = page.getByTestId("timeline-direction-pill");
    await expect(pill).toHaveText("Future");
  });
});

test.describe("Journey page - evolution wall", () => {
  test("evolution wall section heading is visible", async ({ page }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Evolution wall" }),
    ).toBeVisible();
  });

  test("evolution wall shows families completed headline metric (always visible)", async ({
    page,
  }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // The summary line is visible even when the wall is collapsed.
    await expect(
      page.getByText(/Families completed:/i),
    ).toBeVisible();
  });

  test("wall is collapsed by default and expands via the toggle button", async ({
    page,
  }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // Locate the toggle by its stable aria-expanded attribute so the locator
    // remains valid after the button text flips from "Expand" to "Collapse".
    const toggle = page.locator('button[aria-expanded]').filter({ hasText: /Expand|Collapse/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Filter tabs are not visible while collapsed.
    await expect(page.getByRole("tab", { name: "All" })).not.toBeVisible();
    // Expand the wall.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Filter tabs are now visible.
    await expect(page.getByRole("tab", { name: "All" })).toBeVisible();
  });

  test("filter tabs are visible and interactive after expanding", async ({ page }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // Expand the wall first - locate by aria-expanded so the selector is stable
    // regardless of whether the button currently reads "Expand" or "Collapse".
    await page.locator('button[aria-expanded]').filter({ hasText: /Expand|Collapse/i }).click();
    // All three filter tabs present.
    await expect(page.getByRole("tab", { name: "All" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "In progress" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Completed" })).toBeVisible();
    // Active tab is "All" by default.
    await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("pretendAllMastered marks all families as completed", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // The summary line is visible without expanding.
    const headline = page.getByText(/Families completed:/i);
    await expect(headline).toBeVisible();
    // Expand the wall to access the filter tabs and gallery - stable selector.
    await page.locator('button[aria-expanded]').filter({ hasText: /Expand|Collapse/i }).click();
    // Switch to "Completed" filter - gallery should be non-empty.
    await page.getByRole("tab", { name: "Completed" }).click();
    await expect(
      page.getByRole("list", { name: "Evolution families" }),
    ).toBeVisible();
  });

  test("in-progress filter shows empty state message for fresh guest", async ({
    page,
  }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // Expand the wall first - stable selector.
    await page.locator('button[aria-expanded]').filter({ hasText: /Expand|Collapse/i }).click();
    // Switch to "In progress" - fresh guest has no mastered edges.
    await page.getByRole("tab", { name: "In progress" }).click();
    await expect(
      page.getByText(/No families in progress yet/i),
    ).toBeVisible();
  });
});

test.describe("Journey page - milestone share card", () => {
  test("banner is absent on a fresh guest session (no mastered Pokémon)", async ({
    page,
  }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // No mastered Pokémon on a fresh guest - banner must not be present.
    await expect(
      page.getByTestId("milestone-share-banner"),
    ).toHaveCount(0);
  });

  test("banner is absent when pretendAllMastered superuser flag is on", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    // Superuser guard must suppress the banner even though mastery is faked.
    await expect(
      page.getByTestId("milestone-share-banner"),
    ).toHaveCount(0);
  });

  test("banner appears when mastery crosses a count threshold", async ({
    page,
  }) => {
    // Seed 10 mastered species (name + reverse cards each) into localStorage
    // before the page loads. Since #1234, a species is mastered only when BOTH
    // the name card AND the paired reverse card pass the FSRS mastery gate
    // (reps >= 3 AND scheduledDays >= 21). The REVERSE_ID_OFFSET constant keeps
    // reverse-card IDs disjoint from name-card IDs.
    // The storage key must match STORAGE_KEY in lib/review/persistence.ts.
    await page.addInitScript((reverseOffset) => {
      // Mastery requires reps >= 3 AND scheduledDays >= 21.
      const masteredState = {
        stability: 30,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 21,
        reps: 3,
        lapses: 0,
        fsrsState: "review",
        dueDate: "2099-01-01",
        lastReview: "2025-01-01",
        firstSeen: "2024-12-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      };
      const cards = [
        // Name cards for species 1-10.
        ...Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          speciesId: i + 1,
          cardType: "name",
          subjectKey: String(i + 1),
          name: `Pokemon ${i + 1}`,
          spriteUrl: `/sprites/pokemon/${i + 1}.png`,
          types: ["normal"],
          state: masteredState,
        })),
        // Paired reverse cards for species 1-10. Both legs must be mastered.
        ...Array.from({ length: 10 }, (_, i) => ({
          id: reverseOffset + (i + 1),
          cardType: "reverse",
          pokemonId: i + 1,
          speciesId: i + 1,
          name: `Pokemon ${i + 1}`,
          spriteUrl: `/sprites/pokemon/${i + 1}.png`,
          state: masteredState,
        })),
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
    }, REVERSE_ID_OFFSET);
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId("milestone-share-banner"),
    ).toBeVisible();
  });
});

test.describe("Journey page - next badge proximity hint", () => {
  test("hint is present on a fresh guest session and targets the nearest badge", async ({
    page,
  }) => {
    // On a fresh session there are zero mastered Pokémon. Every badge is
    // unearned; findNextBadge picks the one with the fewest required species.
    // All gym badges need 2 species; Boulder Badge is first in catalog order
    // so it wins the tie and appears as the hint target.
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { level: 3, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    const hint = page.getByTestId("next-badge-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("Next badge:");
    await expect(hint).toContainText("Boulder Badge");
    await expect(hint).toContainText("2 more Pokémon to master");
  });

  test("hint renders and shows the nearest badge when some Pokémon are mastered", async ({
    page,
  }) => {
    // Seed one mastered species (74 = Geodude) - both name AND reverse cards.
    // Boulder Badge requires species 74 and 95 - so 1 remaining after Geodude
    // is mastered, which is the smallest gap across all badges and therefore
    // Boulder Badge becomes the hint target.
    // Since #1234, mastery requires both the name card and the paired reverse
    // card to pass the FSRS gate; seeding only the name card leaves the species
    // unmastered and the hint count stays at 2.
    await page.addInitScript((reverseOffset) => {
      const masteredState = {
        stability: 30,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 21,
        reps: 3,
        lapses: 0,
        fsrsState: "review",
        dueDate: "2099-01-01",
        lastReview: "2025-01-01",
        firstSeen: "2024-12-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      };
      const cards = [
        {
          id: 74,
          speciesId: 74,
          cardType: "name",
          subjectKey: "74",
          name: "Geodude",
          spriteUrl: "/sprites/pokemon/74.png",
          types: ["rock", "ground"],
          state: masteredState,
        },
        {
          id: reverseOffset + 74,
          cardType: "reverse",
          pokemonId: 74,
          speciesId: 74,
          name: "Geodude",
          spriteUrl: "/sprites/pokemon/74.png",
          state: masteredState,
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
    }, REVERSE_ID_OFFSET);
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { level: 3, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    const hint = page.getByTestId("next-badge-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("Next badge:");
    await expect(hint).toContainText("Boulder Badge");
    await expect(hint).toContainText("1 more Pokémon to master");
  });

  test("hint is absent when pretendAllMastered is on", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { level: 3, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("next-badge-hint")).toHaveCount(0);
  });
});

test.describe("Journey page - close to mastery section", () => {
  test("section heading is visible after hydration on a fresh guest session", async ({
    page,
  }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Close to mastery" }),
    ).toBeVisible();
  });

  test("shows empty state copy when no species qualify", async ({ page }) => {
    // A fresh guest session has no mastered cards, so no species qualify.
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { name: "Close to mastery" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/No gap to close right now/i),
    ).toBeVisible();
  });

  test("shows qualifying species when name card is mastered but reverse card is not", async ({
    page,
  }) => {
    // Seed species 1 (Bulbasaur): name card mastered, no reverse card.
    await page.addInitScript(() => {
      const masteredState = {
        stability: 30,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 28,
        reps: 4,
        lapses: 0,
        fsrsState: "review",
        dueDate: "2099-01-01",
        lastReview: "2025-01-01",
        firstSeen: "2024-12-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      };
      const cards = [
        {
          id: 1,
          speciesId: 1,
          cardType: "name",
          subjectKey: "1",
          name: "Bulbasaur",
          displayName: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          types: ["grass", "poison"],
          state: masteredState,
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

    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { name: "Close to mastery" }),
    ).toBeVisible({ timeout: 15_000 });

    // The list must be visible and contain the qualifying species.
    const list = page.getByRole("list", { name: "Species close to mastery" });
    await expect(list).toBeVisible();
    // Bulbasaur should appear in the list.
    await expect(list.getByText("Bulbasaur")).toBeVisible();
  });

  test("section is empty when pretendAllMastered superuser flag is on", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/journey");
    await expect(
      page.getByRole("heading", { name: "Close to mastery" }),
    ).toBeVisible({ timeout: 15_000 });
    // With forceAllMastered on the list is always empty.
    await expect(
      page.getByText(/No gap to close right now/i),
    ).toBeVisible();
  });
});

test.describe("Journey page - navigation", () => {
  test("Journey link in the desktop nav navigates to /journey", async ({
    page,
  }, testInfo) => {
    test.skip(
      isMobileProject(testInfo),
      "desktop nav only - mobile uses bottom tab bar",
    );
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.getByRole("link", { name: "Journey" }).click();
    await expect(page).toHaveURL("/journey");
    await expect(
      page.getByRole("heading", { level: 1, name: "Journey" }),
    ).toBeVisible();
  });

  test("Journey tab in the mobile bottom bar navigates to /journey", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isMobileProject(testInfo),
      "mobile bottom tab bar only",
    );
    await page.goto("/");
    const tabBar = page.getByRole("navigation", { name: "Mobile tab navigation" });
    await tabBar.getByRole("link", { name: "Journey" }).click();
    await expect(page).toHaveURL("/journey");
    await expect(
      page.getByRole("heading", { level: 1, name: "Journey" }),
    ).toBeVisible();
  });
});

test.describe("Journey page - mastery explainer hint (#1441)", () => {
  test("explainer hint renders on the Journey page for a fresh guest session", async ({
    page,
  }) => {
    await page.goto("/journey");
    // Wait for hydration past the loading skeleton.
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });

    // The hint has role="note" with an aria-label matching the title.
    // We verify by the visible text of the title paragraph.
    await expect(
      page.getByText("What the rings mean"),
    ).toBeVisible();
  });

  test("explainer hint shows Locked body copy", async ({ page }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText(/Locked:.*you haven't seen this Pokémon/i),
    ).toBeVisible();
  });

  test("explainer hint is dismissible", async ({ page }) => {
    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });

    // Hint is initially visible.
    await expect(page.getByText("What the rings mean")).toBeVisible();

    // Dismiss via the close button.
    const dismissBtn = page.getByRole("button", { name: "Dismiss hint" }).first();
    await dismissBtn.click();

    // Hint disappears after dismissal.
    await expect(page.getByText("What the rings mean")).not.toBeVisible();
  });

  test("explainer hint does not show when flag is pre-dismissed", async ({ page }) => {
    // Pre-dismiss the flag before page load, simulating a user who already saw and dismissed it.
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
        const existingOnboarding =
          typeof existing.onboarding === "object" && existing.onboarding !== null
            ? (existing.onboarding as Record<string, unknown>)
            : {};
        existing.onboarding = {
          ...existingOnboarding,
          journeyMasteryExplainerDismissed: true,
        };
        localStorage.setItem(KEY, JSON.stringify(existing));
      } catch { /* ignore */ }
    });

    await page.goto("/journey");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible({ timeout: 15_000 });

    // Hint must be absent.
    await expect(page.getByText("What the rings mean")).not.toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A minimal mastered name-card in the current FSRS session shape.
 *
 * Mastery predicate: reps >= 3 AND scheduledDays >= 21 (AGENTS.md / derive.ts).
 * `seenInPasture` defaults to false (new arrival).
 */
function masteredCard(
  id: number,
  name: string,
  habitat: string,
  seenInPasture = false,
) {
  return {
    id,
    cardType: "name",
    name,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    habitat,
    state: {
      stability: 30,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 28,
      reps: 4,
      lapses: 0,
      fsrsState: "review",
      dueDate: "2026-06-10",
      lastReview: "2026-05-13",
      firstSeen: "2026-03-01",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture,
    },
  };
}

/**
 * Seeds localStorage with the given cards and default per-type limits before
 * the page loads. Call inside `page.addInitScript`.
 */
function buildSession(cards: ReturnType<typeof masteredCard>[]) {
  return {
    cards,
    limits: {
      name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Pasture nav guard", () => {
  test("Pasture link is absent when no mastered cards", async ({ page }) => {
    // Fresh session — no cards at all.
    await page.addInitScript(() => {
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify({ cards: [], limits: { name: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 }, reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 } } }),
      );
    });

    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Pasture" })).not.toBeVisible();
  });

  test("Pasture link appears when at least one card is mastered", async ({
    page,
  }) => {
    // Caterpie is in the Forest habitat. reps=4, scheduledDays=28 → mastered.
    await page.addInitScript((session) => {
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify(session),
      );
    }, buildSession([masteredCard(10, "Caterpie", "forest")]));

    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const pastureLink = nav.getByRole("link", { name: "Pasture" });
    await expect(pastureLink).toBeVisible();

    await pastureLink.click();
    await expect(page).toHaveURL("/pasture");
  });
});

test.describe("Pasture page — with mastered cards", () => {
  test.beforeEach(async ({ page }) => {
    // Seed two mastered cards from different habitats so at least two zones render.
    // Caterpie: forest → "Forest" zone
    // Tentacool: sea   → "Open Sea" zone
    await page.addInitScript((session) => {
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify(session),
      );
    }, buildSession([
      masteredCard(10, "Caterpie", "forest"),
      masteredCard(72, "Tentacool", "sea"),
    ]));
  });

  test("renders page heading, habitat zone labels, and sprites", async ({
    page,
  }) => {
    await page.goto("/pasture");

    // Page heading
    await expect(
      page.getByRole("heading", { level: 1, name: /Pasture/ }),
    ).toBeVisible();

    // At least the two habitat zones we seeded
    await expect(page.getByRole("region", { name: "Forest zone" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Open Sea zone" })).toBeVisible();

    // At least one sprite <img> is present in the DOM
    const sprites = page.locator("img[alt]");
    await expect(sprites.first()).toBeVisible();
  });

  test("sprite buttons are accessible by Pokémon name", async ({ page }) => {
    await page.goto("/pasture");

    // PasturePokemon renders a <button aria-label="{name} (new arrival)"> when
    // seenInPasture is false (the default in our seeded data).
    await expect(
      page.getByRole("button", { name: /Caterpie/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Tentacool/ }),
    ).toBeVisible();
  });
});

test.describe("Pasture page — sparkle clears on tap", () => {
  test("tapping a new-arrival sprite clears its sparkle and persists across reload", async ({
    page,
  }) => {
    // Seed exactly one mastered card with seenInPasture = false (new arrival).
    await page.addInitScript((session) => {
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify(session),
      );
    }, buildSession([masteredCard(10, "Caterpie", "forest", false)]));

    await page.goto("/pasture");

    // The sprite button for a new arrival has "(new arrival)" in its aria-label.
    const spriteBtn = page.getByRole("button", { name: "Caterpie (new arrival)" });
    await expect(spriteBtn).toBeVisible();

    // Tap the sprite. This calls onMarkSeen → markSeenInPasture → saveSession,
    // so the updated flag persists in localStorage.
    await spriteBtn.click();

    // After the click the aria-label should drop the "(new arrival)" suffix.
    await expect(
      page.getByRole("button", { name: "Caterpie" }),
    ).toBeVisible();
    // The "(new arrival)" variant must be gone.
    await expect(
      page.getByRole("button", { name: "Caterpie (new arrival)" }),
    ).not.toBeVisible();

    // Reload to confirm the flag was persisted in localStorage.
    await page.reload();

    await expect(
      page.getByRole("button", { name: "Caterpie" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Caterpie (new arrival)" }),
    ).not.toBeVisible();
  });
});

test.describe("Pasture page — idle behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((session) => {
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify(session),
      );
    }, buildSession([
      masteredCard(10, "Caterpie", "forest"),
      masteredCard(72, "Tentacool", "sea"),
    ]));
  });

  test("zone container renders with expected class", async ({ page }) => {
    await page.goto("/pasture");

    // The zone container gets the .zoneContainer CSS module class (mangled in
    // production, but we can locate it via the aria region).
    const region = page.getByRole("region", { name: "Forest zone" });
    await expect(region).toBeVisible();
    // The div inside the section is the zone container — verify it exists.
    const zoneContainer = region.locator("div").first();
    await expect(zoneContainer).toBeVisible();
  });

  test("sprites have data-sprite-id attribute", async ({ page }) => {
    await page.goto("/pasture");

    // useIdleBehaviour queries [data-sprite-id] elements — verify they exist.
    const spriteWrappers = page.locator("[data-sprite-id]");
    await expect(spriteWrappers.first()).toBeVisible();
    // Both seeded sprites should be present.
    await expect(spriteWrappers).toHaveCount(2);
  });

  test("sprites are visible with prefers-reduced-motion: reduce", async ({
    browser,
  }) => {
    // Create a context with reducedMotion forced so the OS setting is on.
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();

    await page.addInitScript((session) => {
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify(session),
      );
    }, buildSession([masteredCard(10, "Caterpie", "forest")]));

    await page.goto("/pasture");

    // Sprites must still be visible — just static (no motion).
    await expect(
      page.getByRole("button", { name: /Caterpie/ }),
    ).toBeVisible();

    await ctx.close();
  });
});

test.describe("Pasture page — empty state", () => {
  test("visiting /pasture directly with no mastered cards shows friendly empty state", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify({
          cards: [],
          limits: {
            name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
            reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
          },
        }),
      );
    });

    await page.goto("/pasture");

    // Page heading is still rendered
    await expect(
      page.getByRole("heading", { level: 1, name: "Pasture" }),
    ).toBeVisible();

    // Friendly empty-state message (from page.tsx empty branch)
    await expect(
      page.getByText(/master your first Pokémon/i),
    ).toBeVisible();
  });
});

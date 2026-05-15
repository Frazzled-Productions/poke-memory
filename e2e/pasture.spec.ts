import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import { getPrimaryNavContainer } from "./helpers/navHelpers";

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
    await seedSessionIdb(page, { cards: [], limits: { name: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 }, reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 } } });

    await page.goto("/");
    await awaitSeedIdb(page);

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Pasture" })).not.toBeVisible();
  });

  test("Pasture link appears when at least one card is mastered", async ({
    page,
  }, testInfo) => {
    // Caterpie is in the Forest habitat. reps=4, scheduledDays=28 → mastered.
    await seedSessionIdb(page, buildSession([masteredCard(10, "Caterpie", "forest")]));

    await page.goto("/");
    await awaitSeedIdb(page);

    // On mobile the Pasture link is in the bottom tab bar (the new default for
    // fresh users). On desktop it lives in the main navigation header row.
    const nav = getPrimaryNavContainer(page, testInfo);
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
    await seedSessionIdb(page, buildSession([
      masteredCard(10, "Caterpie", "forest"),
      masteredCard(72, "Tentacool", "sea"),
    ]));
  });

  test("renders page heading, habitat zone labels, and sprites", async ({
    page,
  }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

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
    await awaitSeedIdb(page);

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
  test("tapping a new-arrival sprite clears its sparkle and persists to IndexedDB", async ({
    page,
  }) => {
    // Seed exactly one mastered card with seenInPasture = false (new arrival).
    await seedSessionIdb(page, buildSession([masteredCard(10, "Caterpie", "forest", false)]));

    await page.goto("/pasture");
    await awaitSeedIdb(page);

    // The sprite button for a new arrival has "(new arrival)" in its aria-label.
    const spriteBtn = page.getByRole("button", { name: "Caterpie (new arrival)" });
    await expect(spriteBtn).toBeVisible();

    // Tap the sprite. This calls onMarkSeen → markSeenInPasture → saveSession,
    // so the updated flag persists in IndexedDB.
    // `force: true` bypasses Playwright's actionability "stability" check, which
    // can time out when the CSS bob animation continuously moves the img child —
    // the button element itself is stable but Playwright's heuristic sees motion.
    await spriteBtn.click({ force: true });

    // After the click the aria-label should drop the "(new arrival)" suffix.
    // Use exact: true so "Caterpie" does not match "Caterpie (new arrival)".
    await expect(
      page.getByRole("button", { name: "Caterpie", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    // The "(new arrival)" variant must be gone.
    await expect(
      page.getByRole("button", { name: "Caterpie (new arrival)" }),
    ).not.toBeVisible({ timeout: 10_000 });

    // Confirm the flag was persisted to IndexedDB by reading IDB directly.
    // NOTE: We do NOT use page.reload() here because addInitScript re-runs on
    // every navigation (including reloads), which would overwrite IDB with the
    // original seed data (seenInPasture: false), producing a false failure.
    // Reading IDB directly is the correct way to verify persistence in tests
    // that use addInitScript-based seeding.
    const idbValue = await page.evaluate(async (): Promise<string | null> => {
      return new Promise((resolve) => {
        const req = indexedDB.open("poke-memory");
        req.onsuccess = () => {
          const tx = req.result.transaction("kv", "readonly");
          const getReq = tx.objectStore("kv").get("poke-memory:review-session:v1");
          getReq.onsuccess = () =>
            resolve(typeof getReq.result === "string" ? getReq.result : null);
          getReq.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    });

    // The saved session must have seenInPasture: true for Caterpie (id=10).
    expect(idbValue).not.toBeNull();
    const saved = JSON.parse(idbValue!);
    const caterpieCard = saved.cards.find(
      (c: { id: number }) => c.id === 10,
    );
    expect(caterpieCard).toBeDefined();
    expect(caterpieCard.state.seenInPasture).toBe(true);
  });
});

test.describe("Pasture page — idle behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await seedSessionIdb(page, buildSession([
      masteredCard(10, "Caterpie", "forest"),
      masteredCard(72, "Tentacool", "sea"),
    ]));
  });

  test("zone container renders with expected class", async ({ page }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

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
    await awaitSeedIdb(page);

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

    await seedSessionIdb(page, buildSession([masteredCard(10, "Caterpie", "forest")]));

    await page.goto("/pasture");
    await awaitSeedIdb(page);

    // Sprites must still be visible — just static (no motion).
    await expect(
      page.getByRole("button", { name: /Caterpie/ }),
    ).toBeVisible();

    await ctx.close();
  });
});

test.describe("Pasture page — name search", () => {
  test.beforeEach(async ({ page }) => {
    await seedSessionIdb(page, buildSession([
      masteredCard(10, "Caterpie", "forest"),
      masteredCard(72, "Tentacool", "sea"),
    ]));
  });

  test("typing a matching name filters to that Pokémon only", async ({ page }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

    const searchInput = page.getByRole("textbox", { name: "Search Pokémon" });
    await expect(searchInput).toBeVisible();

    await searchInput.fill("Caterpie");

    // Caterpie should remain visible
    await expect(page.getByRole("button", { name: /Caterpie/ })).toBeVisible();
    // Tentacool should not be visible
    await expect(page.getByRole("button", { name: /Tentacool/ })).not.toBeVisible();
  });

  test("clearing the search restores all Pokémon", async ({ page }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

    const searchInput = page.getByRole("textbox", { name: "Search Pokémon" });
    await searchInput.fill("Caterpie");
    await expect(page.getByRole("button", { name: /Tentacool/ })).not.toBeVisible();

    await searchInput.clear();
    await expect(page.getByRole("button", { name: /Caterpie/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Tentacool/ })).toBeVisible();
  });

  test("a query with no matches shows a no-results message", async ({ page }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

    const searchInput = page.getByRole("textbox", { name: "Search Pokémon" });
    await searchInput.fill("zzznomatch");

    await expect(page.getByText(/No Pokémon match/i)).toBeVisible();
  });
});

test.describe("Pasture page — biome landscape view", () => {
  test.beforeEach(async ({ page }) => {
    await seedSessionIdb(page, buildSession([
      masteredCard(10, "Caterpie", "forest"),
      masteredCard(72, "Tentacool", "sea"),
    ]));
  });

  test("Landscape link is present for each rendered biome", async ({ page }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

    // The Forest zone should have a "Landscape" link.
    const forestSection = page.getByRole("region", { name: "Forest zone" });
    await expect(
      forestSection.getByRole("link", { name: /View Forest in landscape/i }),
    ).toBeVisible();

    // The Open Sea zone should also have a "Landscape" link — the aria-label
    // uses "View … in landscape" to avoid the double-word "Open Open Sea".
    const seaSection = page.getByRole("region", { name: "Open Sea zone" });
    await expect(
      seaSection.getByRole("link", { name: /View Open Sea in landscape/i }),
    ).toBeVisible();
  });

  test("tapping the Landscape link opens /pasture/[biome] and shows the zone heading", async ({
    page,
  }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

    // Click the landscape link for the Forest biome.
    const forestSection = page.getByRole("region", { name: "Forest zone" });
    await forestSection
      .getByRole("link", { name: /View Forest in landscape/i })
      .click();

    await expect(page).toHaveURL("/pasture/forest");

    // The landscape page shows the biome label in the heading.
    await expect(page.getByRole("heading", { level: 1, name: /Forest/ })).toBeVisible();
  });

  test("biome landscape page shows the Pokémon sprite for that biome", async ({
    page,
  }) => {
    await page.goto("/pasture/forest");
    await awaitSeedIdb(page);

    // Caterpie is in the forest habitat — its sprite button should be visible.
    await expect(page.getByRole("button", { name: /Caterpie/ })).toBeVisible();
  });

  test("back button on landscape page returns to /pasture", async ({ page }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);
    const forestSection = page.getByRole("region", { name: "Forest zone" });
    await forestSection
      .getByRole("link", { name: /View Forest in landscape/i })
      .click();
    await expect(page).toHaveURL("/pasture/forest");

    // The "Pasture" back link should be visible and navigable.
    await page.getByRole("button", { name: "Back to Pasture" }).click();
    await expect(page).toHaveURL("/pasture");
  });

  test("unknown biome slug shows the not-found page", async ({ page }) => {
    // With cacheComponents: true the /pasture/[biome] route is a Partial
    // Prerender (PPR) — the static shell is streamed with HTTP 200 before the
    // dynamic segment runs notFound(). The HTTP status will therefore always be
    // 200, so we assert on the rendered UI instead of the status code.
    await page.goto("/pasture/not-a-real-biome");
    await awaitSeedIdb(page);

    // Next.js's default not-found page renders an <h1>404</h1> and an
    // <h2>This page could not be found.</h2>. Assert on both to confirm the
    // not-found UI is actually rendered in the browser.
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "This page could not be found." }),
    ).toBeVisible();
  });
});

test.describe("Pasture — biome landscape view with pretendAllMastered", () => {
  /**
   * Seeds localStorage so SuperuserContext boots with the pretendAllMastered
   * flag active. Mirrors the approach used in e2e/superuser.spec.ts.
   */
  async function seedSuperuserAllMastered(
    page: import("@playwright/test").Page,
  ): Promise<void> {
    await page.addInitScript(() => {
      window.localStorage.setItem("poke-memory:superuser", "true");
      window.localStorage.setItem(
        "poke-memory:superuser:flags:v1",
        JSON.stringify({ pretendAllMastered: true }),
      );
    });
  }

  test("landscape biome view renders synthesised collection under pretendAllMastered", async ({
    page,
  }) => {
    await seedSuperuserAllMastered(page);

    // Navigate directly to a known biome — the synthesised collection includes
    // every species, so the forest biome should be populated.
    await page.goto("/pasture/forest");

    // The page heading should show the biome label.
    await expect(
      page.getByRole("heading", { level: 1, name: /Forest/i }),
    ).toBeVisible({ timeout: 10_000 });

    // At least one Pokémon sprite should be present (Caterpie is a forest
    // habitat species that appears in the synthesised collection).
    await expect(
      page.getByRole("button", { name: /Caterpie/i }),
    ).toBeVisible({ timeout: 10_000 });

    // The "no mastered Pokémon" empty-state message must NOT appear.
    await expect(
      page.getByText(/No mastered Pokémon in this biome yet/i),
    ).toHaveCount(0);
  });
});

test.describe("Pasture page — biome stats (#623)", () => {
  test.beforeEach(async ({ page }) => {
    // Two forest cards so the stats strip appears for the Forest zone.
    await seedSessionIdb(page, buildSession([
      masteredCard(10, "Caterpie", "forest"),
      masteredCard(11, "Metapod", "forest"),
    ]));
  });

  test("compact stats strip is visible inside each biome zone on the main Pasture page", async ({
    page,
  }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

    const forestZone = page.getByRole("region", { name: "Forest zone" });
    await expect(forestZone).toBeVisible();

    // The stats strip contains a percentage sign — confirm it is rendered.
    await expect(forestZone.getByText(/%/)).toBeVisible();
  });

  test("stats strip shows a count and captured percentage on the main Pasture page", async ({
    page,
  }) => {
    await page.goto("/pasture");
    await awaitSeedIdb(page);

    const forestZone = page.getByRole("region", { name: "Forest zone" });
    // 2 mastered out of 71 total forest species → "2" and "2%" (rounded).
    // We just check for a slash-separated count like "2/71".
    await expect(forestZone.getByText(/\d+\/\d+/)).toBeVisible();
  });

  test("per-biome detail page shows a richer stats panel with captured percentage", async ({
    page,
  }) => {
    await page.goto("/pasture/forest");
    await awaitSeedIdb(page);

    // The detail page renders "X% captured" in a <dd> inside the stats <dl>.
    // Scope to the <dl aria-label="Biome statistics"> and target the <dd>
    // whose text matches the numeric-percent shape to avoid the sr-only <dt>
    // "Captured" that also contains "captured".
    const statsPanel = page.locator('[aria-label="Biome statistics"]');
    await expect(statsPanel.locator("dd").filter({ hasText: /\d+% captured/ })).toBeVisible();
  });

  test("per-biome detail page stats panel shows species count", async ({
    page,
  }) => {
    await page.goto("/pasture/forest");
    await awaitSeedIdb(page);

    // "X / Y species" is rendered in a <dd> inside the stats <dl>.
    // Scope to the <dl aria-label="Biome statistics"> and target the <dd>
    // to avoid matching the sr-only <dt> "Species mastered".
    const statsPanel = page.locator('[aria-label="Biome statistics"]');
    await expect(statsPanel.locator("dd").filter({ hasText: /\d+ \/ \d+ species/ })).toBeVisible();
  });
});

test.describe("Pasture page — empty state", () => {
  test("visiting /pasture directly with no mastered cards shows friendly empty state", async ({
    page,
  }) => {
    await seedSessionIdb(page, {
      cards: [],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });

    await page.goto("/pasture");
    await awaitSeedIdb(page);

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

test.describe("Pasture page — reacts to clearLocalProgress storage event", () => {
  test("clearing IDB and dispatching the synthetic storage event re-renders the empty state", async ({
    page,
  }) => {
    // Start with one mastered card so the page renders a populated state.
    await seedSessionIdb(page, buildSession([masteredCard(10, "Caterpie", "forest")]));

    await page.goto("/pasture");
    await awaitSeedIdb(page);

    await expect(
      page.getByRole("button", { name: /Caterpie/ }),
    ).toBeVisible();

    // Simulate clearLocalProgress: wipe the IDB session record, then dispatch
    // the synthetic StorageEvent the helper fires for same-tab subscribers.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open("poke-memory");
        req.onsuccess = () => {
          const tx = req.result.transaction("kv", "readwrite");
          tx.objectStore("kv").delete("poke-memory:review-session:v1");
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      });
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "poke-memory:review-session:v1",
        }),
      );
    });

    // Without storageVersion in the load useEffect deps, this assertion would
    // fail — the page would still show Caterpie until a manual reload.
    await expect(
      page.getByText(/master your first Pokémon/i),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: /Caterpie/ }),
    ).not.toBeVisible();
  });
});

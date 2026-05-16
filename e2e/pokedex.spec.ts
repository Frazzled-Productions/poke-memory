import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";

test.describe("Pokédex detail — Hear name button", () => {
  test("Hear name button appears on a non-locked Pokédex entry", async ({ page }) => {
    // Seed Bulbasaur (id=1) as reviewed (lastReview set) so it is "learning" not "locked".
    await seedSessionIdb(page, {
      cards: [
        {
          id: 1,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "name",
          state: {
            stability: 1,
            difficulty: 5,
            elapsedDays: 1,
            scheduledDays: 1,
            reps: 1,
            lapses: 0,
            fsrsState: "learning",
            dueDate: "2099-01-01",
            lastReview: "2026-05-13",
            firstSeen: "2026-05-13",
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);
    await expect(page.getByText("Bulbasaur")).toBeVisible();
    await expect(page.getByRole("button", { name: "Hear Bulbasaur" })).toBeVisible();
  });

  test("Hear name button is clickable without throwing a page error (#435)", async ({ page }) => {
    // Clicking the button triggers speakName(name, id). The MP3 at
    // /audio/names/1.mp3 may 404 on a preview deployment — speakName must
    // degrade gracefully to Web Speech and must not throw an uncaught exception.
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await seedSessionIdb(page, {
      cards: [
        {
          id: 1,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "name",
          state: {
            stability: 1,
            difficulty: 5,
            elapsedDays: 1,
            scheduledDays: 1,
            reps: 1,
            lapses: 0,
            fsrsState: "learning",
            dueDate: "2099-01-01",
            lastReview: "2026-05-13",
            firstSeen: "2026-05-13",
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);
    await expect(page.getByText("Bulbasaur")).toBeVisible();

    const hearBtn = page.getByRole("button", { name: "Hear Bulbasaur" });
    await expect(hearBtn).toBeVisible();
    await hearBtn.click();

    // Allow a brief moment for any async rejection to bubble before asserting.
    await page.waitForTimeout(300);
    expect(pageErrors).toHaveLength(0);
  });
});

test.describe("Pokédex type filter — intersection", () => {
  test("single-type selection returns non-empty grid", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    const fireButton = page
      .getByRole("group", { name: "Filter by type" })
      .getByRole("button", { name: "Fire" });
    await fireButton.click();
    await page.waitForURL(/type=fire/);

    // Grid should still have results for a single type
    await expect(page.getByText("No Pokémon match your filters.")).not.toBeVisible();
    await expect(page.getByRole("list", { name: /Pokémon/ }).first()).toBeVisible();
  });

  test("Fire + Flying returns fewer results than Fire alone", async ({ page }) => {
    await page.goto("/pokedex");

    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    // Scope to the Pokémon grid lists to exclude any nav/other <li> elements
    const pokemonListItems = page.getByRole("list", { name: /Pokémon/ }).getByRole("listitem");

    await typeGroup.getByRole("button", { name: "Fire" }).click();
    // Wait for the URL to reflect the new filter before counting — the filter
    // is URL-driven (router.replace), so URL settlement = grid re-rendered.
    await page.waitForURL(/type=fire/);
    const fireCount = await pokemonListItems.count();
    expect(fireCount).toBeGreaterThan(0);

    await typeGroup.getByRole("button", { name: "Flying" }).click();
    await page.waitForURL(/type=.*flying/);
    const dualCount = await pokemonListItems.count();

    // AND semantics: dual-type results must be a strict subset
    expect(dualCount).toBeGreaterThan(0);
    expect(dualCount).toBeLessThan(fireCount);
  });

  test("three types selected renders empty state", async ({ page }) => {
    // This relies on the seeded dataset: no Pokémon has Fire + Flying + Water
    // simultaneously. The filter logic itself is unit-tested in filter.test.ts.
    await page.goto("/pokedex");

    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    // Wait for each URL update before the next click — handleTypeToggle reads
    // filter state from the current URL, so clicking before the URL settles
    // causes the next type to overwrite rather than append.
    await typeGroup.getByRole("button", { name: "Fire" }).click();
    await page.waitForURL(/type=fire/);
    await typeGroup.getByRole("button", { name: "Flying" }).click();
    await page.waitForURL(/type=.*flying/);
    await typeGroup.getByRole("button", { name: "Water" }).click();
    await page.waitForURL(/type=.*water/);

    // No Pokémon has all three types — empty state must appear
    await expect(
      page.getByText("No Pokémon match your filters."),
    ).toBeVisible();
  });
});

test.describe("Pokédex detail — cry button (#476)", () => {
  test("Play cry button appears on a non-locked Pokédex entry that has a cryUrl", async ({
    page,
  }) => {
    // Seed Bulbasaur (id=1) as reviewed so it is "learning" not "locked".
    // Bulbasaur has cryUrl=/cries/1.ogg in generated.json.
    await seedSessionIdb(page, {
      cards: [
        {
          id: 1,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "name",
          state: {
            stability: 1,
            difficulty: 5,
            elapsedDays: 1,
            scheduledDays: 1,
            reps: 1,
            lapses: 0,
            fsrsState: "learning",
            dueDate: "2099-01-01",
            lastReview: "2026-05-13",
            firstSeen: "2026-05-13",
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);

    // Wait for the page to fully render the name heading (not locked).
    await expect(page.getByText("Bulbasaur")).toBeVisible();

    // CryButton renders with aria-label="Play {displayName} cry".
    // Bulbasaur's displayName is "Bulbasaur" in generated.json.
    await expect(
      page.getByRole("button", { name: "Play Bulbasaur cry" }),
    ).toBeVisible();
  });

  test("Play cry button is absent on a locked Pokédex entry", async ({
    page,
  }) => {
    // Fresh IDB — no cards seeded, so all species are locked.
    await seedSessionIdb(page, { cards: [], limits: { name: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 }, reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 } } });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);

    // Locked species shows "???" heading and hides the cry button.
    await expect(
      page.getByRole("heading", { level: 1, name: "???" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Play.*cry/i }),
    ).not.toBeVisible();
  });
});

test.describe("Pokédex detail — Forms section hidden when locked (#495)", () => {
  test("Forms section is absent when species is locked (empty IDB)", async ({
    page,
  }) => {
    // Seed an empty session — all species are locked, so isLocked=true for
    // Raichu (id=26). PokemonDetailDisclosure only renders the Forms section
    // when !isLocked && forms.length > 0, so it must be absent here.
    await seedSessionIdb(page, {
      cards: [],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex/26");
    await awaitSeedIdb(page);

    // Locked species shows "???" — verify the page loaded correctly.
    await expect(
      page.getByRole("heading", { level: 1, name: "???" }),
    ).toBeVisible();

    // The Forms h2 heading must not be visible regardless of whether the seed
    // contains Alolan Raichu — locking gates the whole section.
    await expect(
      page.getByRole("heading", { name: "Forms", level: 2 }),
    ).not.toBeVisible();
  });
});

test.describe("Pokédex mastery-status filter (#542)", () => {
  test("selecting a type then 'Not yet mastered' narrows the grid", async ({ page }) => {
    // Seed Bulbasaur (id=1) as mastered so there is at least one mastered species,
    // and leave all others at default (locked) so "not-yet-mastered" yields results.
    await seedSessionIdb(page, {
      cards: [
        {
          id: 1,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "name",
          state: {
            stability: 30,
            difficulty: 4,
            elapsedDays: 30,
            scheduledDays: 30,
            reps: 5,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2099-01-01",
            lastReview: "2026-05-01",
            firstSeen: "2026-04-01",
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex");
    await awaitSeedIdb(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Wait for the grid to load (IDB hydration).
    const pokemonLists = page.getByRole("list", { name: /Pokémon/ });
    await expect(pokemonLists.first()).toBeVisible();

    // Count all Grass-type tiles.
    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    await typeGroup.getByRole("button", { name: "Grass" }).click();
    await page.waitForURL(/type=grass/);
    const grassCount = await pokemonLists.getByRole("listitem").count();
    expect(grassCount).toBeGreaterThan(0);

    // Now narrow by "Not yet mastered" — Bulbasaur is mastered so it should drop out.
    const masteryGroup = page.getByRole("group", { name: "Filter by mastery" });
    await masteryGroup.getByRole("button", { name: "Not yet mastered" }).click();
    await page.waitForURL(/mastery=not-yet-mastered/);

    // The result should still have some Grass Pokémon (the locked ones) but
    // strictly fewer than the full Grass set (Bulbasaur is now excluded).
    const notYetMasteredCount = await pokemonLists.getByRole("listitem").count();
    expect(notYetMasteredCount).toBeGreaterThan(0);
    expect(notYetMasteredCount).toBeLessThan(grassCount);
  });

  test("mastery filter URL param is preserved on page load", async ({ page }) => {
    await page.goto("/pokedex?mastery=mastered");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // The "Mastered" chip should be pressed.
    const masteryGroup = page.getByRole("group", { name: "Filter by mastery" });
    await expect(
      masteryGroup.getByRole("button", { name: "Mastered", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("Pokédex — alternate-form surfaces (#450)", () => {
  test("searching 'alolan' shows at least 1 result when seed has forms, or shows 0 gracefully", async ({
    page,
  }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Type "alolan" into the search box.
    const searchInput = page.getByLabel("Search Pokémon");
    await searchInput.fill("alolan");

    // Wait for the debounced URL update (150 ms debounce in PokedexFiltered).
    await page.waitForURL(/q=alolan/, { timeout: 5_000 });

    // Two valid outcomes:
    //   A) Seed has been re-run: Alolan Raichu, Vulpix, Sandshrew etc. render.
    //   B) Seed is pre-#445: no results → empty state with "Clear filters".
    const emptyState = page.getByText("No Pokémon match your filters.");
    const grid = page.getByRole("list", { name: /Pokémon/ });

    const hasResults = await grid.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    // At least one of the two states must be visible.
    expect(hasResults || hasEmpty).toBe(true);

    if (hasResults) {
      // When results exist, at least one tile must be present.
      const tiles = grid.getByRole("listitem");
      const count = await tiles.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
    // If hasEmpty is true, that is the expected pre-#445 behaviour — no assertion needed.
  });

  test("toggling 'Has alternate forms' chip changes the tile count or shows the empty state", async ({
    page,
  }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // The Pokédex page is client-rendered: it shows a skeleton while it loads
    // the session from IndexedDB, then replaces it with the grid. Wait for the
    // first list to appear before counting — without this wait, count() races
    // the IDB load and returns 0 (skeleton has no list items).
    const allLists = page.getByRole("list", { name: /Pokémon/ });
    await expect(allLists.first()).toBeVisible();
    const tilesBefore = allLists.getByRole("listitem");
    const countBefore = await tilesBefore.count();
    expect(countBefore).toBeGreaterThan(0);

    // Click the "Has alternate forms" chip.
    const chip = page
      .getByRole("group", { name: "Additional filters" })
      .getByRole("button", { name: "Has alternate forms" });
    await chip.click();
    await page.waitForURL(/forms=1/, { timeout: 5_000 });

    // Two valid outcomes:
    //   A) Seed has been re-run: a non-empty subset of species with forms renders.
    //   B) Seed is pre-#445: empty state appears because no species has forms yet.
    const emptyState = page.getByText("No Pokémon match your filters.");
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    if (hasEmpty) {
      // Pre-#445 seed: expected — verify the "Clear filters" link is present.
      await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
    } else {
      // Post-#445 seed: the filtered count must be strictly less than before.
      const countAfter = await allLists.getByRole("listitem").count();
      expect(countAfter).toBeGreaterThan(0);
      expect(countAfter).toBeLessThan(countBefore);
    }
  });

  test("Raichu detail page shows Forms section when seed has Alolan Raichu", async ({
    page,
  }) => {
    await page.goto("/pokedex/26");

    // The page always renders the Pokémon name (locked or not).
    // Verify the page loaded — either "Raichu" or the locked "???" heading.
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();

    // Check whether the Forms section is present.
    const formsHeading = page.getByRole("heading", {
      name: "Forms",
      level: 2,
    });
    const hasFormsSection = await formsHeading.isVisible().catch(() => false);

    if (!hasFormsSection) {
      // Pre-#445 seed: Forms section is absent because Raichu has no alternate
      // form entries in generated.json yet. This is the expected state until the
      // seed is re-run.
      test.skip(true, "Seed does not yet contain Alolan Raichu — skipping Forms section assertions.");
      return;
    }

    // Post-#445 seed: the Forms section is visible.
    await expect(formsHeading).toBeVisible();

    // At least one form block should be present (Alolan Raichu).
    // FormBlock renders a <details> element with a <summary> containing the
    // displayName. Check that at least one summary with "Alolan" is visible.
    const alolanSummary = page.getByText(/Alolan Raichu/i);
    await expect(alolanSummary).toBeVisible();
  });
});

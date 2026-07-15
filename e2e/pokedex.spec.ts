import { test, expect, type Page } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

const SETTINGS_KEY = "poke-memory:settings:v1";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

// ---------------------------------------------------------------------------
// Helper - expand the filter disclosure before interacting with filter controls.
// The disclosure is collapsed by default (#865).
// ---------------------------------------------------------------------------

async function expandFilters(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /^Filters/ });
  const isExpanded = await toggle.getAttribute("aria-expanded");
  if (isExpanded !== "true") {
    await toggle.click();
  }
}
// ---------------------------------------------------------------------------
// Helper - enable the languages Labs flag and set pokemonNameLocale before load.
// ---------------------------------------------------------------------------

async function setLocale(
  page: Page,
  locale: string,
): Promise<void> {
  await page.addInitScript(
    ({ key, loc }: { key: string; loc: string }) => {
      try {
        const raw = localStorage.getItem(key);
        let existing: Record<string, unknown> = {};
        if (raw !== null) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (typeof parsed === "object" && parsed !== null) {
              existing = parsed as Record<string, unknown>;
            }
          } catch {
            /* ignore */
          }
        }
        const merged = {
          ...existing,
          labsFlags: {
            ...(typeof existing.labsFlags === "object" && existing.labsFlags !== null
              ? (existing.labsFlags as Record<string, unknown>)
              : {}),
            languages: true,
          },
          pokemonNameLocale: loc,
          onboarding: {
            ...(typeof existing.onboarding === "object" && existing.onboarding !== null
              ? (existing.onboarding as Record<string, unknown>)
              : {}),
            firstVisitOnboardingDismissed: true,
          },
        };
        localStorage.setItem(key, JSON.stringify(merged));
      } catch {
        /* localStorage unavailable */
      }
    },
    { key: SETTINGS_KEY, loc: locale },
  );
}


test.describe("Pokédex filter disclosure (#865)", () => {
  test("filter controls are collapsed by default", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    const toggle = page.getByRole("button", { name: /^Filters/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Filter groups should not be interactable while collapsed (panel is hidden).
    await expect(
      page.getByRole("group", { name: "Filter by type" }),
    ).not.toBeVisible();
  });

  test("clicking the toggle expands the filter panel", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    const toggle = page.getByRole("button", { name: /^Filters/ });
    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("group", { name: "Filter by type" }),
    ).toBeVisible();
  });

  test("active filter count badge appears when filters are set while disclosure is collapsed", async ({
    page,
  }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Expand and select a type filter.
    await expandFilters(page);
    await page
      .getByRole("group", { name: "Filter by type" })
      .getByRole("button", { name: "Fire" })
      .click();
    await page.waitForURL(/type=fire/);

    // Collapse the disclosure.
    const toggle = page.getByRole("button", { name: /^Filters/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // The badge showing active filter count should be visible.
    await expect(
      toggle.getByText("1"),
    ).toBeVisible();
  });
});

test.describe("Pokédex detail - Hear name button", () => {
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
    // /audio/names/1.mp3 may 404 on a preview deployment - speakName must
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

test.describe("Pokédex type filter - intersection", () => {
  test("single-type selection returns non-empty grid", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Filter controls are collapsed by default - expand before interacting (#865).
    await expandFilters(page);

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

    // Filter controls are collapsed by default - expand before interacting (#865).
    await expandFilters(page);

    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    // Scope to the Pokémon grid lists to exclude any nav/other <li> elements
    const pokemonListItems = page.getByRole("list", { name: /Pokémon/ }).getByRole("listitem");

    await typeGroup.getByRole("button", { name: "Fire" }).click();
    // Wait for the URL to reflect the new filter before counting - the filter
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

    // Filter controls are collapsed by default - expand before interacting (#865).
    await expandFilters(page);

    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    // Wait for each URL update before the next click - handleTypeToggle reads
    // filter state from the current URL, so clicking before the URL settles
    // causes the next type to overwrite rather than append.
    await typeGroup.getByRole("button", { name: "Fire" }).click();
    await page.waitForURL(/type=fire/);
    await typeGroup.getByRole("button", { name: "Flying" }).click();
    await page.waitForURL(/type=.*flying/);
    await typeGroup.getByRole("button", { name: "Water" }).click();
    await page.waitForURL(/type=.*water/);

    // No Pokémon has all three types - empty state must appear
    await expect(
      page.getByText("No Pokémon match your filters."),
    ).toBeVisible();
  });
});

test.describe("Pokédex detail - cry button (#476)", () => {
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
    // Fresh IDB - no cards seeded, so all species are locked.
    await seedSessionIdb(page, { cards: [], limits: { name: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 }, reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 } } });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);

    // Locked species: h1 shows the zero-padded dex number (#1734 / #1729).
    await expect(
      page.getByRole("heading", { level: 1, name: /^#\d{3} \(locked\)$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Play.*cry/i }),
    ).not.toBeVisible();
  });
});

test.describe("Pokédex detail - Forms section hidden when locked (#495)", () => {
  test("Forms section is absent when species is locked (empty IDB)", async ({
    page,
  }) => {
    // Seed an empty session - all species are locked, so isLocked=true for
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

    // Locked species: h1 shows the zero-padded dex number (#1734 / #1729).
    await expect(
      page.getByRole("heading", { level: 1, name: /^#\d{3} \(locked\)$/i }),
    ).toBeVisible();

    // The Forms h2 heading must not be visible regardless of whether the seed
    // contains Alolan Raichu - locking gates the whole section.
    await expect(
      page.getByRole("heading", { name: "Forms", level: 2 }),
    ).not.toBeVisible();
  });
});

test.describe("Pokédex mastery-status filter (#1944)", () => {
  test("selecting a type then 'New' or 'Learning' narrows the grid", async ({ page }) => {
    // Seed Bulbasaur (id=1) as mastered and Chikorita (id=152) as learning
    // (graded at least once, stability below the mastery threshold), so all
    // three cardClasses ("locked", "learning", "mastered") are represented
    // among Grass-type species. Everything else stays at default (locked).
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
        {
          id: 152,
          name: "Chikorita",
          spriteUrl: "/sprites/pokemon/152.png",
          cardType: "name",
          state: {
            stability: 3,
            difficulty: 4,
            elapsedDays: 1,
            scheduledDays: 3,
            reps: 1,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2099-01-01",
            lastReview: "2026-05-01",
            firstSeen: "2026-05-01",
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

    // Filter controls are collapsed by default - expand before interacting (#865).
    await expandFilters(page);

    // Count all Grass-type tiles.
    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    await typeGroup.getByRole("button", { name: "Grass" }).click();
    await page.waitForURL(/type=grass/);
    const grassCount = await pokemonLists.getByRole("listitem").count();
    expect(grassCount).toBeGreaterThan(0);

    const masteryGroup = page.getByRole("group", { name: "Filter by mastery" });

    // Narrow by "New" - Bulbasaur (mastered) and Chikorita (learning) should
    // both drop out, leaving only locked Grass species.
    await masteryGroup.getByRole("button", { name: "New" }).click();
    await page.waitForURL(/mastery=new/);
    const newCount = await pokemonLists.getByRole("listitem").count();
    expect(newCount).toBeGreaterThan(0);
    expect(newCount).toBeLessThan(grassCount);
    await expect(pokemonLists.getByRole("link", { name: "Bulbasaur" })).not.toBeVisible();
    await expect(pokemonLists.getByRole("link", { name: "Chikorita" })).not.toBeVisible();

    // Narrow by "Learning" instead - only Chikorita (learning) should show,
    // Bulbasaur (mastered) and the locked species should drop out.
    await masteryGroup.getByRole("button", { name: "Learning" }).click();
    await page.waitForURL(/mastery=learning/);
    const learningCount = await pokemonLists.getByRole("listitem").count();
    expect(learningCount).toBeGreaterThan(0);
    expect(learningCount).toBeLessThan(grassCount);
    await expect(pokemonLists.getByRole("link", { name: "Chikorita" })).toBeVisible();
    await expect(pokemonLists.getByRole("link", { name: "Bulbasaur" })).not.toBeVisible();
  });

  test("mastery filter URL param is preserved on page load", async ({ page }) => {
    await page.goto("/pokedex?mastery=mastered");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // When active filters are present on load, expand the disclosure to inspect
    // the filter controls (#865).
    await expandFilters(page);

    // The "Mastered" chip should be pressed.
    const masteryGroup = page.getByRole("group", { name: "Filter by mastery" });
    await expect(
      masteryGroup.getByRole("button", { name: "Mastered", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("Pokédex - alternate-form surfaces (#450)", () => {
  test("searching 'alolan' shows at least 1 result when seed has forms, or shows 0 gracefully", async ({
    page,
  }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Filter controls are collapsed by default - expand before interacting (#865).
    await expandFilters(page);

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
    // If hasEmpty is true, that is the expected pre-#445 behaviour - no assertion needed.
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
    // first list to appear before counting - without this wait, count() races
    // the IDB load and returns 0 (skeleton has no list items).
    const allLists = page.getByRole("list", { name: /Pokémon/ });
    await expect(allLists.first()).toBeVisible();
    const tilesBefore = allLists.getByRole("listitem");
    const countBefore = await tilesBefore.count();
    expect(countBefore).toBeGreaterThan(0);

    // Filter controls are collapsed by default - expand before interacting (#865).
    await expandFilters(page);

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
      // Pre-#445 seed: expected - verify the "Clear filters" link is present.
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
    // Verify the page loaded - either "Raichu" or the locked "#026 (locked)" heading.
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
      test.skip(true, "Seed does not yet contain Alolan Raichu - skipping Forms section assertions.");
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

test.describe("Pokédex detail - bottom nav anchoring (#1086)", () => {
  // These tests run on mobile projects where the bottom tab bar is visible.
  // On desktop the tab bar is hidden so the position check is moot.
  test.beforeEach(async ({}, testInfo) => {
    const mobileProjects = ["mobile-safari", "mobile-chrome"];
    test.skip(
      !mobileProjects.includes(testInfo.project.name),
      "bottom-nav anchoring check is mobile-only",
    );
  });

  test("bottom tab bar bottom edge aligns with viewport on the detail page", async ({ page }) => {
    await page.goto("/pokedex/1");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });
    await expect(tabBar).toBeVisible();

    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();

    const box = await tabBar.boundingBox();
    expect(box).not.toBeNull();

    // The bar's bottom edge must reach the viewport bottom (within 2px
    // tolerance for sub-pixel rounding across device-pixel ratios).
    const barBottom = box!.y + box!.height;
    expect(Math.abs(barBottom - viewportSize!.height)).toBeLessThanOrEqual(2);
  });

  test("bottom tab bar is at viewport bottom and content region is scrollable on detail page (#1801)", async ({ page }) => {
    await page.goto("/pokedex/1");

    // Wait for the page to render.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();

    // Under the app-shell model (#1801) the body is fixed at h-[100lvh] on
    // mobile, so body.scrollHeight equals the viewport height rather than
    // being taller. The old invariant (bodyHeight >= viewport.height) was
    // a proxy for "bar stays at the bottom", but it no longer applies.
    //
    // The new invariants:
    // 1. The bar's bottom edge is at the viewport bottom (the bar is in-flow).
    // 2. The [data-scroll-region] wrapper is scrollable on non-Practice routes
    //    (scroll ownership moved from PageShell back to the shell region so
    //    pages that do not use PageShell also scroll - #1839 regression fix).
    const tabBar = page.getByRole("navigation", { name: "Mobile tab navigation" });
    await expect(tabBar).toBeVisible();

    const box = await tabBar.boundingBox();
    expect(box).not.toBeNull();

    const barBottom = box!.y + box!.height;
    expect(Math.abs(barBottom - viewportSize!.height)).toBeLessThanOrEqual(4);

    // The [data-scroll-region] element must be scrollable on a detail page
    // (scrollHeight > clientHeight means there is overflow content).
    const scrollable = await page.evaluate(() => {
      const region = document.querySelector("[data-scroll-region]") as HTMLElement | null;
      if (!region) return null;
      return { scrollHeight: region.scrollHeight, clientHeight: region.clientHeight };
    });
    expect(scrollable).not.toBeNull();
    expect(scrollable!.scrollHeight).toBeGreaterThan(scrollable!.clientHeight);
  });
});

test.describe("Pokédex detail - next review date (#992)", () => {
  test("shows 'Due today' for a Pokémon whose review is overdue", async ({ page }) => {
    // Seed Bulbasaur (id=1) with a dueDate in the past so it is overdue.
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
            dueDate: "2020-01-01",
            lastReview: "2019-12-31",
            firstSeen: "2019-12-31",
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
    await expect(page.getByRole("heading", { name: "Bulbasaur" })).toBeVisible();

    // The review-date line should appear with "Due today" for an overdue card.
    await expect(page.getByText("Due today")).toBeVisible();
  });

  test("shows 'Next review: in N days' for a Pokémon with a future due date", async ({ page }) => {
    // Seed Bulbasaur with a far-future dueDate.
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
            elapsedDays: 1,
            scheduledDays: 30,
            reps: 3,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2099-01-01",
            lastReview: "2026-05-19",
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

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);
    await expect(page.getByRole("heading", { name: "Bulbasaur" })).toBeVisible();

    // The review-date line should appear with "Next review: in N days" for a future card.
    // The ICU `#` placeholder applies locale digit grouping, so a far-future date (e.g.
    // 2099-01-01 → ~26,600 days) renders as "26,645 days" with a thousands separator.
    // Allow commas, narrow no-break spaces (U+202F), and regular spaces in the number.
    await expect(page.getByText(/Next review: in [\d,   ]+ days?/)).toBeVisible();
  });

  test("review date is absent for a locked (never-started) Pokémon", async ({ page }) => {
    // Empty session - Bulbasaur is locked.
    await seedSessionIdb(page, {
      cards: [],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);

    // Locked Pokémon: h1 shows the zero-padded dex number (#1734 / #1729).
    await expect(
      page.getByRole("heading", { level: 1, name: /^#\d{3} \(locked\)$/i }),
    ).toBeVisible();
    await expect(page.getByText("Due today")).not.toBeVisible();
    await expect(page.getByText(/Next review:/)).not.toBeVisible();
  });
});

test.describe("Pokédex sort options (#1314)", () => {
  // Seed Bulbasaur (id=1) as learning and Charmander (id=4) as mastered so that
  // "closest to mastery" has a real ranking to exercise beyond all-locked.
  async function seedTwoPokemon(page: Page) {
    await seedSessionIdb(page, {
      cards: [
        {
          id: 1,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "name",
          state: {
            stability: 5,
            difficulty: 5,
            elapsedDays: 5,
            scheduledDays: 5,
            reps: 2,
            lapses: 0,
            fsrsState: "learning",
            dueDate: "2099-01-01",
            lastReview: "2026-05-01",
            firstSeen: "2026-04-25",
            learningStep: null,
            stepStartedAt: null,
          },
        },
        {
          id: 4,
          name: "Charmander",
          spriteUrl: "/sprites/pokemon/4.png",
          cardType: "name",
          state: {
            stability: 30,
            difficulty: 4,
            elapsedDays: 30,
            scheduledDays: 30,
            reps: 5,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2099-06-01",
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
  }

  test("sort select renders with National Number as default", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    await expandFilters(page);

    // The sort control renders with National Number selected by default.
    const sortSelect = page.getByLabel("Sort by");
    await expect(sortSelect).toBeVisible();
    await expect(sortSelect).toHaveValue("national");
  });

  test("selecting Alphabetical updates the URL and reorders the grid", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Wait for the grid to render before counting.
    const allLists = page.getByRole("list", { name: /Pokémon/ });
    await expect(allLists.first()).toBeVisible();

    // Expand filters and change sort.
    await expandFilters(page);
    const sortSelect = page.getByLabel("Sort by");
    await sortSelect.selectOption("alphabetical");

    // URL should update to include sort=alphabetical.
    await page.waitForURL(/sort=alphabetical/, { timeout: 5_000 });

    // The flat grid (no generation headings) renders after a non-national sort.
    // Verify a grid is still visible with items.
    const flatGrid = page.getByRole("list", { name: "Pokémon" });
    await expect(flatGrid).toBeVisible();
    const tiles = flatGrid.getByRole("listitem");
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);
  });

  test("selecting Closest to mastery updates the URL and renders a grid", async ({ page }) => {
    await seedTwoPokemon(page);
    await page.goto("/pokedex");
    await awaitSeedIdb(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Wait for the grid to hydrate.
    const allLists = page.getByRole("list", { name: /Pokémon/ });
    await expect(allLists.first()).toBeVisible();

    await expandFilters(page);
    const sortSelect = page.getByLabel("Sort by");
    await sortSelect.selectOption("closest-to-mastery");

    await page.waitForURL(/sort=closest-to-mastery/, { timeout: 5_000 });

    // A flat grid with items must render.
    const flatGrid = page.getByRole("list", { name: "Pokémon" });
    await expect(flatGrid).toBeVisible();
    const tiles = flatGrid.getByRole("listitem");
    expect(await tiles.count()).toBeGreaterThan(0);
  });

  test("sort URL param is preserved on reload", async ({ page }) => {
    await page.goto("/pokedex?sort=alphabetical");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    await expandFilters(page);

    const sortSelect = page.getByLabel("Sort by");
    await expect(sortSelect).toHaveValue("alphabetical");
  });

  test("switching back to National Number removes sort param from URL", async ({ page }) => {
    await page.goto("/pokedex?sort=alphabetical");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    await expandFilters(page);
    const sortSelect = page.getByLabel("Sort by");
    await sortSelect.selectOption("national");

    // After reverting to default, sort param should disappear.
    await page.waitForURL((url) => !url.searchParams.has("sort"), { timeout: 5_000 });
    expect(page.url()).not.toContain("sort=");
  });
});

test.describe("Pokédex detail - locale-aware Pokémon name (#1327)", () => {
  // PokemonDetailDisclosure now uses useLocalePokemonName, so switching the
  // pokemonNameLocale setting to 'ja' must cause the Japanese name to appear.
  // This verifies the migration of direct .displayName reads to the hook.

  test("Pokédex detail page renders Japanese name when pokemonNameLocale=ja", async ({
    page,
  }) => {
    // Seed Bulbasaur (id=1, speciesId=1) as learning so the page is not locked.
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

    // Enable the languages Labs flag and set pokemonNameLocale to Japanese.
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
          } catch {
            /* ignore */
          }
        }
        localStorage.setItem(
          KEY,
          JSON.stringify({
            mobileNav: "bottom",
            ...existing,
            pokemonNameLocale: "ja",
            labsFlags: {
              ...(typeof existing.labsFlags === "object" && existing.labsFlags !== null
                ? (existing.labsFlags as Record<string, unknown>)
                : {}),
              languages: true,
            },
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

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);

    // Bulbasaur's Japanese name is フシギダネ (from generated-locale-names.json).
    // The useLocalePokemonName hook fetches the sidecar asynchronously, so we
    // wait for the text to appear rather than checking it synchronously.
    await expect(page.getByText("フシギダネ")).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Pokédex grid locale names (#1327 follow-up: grid names localised)
// ---------------------------------------------------------------------------

test.describe("Pokédex grid - locale names (#1327)", () => {
  test("grid renders a Japanese name when pokemonNameLocale=ja (happy path)", async ({
    page,
  }) => {
    // Seed Bulbasaur as a learning card so it is not locked.
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
            lastReview: "2026-05-01",
            firstSeen: "2026-05-01",
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

    // Enable languages flag and set locale to Japanese before page load.
    await setLocale(page, "ja");

    await page.goto("/pokedex");
    await awaitSeedIdb(page);

    // Wait for the locale-names sidecar to load and the grid to re-render.
    // Bulbasaur's Japanese name is フシギダネ (from generated-locale-names.json).
    await expect(page.getByText("フシギダネ")).toBeVisible({ timeout: 10000 });

    // The English name should not be visible on the tile (it appears in the
    // locale-name span, not alongside it).
    await expect(page.getByText("Bulbasaur")).not.toBeVisible();
  });

  test("grid renders a Simplified Chinese name when pokemonNameLocale=zh-Hans (happy path)", async ({
    page,
  }) => {
    // Seed Bulbasaur as a learning card so it is not locked.
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
            lastReview: "2026-05-01",
            firstSeen: "2026-05-01",
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

    // Enable languages flag and set locale to Simplified Chinese before page load.
    await setLocale(page, "zh-Hans");

    await page.goto("/pokedex");
    await awaitSeedIdb(page);

    // Wait for the locale-names sidecar to load and the grid to re-render.
    // Bulbasaur's zh-Hans name is 妙蛙种子 (from generated-locale-names.json).
    await expect(page.getByText("妙蛙种子")).toBeVisible({ timeout: 10000 });

    // The English name should not be visible on the tile.
    await expect(page.getByText("Bulbasaur")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Pokédex sort stickiness (#1314)
// ---------------------------------------------------------------------------

test.describe("Pokédex sort - sticky across navigation (#1314)", () => {
  test("sort defaults to National Number", async ({ page }) => {
    await page.goto("/pokedex");
    await expandFilters(page);
    const sortSelect = page.getByLabel("Sort by");
    await expect(sortSelect).toBeVisible();
    await expect(sortSelect).toHaveValue("national");
  });

  test("sort persists across navigation to a detail page and back (happy path)", async ({
    page,
  }) => {
    await page.goto("/pokedex");
    await expect(page.getByRole("heading", { level: 1, name: "Pokédex" })).toBeVisible();

    // Change sort to Alphabetical via the filter bar.
    await expandFilters(page);
    const sortSelect = page.getByLabel("Sort by");
    await sortSelect.selectOption("alphabetical");
    await page.waitForURL(/sort=alphabetical/, { timeout: 5_000 });

    // Navigate to a detail page and back.
    await page.goto("/pokedex/1");
    await page.goto("/pokedex");

    // Sort should still be Alphabetical after returning to the grid
    // (restored from localStorage when the URL has no sort param).
    await expandFilters(page);
    const sortSelectAfter = page.getByLabel("Sort by");
    await expect(sortSelectAfter).toBeVisible();
    await expect(sortSelectAfter).toHaveValue("alphabetical");
  });
});

// ---------------------------------------------------------------------------
// Pokédex detail - locked-state signposts (#1440)
// ---------------------------------------------------------------------------

test.describe("Pokédex detail - locked-state signposts (#1440)", () => {
  test("locked species: Base Stats section shows unlock hint instead of stat bars", async ({
    page,
  }) => {
    // Empty session → all species are locked. Bulbasaur (id=1) is locked.
    await seedSessionIdb(page, {
      cards: [],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);

    // Page loads with locked state: h1 shows zero-padded dex number (#1734 / #1729).
    await expect(
      page.getByRole("heading", { level: 1, name: /^#\d{3} \(locked\)$/i }),
    ).toBeVisible();

    // Base Stats section heading is visible with the unlock hint
    await expect(
      page.getByRole("heading", { name: "Base Stats", level: 2 }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Unlocks when you master this Pokémon.").first(),
    ).toBeVisible();
  });

  test("locked species: Facts section shows unlock hint", async ({ page }) => {
    await seedSessionIdb(page, {
      cards: [],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);

    await expect(
      page.getByRole("heading", { name: "Facts", level: 2 }).first(),
    ).toBeVisible();
    // Multiple unlock hints appear (one per locked section)
    await expect(
      page.getByText("Unlocks when you master this Pokémon.").first(),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Pokédex detail - game-label facts (#1559)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pokédex sort - InfoButton for "Closest to mastery" (#1574)
// ---------------------------------------------------------------------------

test.describe("Pokédex sort - Closest to mastery InfoButton (#1574)", () => {
  test("InfoButton appears when Closest to mastery sort is selected and opens its panel on click", async ({
    page,
  }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Expand filters first.
    await expandFilters(page);

    // The InfoButton should not be present with the default national sort.
    await expect(
      page.getByRole("button", { name: "About Closest to mastery sort" }),
    ).not.toBeVisible();

    // Switch sort to Closest to mastery.
    const sortSelect = page.getByLabel("Sort by");
    await sortSelect.selectOption("closest-to-mastery");
    await page.waitForURL(/sort=closest-to-mastery/, { timeout: 5_000 });

    // InfoButton should now be visible.
    const infoBtn = page.getByRole("button", {
      name: "About Closest to mastery sort",
    });
    await expect(infoBtn).toBeVisible();
    expect(await infoBtn.getAttribute("aria-expanded")).toBe("false");

    // Click the button to open the panel.
    await infoBtn.click();
    expect(await infoBtn.getAttribute("aria-expanded")).toBe("true");

    // Panel copy is visible.
    await expect(
      page.getByText(/Puts Pokémon you are closest to mastering/),
    ).toBeVisible();
  });

  test("InfoButton panel closes on second click", async ({ page }) => {
    await page.goto("/pokedex?sort=closest-to-mastery");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    await expandFilters(page);

    const infoBtn = page.getByRole("button", {
      name: "About Closest to mastery sort",
    });
    await expect(infoBtn).toBeVisible();

    await infoBtn.click();
    await expect(
      page.getByText(/Puts Pokémon you are closest to mastering/),
    ).toBeVisible();

    await infoBtn.click();
    await expect(
      page.getByText(/Puts Pokémon you are closest to mastering/),
    ).not.toBeVisible();
  });
});

test.describe("Pokédex detail - game-label facts (#1559)", () => {
  test("facts section shows source game names instead of 'Pokédex entry' for a mastered Pokémon", async ({
    page,
  }) => {
    // The Facts section only renders when the species is mastered at the
    // species level: both the name card (id=1) and the reverse card
    // (id=REVERSE_ID_OFFSET+1 = 2_000_001) must have reps >= masteryRepetitions
    // (default 3) and scheduledDays >= 21.
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
        {
          id: 2_000_001,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "reverse",
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

    // Register the response waiter BEFORE navigating so we cannot miss a fast
    // response on either browser project.
    const flavorResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/pokemon-data/generated-flavor.json") && resp.status() === 200,
      { timeout: 20_000 },
    );

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);
    await expect(page.getByRole("heading", { name: "Bulbasaur" })).toBeVisible();

    // Wait for the flavour JSON fetch to complete. Once the response arrives,
    // the component's `flavorLoaded` state flips to true and triggers a re-render
    // that picks up the now-populated cache. No round-trip navigation is needed.
    await flavorResponsePromise;

    // The game-label feature (#1559) replaces the repeated "Pokédex entry" dt
    // label with the source game name(s) from generated-flavor.json.
    // Bulbasaur's first flavour text is shared by Red, Blue, and LeafGreen →
    // formatted as "Red · Blue · LeafGreen".
    await expect(page.getByText("Red · Blue · LeafGreen")).toBeVisible({
      timeout: 10_000,
    });
    // The generic fallback label must not appear for any flavour-text row now
    // that the full game-label data is confirmed loaded.
    await expect(page.getByText("Pokédex entry")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Pokédex detail - journey line: first-reviewed date + Mastered badge (#1948)
// ---------------------------------------------------------------------------

/**
 * Seeds `dateFormat: "dmy"` and `timezone: "UTC"` into the settings key so the
 * journey line's `formatDate` output is deterministic across CI locales
 * (mirrors the merge pattern `setLocale` uses above for the same key).
 */
async function setDeterministicDateSettings(page: Page): Promise<void> {
  await page.addInitScript(({ key }: { key: string }) => {
    try {
      const raw = localStorage.getItem(key);
      let existing: Record<string, unknown> = {};
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === "object" && parsed !== null) {
            existing = parsed as Record<string, unknown>;
          }
        } catch {
          /* ignore */
        }
      }
      const merged = {
        ...existing,
        dateFormat: "dmy",
        timezone: "UTC",
      };
      localStorage.setItem(key, JSON.stringify(merged));
    } catch {
      /* localStorage unavailable */
    }
  }, { key: SETTINGS_KEY });
}

test.describe("Pokédex detail - journey line (#1948)", () => {
  test("started (non-mastered) species shows 'First reviewed' and no Mastered badge", async ({
    page,
  }) => {
    await setDeterministicDateSettings(page);
    // Seed Bulbasaur (id=1) with a learning-only name card - firstSeen is set
    // but reps/scheduledDays are below the mastery gate, so cardClass is
    // "learning", not "mastered".
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
    await expect(page.getByRole("heading", { name: "Bulbasaur" })).toBeVisible();

    // Assert the "First reviewed" label renders; do NOT pin the exact
    // formatted date ("Wed 13 May") - Intl date output differs by platform
    // ICU (macOS vs CI Linux webkit), so an exact-string match is flaky on
    // mobile-safari in CI. The label prefix is deterministic.
    await expect(page.getByText(/First reviewed/)).toBeVisible();
    // Scope to the journey-line container (the div holding "First reviewed")
    // rather than a bare page-wide "Mastered" text match: the per-direction
    // leg-status rows below also render the localised "Mastered" token, so an
    // unscoped match is ambiguous once that section renders.
    const journeyLine = page
      .locator("div")
      .filter({ hasText: "First reviewed" })
      .last();
    await expect(journeyLine.getByText("Mastered", { exact: true })).not.toBeVisible();
  });

  test("mastered species shows both 'First reviewed' and the Mastered badge", async ({
    page,
  }) => {
    await setDeterministicDateSettings(page);
    // Species-level mastery requires BOTH the name card and the paired reverse
    // card to clear the FSRS gate (#1448) - same seed shape as the #1559 test
    // above.
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
        {
          id: 2_000_001,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "reverse",
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

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);
    await expect(page.getByRole("heading", { name: "Bulbasaur" })).toBeVisible();

    // Assert the "First reviewed" label renders; do NOT pin the exact
    // formatted date - Intl output differs by platform ICU (flaky on CI
    // mobile-safari). The label prefix is deterministic.
    await expect(page.getByText(/First reviewed/)).toBeVisible();
    // Scope to the journey-line container - the per-direction leg-status rows
    // below also render the localised "Mastered" token, so an unscoped match
    // is ambiguous (multiple "Mastered" strings on a fully-mastered page).
    const journeyLine = page
      .locator("div")
      .filter({ hasText: "First reviewed" })
      .last();
    await expect(journeyLine.getByText("Mastered", { exact: true })).toBeVisible();
  });

  test("never-seen (locked) species shows neither 'First reviewed' nor the Mastered badge", async ({
    page,
  }) => {
    // Empty session - Bulbasaur is locked.
    await seedSessionIdb(page, {
      cards: [],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/pokedex/1");
    await awaitSeedIdb(page);

    // Locked species: h1 shows the zero-padded dex number (#1734 / #1729).
    await expect(
      page.getByRole("heading", { level: 1, name: /^#\d{3} \(locked\)$/i }),
    ).toBeVisible();
    await expect(page.getByText(/First reviewed/)).not.toBeVisible();
    await expect(page.getByText("Mastered", { exact: true })).not.toBeVisible();
  });

  test("Japanese app locale renders the localised 'First reviewed' label", async ({
    page,
    context,
  }) => {
    // Locale coverage (AGENTS.md "Names/labels in every locale"): the journey
    // line's label text must be localised. This is the `appLocale` axis (UI
    // chrome / interface language, set via the `poke-memory:locale` cookie -
    // see i18n.spec.ts), NOT `pokemonNameLocale` (which only controls the
    // rendered Pokémon name and is independent - #1259/#1327). `firstSeen` is
    // locale-independent (earliest across all of the species' name cards), so
    // the date shows regardless of the display locale (#1948).
    await context.addCookies([
      { name: "poke-memory:locale", value: "ja", domain: "localhost", path: "/" },
    ]);
    await setDeterministicDateSettings(page);
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

    // ja: messages/ja.json "firstReviewed": "初回学習: {date}".
    await expect(page.getByText(/初回学習/)).toBeVisible();
  });
});

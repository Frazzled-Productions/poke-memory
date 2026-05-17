import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
  buildCompletedSession,
} from "./helpers/completedSession";

test.describe("Navigation", () => {
  test("nav links are visible and navigate between pages", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();

    /**
     * Helper: resolve the link container. On desktop the links live directly
     * in the main nav header row. On mobile they live in the fixed bottom tab
     * bar (aria-label "Mobile tab navigation").
     */
    function getNavLinkContainer() {
      if (testInfo.project.name === "mobile-safari") {
        return page.getByRole("navigation", { name: "Mobile tab navigation" });
      }
      return nav;
    }

    for (const { label, path } of [
      { label: "Stats", path: "/stats" },
      { label: "Pokédex", path: "/pokedex" },
      { label: "Settings", path: "/settings" },
    ]) {
      const container = getNavLinkContainer();
      await container.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(path);
      await expect(
        page.getByRole("heading", { level: 1, name: label }),
      ).toBeVisible();
    }

    // Navigate back to practice
    const container = getNavLinkContainer();
    await container.getByRole("link", { name: "Practice" }).click();
    await expect(page).toHaveURL("/");
  });
});

test.describe("Practice page", () => {
  test("loads and shows a card or end-state", async ({ page }) => {
    await page.goto("/");

    // Either a Reveal button (active card) or an end-state heading
    const reveal = page.getByRole("button", { name: "Reveal" });
    const endState = page.getByRole("heading", {
      name: /All caught up|Daily review limit reached|New cards locked|Next card in|No card types enabled/,
    });

    await expect(reveal.or(endState)).toBeVisible();
  });

  test("reveal shows grade buttons", async ({ page }) => {
    await page.goto("/");
    const reveal = page.getByRole("button", { name: "Reveal" });

    // Skip if no active card (end-state screen)
    if (!(await reveal.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await reveal.click();

    const gradeGroup = page.getByRole("group", { name: "Grade your answer" });
    await expect(gradeGroup).toBeVisible();

    for (const grade of ["Again", "Hard", "Good", "Easy"]) {
      await expect(
        gradeGroup.getByRole("button", { name: grade }),
      ).toBeVisible();
    }
  });

  test("Hear name button appears after revealing a name card", async ({ page }) => {
    // Seed a session with a single name card due for review so we control the card type.
    await seedSessionIdb(page, {
      cards: [
        {
          id: 1,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "name",
          state: {
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "new",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: null,
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });

    await page.goto("/");
    await awaitSeedIdb(page);
    const reveal = page.getByRole("button", { name: "Reveal" });
    if (!(await reveal.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await reveal.click();

    await expect(page.getByRole("button", { name: "Hear Bulbasaur" })).toBeVisible();
  });

  test("Hear name button on practice card is clickable without page error (#435)", async ({ page }) => {
    // Smoke-level guard: clicking the speaker button on a revealed name card must
    // not produce an uncaught page exception. speakName tries /audio/names/1.mp3
    // first and falls back to Web Speech on error, so a 404 on the preview
    // deployment is not a failure.
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
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "new",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: null,
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });

    await page.goto("/");
    await awaitSeedIdb(page);
    const reveal = page.getByRole("button", { name: "Reveal" });
    if (!(await reveal.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await reveal.click();

    const hearBtn = page.getByRole("button", { name: "Hear Bulbasaur" });
    await expect(hearBtn).toBeVisible();
    await hearBtn.click();

    // Brief pause to let any async rejection surface.
    await page.waitForTimeout(300);
    expect(pageErrors).toHaveLength(0);
  });

  test("Hear name buttons appear on an evolution card (prompt + answer)", async ({ page }) => {
    // Seed an evolution card (Bulbasaur → Ivysaur, edgeId 1500001). hydrateSession
    // refreshes the per-side names/sprites from the seed; we only need cardType,
    // id, postEvoId, and state for the saved card to validate and hydrate.
    await seedSessionIdb(page, {
      cards: [
        {
          cardType: "evolution",
          id: 1500001,
          preEvoId: 1,
          preEvoName: "bulbasaur",
          preEvoSpriteUrl: "/sprites/pokemon/1.png",
          postEvoId: 2,
          postEvoName: "ivysaur",
          postEvoSpriteUrl: "/sprites/pokemon/2.png",
          triggerPhrase: null,
          state: {
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "new",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: null,
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        evolution: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });

    await page.goto("/");
    await awaitSeedIdb(page);
    const reveal = page.getByRole("button", { name: "Reveal" });
    if (!(await reveal.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // Pre-reveal: prompt-side speaker for the pre-evolution name is present.
    await expect(page.getByRole("button", { name: "Hear bulbasaur" })).toBeVisible();

    await reveal.click();

    // Post-reveal: answer-side speaker for the post-evolution name is also present.
    await expect(page.getByRole("button", { name: "Hear ivysaur" })).toBeVisible();
    // Prompt-side stays mounted.
    await expect(page.getByRole("button", { name: "Hear bulbasaur" })).toBeVisible();
  });

  test("Hear name buttons appear on a reverse-evolution card (prompt + answer)", async ({ page }) => {
    // Reverse-evolution edge ID for 1500001 is 2500001 (#262 namespace).
    await seedSessionIdb(page, {
      cards: [
        {
          cardType: "reverse-evolution",
          id: 2500001,
          name: "ivysaur",
          spriteUrl: "/sprites/pokemon/2.png",
          preEvoId: 1,
          preEvoName: "bulbasaur",
          preEvoSpriteUrl: "/sprites/pokemon/1.png",
          postEvoId: 2,
          postEvoName: "ivysaur",
          postEvoSpriteUrl: "/sprites/pokemon/2.png",
          triggerPhrase: null,
          state: {
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "new",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: null,
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        "reverse-evolution": { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });
    // Reverse-evolution cards are gated by a settings toggle (default off).
    await page.addInitScript(() => {
      localStorage.setItem(
        "poke-memory:user-settings:v1",
        JSON.stringify({ reverseEvolutionCardsEnabled: true }),
      );
    });

    await page.goto("/");
    await awaitSeedIdb(page);
    const reveal = page.getByRole("button", { name: "Reveal" });
    if (!(await reveal.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // Reverse-evolution prompt shows the post-evo name; speaker present pre-reveal.
    await expect(page.getByRole("button", { name: "Hear ivysaur" })).toBeVisible();

    await reveal.click();

    // Answer is the pre-evolution; its speaker is added on reveal.
    await expect(page.getByRole("button", { name: "Hear bulbasaur" })).toBeVisible();
  });

  test("Hear name button appears on a reverse (sprite-picker) card", async ({ page }) => {
    await seedSessionIdb(page, {
      cards: [
        {
          id: 2_000_001,
          pokemonId: 1,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "reverse",
          state: {
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "new",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: null,
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "poke-memory:user-settings:v1",
        JSON.stringify({ reverseCardsEnabled: true }),
      );
    });

    await page.goto("/");
    await awaitSeedIdb(page);
    // Reverse cards have no Reveal step — the prompt + sprite picker render on load.
    const speaker = page.getByRole("button", { name: "Hear Bulbasaur" });
    if (!(await speaker.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await expect(speaker).toBeVisible();
  });

  test("fits viewport without scrolling on iPhone 17 Pro", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "viewport-fit check is mobile-only",
    );
    // iPhone 17 Pro CSS viewport (the device reported in #332). The default
    // mobile-safari project uses iPhone 14 (390x844); override here so the
    // assertion matches the actual reported device.
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto("/");

    const reveal = page.getByRole("button", { name: "Reveal" });
    if (!(await reveal.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await expect(reveal).toBeVisible();

    const overflowBefore = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflowBefore).toBeLessThanOrEqual(1);

    await reveal.click();
    await expect(
      page.getByRole("group", { name: "Grade your answer" }),
    ).toBeVisible();

    const overflowAfter = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflowAfter).toBeLessThanOrEqual(8);
  });
});

test.describe("Stats page", () => {
  test("loads with key sections", async ({ page }) => {
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 1, name: "Stats" }),
    ).toBeVisible();

    // Key section headings should be present
    for (const heading of [
      "Current streak",
      "Mastery distribution",
      "Due forecast",
    ]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    // SyncNowButton was removed in #396 — assert it is absent in guest mode
    await expect(page.getByRole("button", { name: /Sync now/i })).toHaveCount(0);
  });

  test("trainer card shows progress line", async ({ page }) => {
    await page.goto("/stats");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible();
    await expect(page.getByText(/\d+ \/ \d+ mastered · \d+ to Lv \d+/)).toBeVisible();
  });

  test("grade distribution section renders in empty state for a fresh guest (#800)", async ({ page }) => {
    await page.goto("/stats");
    // Wait for the page to finish loading (skeleton gone).
    await expect(
      page.getByRole("heading", { name: "Current streak" }),
    ).toBeVisible({ timeout: 10_000 });
    // The section heading must be present.
    await expect(
      page.getByRole("heading", { name: "Grade distribution" }),
    ).toBeVisible();
    // Guest with no grades sees the empty-state copy.
    await expect(
      page.getByText("No grades recorded yet."),
    ).toBeVisible();
  });

  // Gym badges (#420) are secret until earned: a fresh guest must see no
  // hint of any badge name on the trainer card. The full superuser overlay
  // path is exercised by component tests; this smoke test guards the
  // discoverability contract end-to-end.
  test("gym badges are not hinted before any are earned", async ({ page }) => {
    await page.goto("/stats");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Gym badges earned" }),
    ).toHaveCount(0);
    for (const name of [
      "Cascade Badge",
      "Boulder Badge",
      "Eeveelutions",
      "Legendary Birds",
    ]) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  });
});

test.describe("Pokédex page", () => {
  test("loads with heading and intro counter", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // The page loads session data from IndexedDB asynchronously before
    // swapping the skeleton for the real counter. Use a generous timeout and
    // a permissive pattern (toLocaleString() may insert commas, e.g. "1,174").
    await expect(page.getByText(/[\d,]+ \/ [\d,]+ introduced/)).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("Settings page", () => {
  // NOTE: We do NOT use addInitScript for localStorage.clear() here because
  // addInitScript runs on every navigation including page.reload(), which would
  // wipe settings the user just saved before the reload can read them back.
  // Instead, each test clears localStorage once via page.evaluate() before
  // its initial page.goto().

  test("loads with key sections", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();

    // Wait for settings to load (skeleton disappears)
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    // Top-level collapsible section headings are rendered as <h2> disclosure
    // toggles and should be visible on fresh load (collapsed but present).
    for (const heading of ["Appearance", "Practice", "Audio", "Account & Data", "Advanced"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    // Expand Practice to verify sub-section content is present.
    await page.getByRole("button", { name: "Practice", exact: true }).click();

    // Save button is inside the Practice panel.
    await expect(
      page.getByRole("button", { name: "Save" }),
    ).toBeVisible();

    // Sub-section label and FSRS section present inside Practice.
    // exact: true avoids matching "Cry → name cards" added in #481.
    await expect(page.getByText("Name cards", { exact: true })).toBeVisible();
    await expect(page.getByText("Personalize my schedule", { exact: true })).toBeVisible();

    // Expand Account & Data to verify Backup and About sub-sections.
    await page.getByRole("button", { name: "Account & Data", exact: true }).click();
    await expect(page.getByText("Backup", { exact: true })).toBeVisible();
    await expect(page.getByText("About", { exact: true })).toBeVisible();

    // Expand Advanced to verify Danger zone sub-section.
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    await expect(page.getByText("Danger zone", { exact: true })).toBeVisible();
  });

  test("FSRS optimizer section shows sign-in prompt for guests", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    // Expand the Practice section first — FSRS optimizer lives inside it.
    await page.getByRole("button", { name: "Practice", exact: true }).click();

    // Sub-section label is present inside the expanded panel.
    await expect(
      page.getByText("Personalize my schedule", { exact: true }),
    ).toBeVisible();

    // Guest state: sign-in prompt is visible
    await expect(
      page.getByText("Sign in to enable personalized scheduling."),
    ).toBeVisible();

    // Guest state: the optimize button is NOT rendered
    await expect(
      page.locator('[data-testid="fsrs-optimize-button"]'),
    ).toBeHidden();
  });

  test("numeric field accepts mid-edit value and persists on Save", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    // Expand the Practice section first — New cards per day and Save live inside it.
    await page.getByRole("button", { name: "Practice", exact: true }).click();

    const input = page.getByLabel("New cards per day").first();
    await input.click();
    await input.selectText();
    await input.fill("5");
    // Blur by clicking away so the draft commits before Save.
    await page.getByRole("heading", { level: 1, name: "Settings" }).click();

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Saved!")).toBeVisible();
    // Reload and verify the value persisted. The Practice section remains
    // expanded after reload because the open state is persisted in localStorage
    // (no addInitScript clear in this test), so we can read the input directly.
    await page.reload();
    await expect(page.getByLabel("Loading settings")).toBeHidden();
    await expect(page.getByLabel("New cards per day").first()).toHaveValue("5");
  });

  test("App Theme section hidden when no Pokémon mastered", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();
    await expect(page.getByRole("heading", { name: "App Theme" })).toBeHidden();
  });

  test("App Theme section visible and theme applies after mastering a Pokémon", async ({
    page,
  }) => {
    // Seed a mastered Charizard (id=6: repetitions >= 3 AND interval >= 21)
    await seedSessionIdb(page, {
      cards: [
        {
          id: 6,
          name: "Charizard",
          spriteUrl: "/sprites/pokemon/6.png",
          cardType: "name",
          state: {
            repetitions: 3,
            interval: 21,
            easeFactor: 2.5,
            dueDate: "2026-05-20",
            lastReview: "2026-04-29",
            firstSeen: "2026-03-01",
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/settings");
    await awaitSeedIdb(page);
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    // Expand the Appearance section — App Theme lives inside it.
    await page.getByRole("button", { name: "Appearance", exact: true }).click();

    // App Theme heading and Charizard card should be visible.
    await expect(page.getByRole("heading", { name: "App Theme" })).toBeVisible();
    await expect(page.getByText("Charizard")).toBeVisible();

    // Record nav header background before selecting theme
    const navHeader = page.locator("header").first();
    const bgBefore = await navHeader.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );

    // Select Charizard as the app theme
    await page.getByRole("button", { name: "Set as theme" }).click();

    // Nav header background should have changed to Charizard's primary colour.
    // Poll until React re-renders and applyTheme writes the new CSS variable.
    await expect(async () => {
      const bgAfter = await navHeader.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );
      expect(bgAfter).not.toBe(bgBefore);
    }).toPass({ timeout: 5000 });

    // "Selected ✓" indicator and Remove button should appear
    await expect(page.getByText("Selected ✓")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  });
});

test.describe("Sign-in picker (#360)", () => {
  test("opens menu with GitHub and Google options plus provider warning", async ({
    page,
  }) => {
    await page.goto("/");

    const signIn = page.getByRole("button", { name: "Sign in" });
    if (!(await signIn.isVisible().catch(() => false))) {
      // AuthButton renders nothing when Supabase env vars are absent — skip
      // rather than fail in environments without auth configured.
      test.skip();
      return;
    }

    await signIn.click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Continue with GitHub" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(
      menu.getByText(/Use the same provider you signed up with/i),
    ).toBeVisible();
  });

  // Header flex-wrap puts the Sign-in trigger at the LEFT edge of the
  // viewport on narrow mobile (e.g. 390px iPhone 14 — nav-ul wraps below
  // the logo and the trigger sits beside it) and at the RIGHT edge on
  // wider mobile below the `sm:` breakpoint (e.g. 430px iPhone 14 Pro Max
  // — the whole row fits and `justify-between` pushes the trigger right).
  // Exercise both wrap modes so the panel doesn't regress to overflowing
  // on either edge (#406, #441).
  for (const vw of [375, 414]) {
    test(`popup stays within the viewport at ${vw}px (#441)`, async ({
      page,
      browserName,
    }) => {
      test.skip(
        browserName !== "chromium",
        "viewport-fit check only needs one engine",
      );
      await page.setViewportSize({ width: vw, height: 800 });
      await page.goto("/");

      const signIn = page.getByRole("button", { name: "Sign in" });
      if (!(await signIn.isVisible().catch(() => false))) {
        test.skip();
        return;
      }

      await signIn.click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();

      const menuBox = await menu.boundingBox();
      const viewport = page.viewportSize();
      expect(menuBox).not.toBeNull();
      expect(viewport).not.toBeNull();
      if (!menuBox || !viewport) return;

      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
    });
  }
});

test.describe("Streak milestone celebration (#419)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("fires once on milestone day and does not re-fire on reload", async ({
    page,
  }) => {
    // Seed three consecutive review days ending today → streak = 3 = first milestone.
    await page.addInitScript(() => {
      const today = new Date();
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const day = (offset: number) => {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() + offset);
        return iso(d);
      };
      localStorage.setItem(
        "poke-memory:streak:v1",
        JSON.stringify([day(-2), day(-1), day(0)]),
      );
    });

    await page.goto("/");

    const banner = page.getByRole("status", {
      name: /3-day streak reached/i,
    });
    await expect(banner).toBeVisible();
    await expect(page.getByText("3-day streak!")).toBeVisible();

    // Auto-dismiss after 3.5 s — give it 5 s.
    await expect(banner).toBeHidden({ timeout: 5000 });

    // Reload: seenStreakMilestones now contains 3, so no re-fire.
    await page.reload();
    await expect(
      page.getByRole("status", { name: /streak reached/i }),
    ).toBeHidden();
  });
});

test.describe("Daily summary persistence (#685)", () => {
  // Pre-seed every known card ID as already-reviewed so hydrateSession adds no
  // new cards and the practice page lands on the "All caught up!" complete
  // screen immediately. Seeding only a single card is not enough — hydrateSession
  // would append the full SEED_POKEMON list as new cards and queue them.
  const completedSession = buildCompletedSession({
    pokemonIds: SEED_POKEMON_IDS,
    evolutionCardIds: EVOLUTION_CARD_IDS,
  });

  test("'Share today' button visible when today-dated summary is in localStorage", async ({ page }) => {
    await seedSessionIdb(page, completedSession);

    // Seed a valid today-dated daily summary in localStorage.
    // The date expression deliberately re-implements todayInTimezone("UTC")
    // inline — addInitScript runs in the browser before any app module loads,
    // so the production helper cannot be imported here.
    await page.addInitScript(() => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
      localStorage.setItem("poke-memory:daily-summary:v1", JSON.stringify({
        date: today,
        gradeSequence: [4, 5, 4],
        reviewed: 3,
        newCards: 1,
        mastered: 0,
      }));
    });

    await page.goto("/");
    await awaitSeedIdb(page);

    // Wait for the complete screen to render.
    await expect(page.getByText("All caught up!")).toBeVisible({ timeout: 10_000 });

    // Share today button should be visible because we seeded a valid summary.
    await expect(page.getByRole("button", { name: "Share today" })).toBeVisible();
  });

  test("'Share today' button absent with no daily summary seeded", async ({ page }) => {
    await seedSessionIdb(page, completedSession);

    await page.goto("/");
    await awaitSeedIdb(page);

    // Wait for the complete screen to render.
    await expect(page.getByText("All caught up!")).toBeVisible({ timeout: 10_000 });

    // No daily summary — share button must not be shown.
    await expect(page.getByRole("button", { name: "Share today" })).toHaveCount(0);
  });
});

test.describe("Evolution edge card prompt (#262)", () => {
  test("renders 'What does {preEvo} evolve into {trigger}?' for an edge card", async ({ page }) => {
    // Seed a deterministic session containing exactly one evolution edge card
    // (Bulbasaur → Ivysaur, "at level 16") so the assertion isn't sensitive
    // to which card the queue happens to surface first.
    await seedSessionIdb(page, {
      cards: [
        {
          id: 1_500_001,
          cardType: "evolution",
          preEvoId: 1,
          preEvoName: "bulbasaur",
          preEvoSpriteUrl: "/sprites/pokemon/1.png",
          postEvoId: 2,
          postEvoName: "ivysaur",
          postEvoSpriteUrl: "/sprites/pokemon/2.png",
          triggerPhrase: "at level 16",
          // Use review state (reps >= 1) so the card lands in the review queue,
          // which is served before the new queue, making it the first card shown.
          state: {
            stability: 4,
            difficulty: 5,
            elapsedDays: 5,
            scheduledDays: 5,
            reps: 1,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2026-01-01",
            lastReview: "2026-04-29",
            firstSeen: "2026-04-24",
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        evolution: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });
    // The session limits in the IDB payload are overridden by settings. Disable
    // name/reverse/cry cards in settings so only the seeded evolution card can
    // appear — it's a review card so the review queue is served first.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "poke-memory:settings:v1",
        JSON.stringify({
          nameCardsEnabled: false,
          reverseCardsEnabled: false,
          cryCardsEnabled: false,
          evolutionCardsEnabled: true,
          maxNewEvolutionPerDay: 10,
          maxReviewsEvolutionPerDay: 100,
        }),
      );
    });

    await page.goto("/");
    await awaitSeedIdb(page);

    // Wait for the session to load from IndexedDB (async post-#486) before
    // asserting card content. The Reveal button appearing confirms hydration.
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible({
      timeout: 10_000,
    });

    // The prompt `<p>` contains a speak-name button (🔊) between the preEvo
    // name span and "evolve into", so the text nodes are split. Use a flexible
    // pattern that tolerates arbitrary characters between the key phrases.
    await expect(
      page.getByText(/What does.*bulbasaur.*evolve into.*at level 16\?/i),
    ).toBeVisible();
  });
});

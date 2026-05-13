import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("nav links are visible and navigate between pages", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();

    for (const { label, path } of [
      { label: "Stats", path: "/stats" },
      { label: "Pokédex", path: "/pokedex" },
      { label: "Settings", path: "/settings" },
    ]) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(path);
      await expect(
        page.getByRole("heading", { level: 1, name: label }),
      ).toBeVisible();
    }

    // Navigate back to practice
    await nav.getByRole("link", { name: "Practice" }).click();
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
  });

  test("trainer card shows progress line", async ({ page }) => {
    await page.goto("/stats");
    await expect(
      page.getByRole("region", { name: "Trainer card" }),
    ).toBeVisible();
    await expect(page.getByText(/\d+ \/ \d+ mastered · \d+ to Lv \d+/)).toBeVisible();
  });
});

test.describe("Pokédex page", () => {
  test("loads with heading and intro counter", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Intro counter: "X / Y introduced"
    await expect(page.getByText(/\d+ \/ \d+ introduced/)).toBeVisible();
  });
});

test.describe("Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("loads with key sections", async ({ page }) => {
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();

    // Wait for settings to load (skeleton disappears)
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    for (const heading of ["Audio", "Name cards", "About", "Backup", "Danger zone"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    // Save button present
    await expect(
      page.getByRole("button", { name: "Save" }),
    ).toBeVisible();
  });

  test("App Theme section hidden when no Pokémon mastered", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();
    await expect(page.getByRole("heading", { name: "App Theme" })).toBeHidden();
  });

  test("App Theme section visible and theme applies after mastering a Pokémon", async ({
    page,
  }) => {
    // Seed a mastered Charizard (id=6: repetitions >= 3 AND interval >= 21)
    await page.addInitScript(() => {
      const session = {
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
      };
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify(session),
      );
    });

    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    // App Theme section should be visible with Charizard
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

test.describe("Evolution edge card prompt (#262)", () => {
  test("renders 'What does {preEvo} evolve into {trigger}?' for an edge card", async ({ page }) => {
    // Seed a deterministic session containing exactly one evolution edge card
    // (Bulbasaur → Ivysaur, "at level 16") so the assertion isn't sensitive
    // to which card the queue happens to surface first.
    await page.addInitScript(() => {
      const session = {
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
            state: {
              stability: 0,
              difficulty: 0,
              elapsedDays: 0,
              scheduledDays: 0,
              reps: 0,
              lapses: 0,
              fsrsState: "new",
              dueDate: "2026-05-09",
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
      };
      localStorage.setItem(
        "poke-memory:review-session:v1",
        JSON.stringify(session),
      );
    });

    await page.goto("/");

    // The prompt is split across inline spans for case styling, so match the
    // full normalised sentence.
    await expect(
      page.getByText(/What does\s+bulbasaur\s+evolve into\s+at level 16\?/i),
    ).toBeVisible();
  });
});

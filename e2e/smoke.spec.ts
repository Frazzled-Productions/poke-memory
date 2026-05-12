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

    // Nav header background should have changed to Charizard's primary colour
    const bgAfter = await navHeader.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    expect(bgAfter).not.toBe(bgBefore);

    // "Selected ✓" indicator and Remove button should appear
    await expect(page.getByText("Selected ✓")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  });
});

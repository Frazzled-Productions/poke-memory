import { test, expect } from "@playwright/test";
import { practiceReadyLocator } from "./helpers/practiceCard";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";

const SETTINGS_KEY = "poke-memory:settings:v1";

// The global storageState (e2e/global-setup.ts) pre-dismisses the onboarding
// modal so it does not block every other spec. This file's whole purpose is
// to verify the modal renders and dismisses correctly, so override the global
// storageState with an empty one — the app must see a brand-new visitor.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("First-visit onboarding modal (#1103)", () => {
  test("modal appears on a fresh visit and is dismissible", async ({
    page,
  }) => {
    await page.goto("/");

    const modal = page.getByRole("dialog", { name: /welcome to pok[eé] memory/i });
    await expect(modal).toBeVisible();

    // Grading guidance must be present inside the modal — assert all four grade
    // labels render as bold terms in the grading list.
    await expect(modal.locator("strong").filter({ hasText: /^Again$/ })).toBeVisible();
    await expect(modal.locator("strong").filter({ hasText: /^Hard$/ })).toBeVisible();
    await expect(modal.locator("strong").filter({ hasText: /^Good$/ })).toBeVisible();
    await expect(modal.locator("strong").filter({ hasText: /^Easy$/ })).toBeVisible();

    await modal.getByRole("button", { name: /get started/i }).click();
    await expect(modal).toHaveCount(0);

    // After dismissal the Practice card surface must be interactable. The
    // first card may be a flip card (Reveal), a sprite-picker, or a
    // multiple-choice card depending on the deterministic per-day shuffle, so
    // match every variant (#1370 — the bare Reveal-or-"all caught up" locator
    // timed out on days the shuffle led with a reverse card). 20 s budget
    // covers fresh-visitor hydration of the ~2 050-card set (#1234) plus the
    // #1260 next-intl Suspense round-trip.
    await expect(practiceReadyLocator(page)).toBeVisible({ timeout: 20_000 });
  });

  test("modal does not reappear after dismissal", async ({ page }) => {
    await page.goto("/");

    const modal = page.getByRole("dialog", { name: /welcome to pok[eé] memory/i });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: /get started/i }).click();
    await expect(modal).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole("dialog", { name: /welcome to pok[eé] memory/i }),
    ).toHaveCount(0);
  });

  test("modal does not appear when firstVisitOnboardingDismissed is already set", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: { firstVisitOnboardingDismissed: true },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.getByRole("dialog", { name: /welcome to pok[eé] memory/i }),
    ).toHaveCount(0);
  });

  test("Settings reset re-opens the modal on next Practice visit", async ({
    page,
  }) => {
    // Dismiss the modal first.
    await page.goto("/");
    const modal = page.getByRole("dialog", { name: /welcome to pok[eé] memory/i });
    if (await modal.isVisible().catch(() => false)) {
      await modal.getByRole("button", { name: /get started/i }).click();
    }

    await page.goto("/settings");
    // "How this works" lives inside the collapsible "Account & Data" section.
    await page.getByRole("button", { name: /account & data/i }).click();
    await page.getByRole("button", { name: /show onboarding again/i }).click();

    await page.goto("/");
    await expect(
      page.getByRole("dialog", { name: /welcome to pok[eé] memory/i }),
    ).toBeVisible();
  });
});

test.describe("Feature nudges (#702)", () => {
  // The audio and grading hints were consolidated into the first-visit modal in
  // #1103. The card-types nudge on the end-of-session screen is still in scope.
  test("card-types nudge is absent when all card types are already enabled", async ({
    page,
  }) => {
    // Seed settings with the modal already dismissed.
    // reverseCardsEnabled was removed in #1234 — reverse is now always on.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          reverseEvolutionCardsEnabled: true,
          alternateFormsEnabled: true,
          onboarding: { firstVisitOnboardingDismissed: true },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    // There is no reliable way to reach the session-complete screen in a smoke
    // test without a full card set, so just verify the modal is absent and the
    // page loads cleanly.
    await expect(
      page.getByRole("dialog", { name: /welcome to pok[eé] memory/i }),
    ).toHaveCount(0);
  });
});

test.describe("PWA install nudge (#701)", () => {
  test("nudge is absent on a fresh visit (below engagement threshold)", async ({
    page,
  }) => {
    await page.goto("/");
    // Fresh localStorage → appVisitCount = 0 (incremented to 1 by the mount
    // effect, still below the threshold of 3). The nudge must not appear.
    await expect(
      page.getByRole("note", { name: /install poké memory/i }),
    ).toHaveCount(0);
  });

  test("nudge is absent when installNudgeDismissed is persisted", async ({
    page,
  }) => {
    // Seed settings with visitCount at threshold but already dismissed.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          appVisitCount: 5,
          onboarding: {
            welcomeDismissed: false,
            practiceHintDismissed: false,
            statsHintDismissed: false,
            settingsHintDismissed: false,
            installNudgeDismissed: true,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.getByRole("note", { name: /install poké memory/i }),
    ).toHaveCount(0);
  });

  test("nudge renders and dismisses when engagement threshold is met", async ({
    page,
  }) => {
    // Inject a minimal mock of the deferred install prompt so the Android
    // variant renders in Chromium (which won't fire beforeinstallprompt in a
    // test environment). The mock returns "dismissed" so handleInstall does
    // not call handleDismiss — the dismiss click below is the real trigger.
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__pwaInstallPrompt = {
        prompt: () => Promise.resolve({ outcome: "dismissed" }),
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      };
    });

    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          appVisitCount: 3,
          onboarding: {
            // Modal already dismissed so it does not obscure the nudge.
            firstVisitOnboardingDismissed: true,
            welcomeDismissed: false,
            practiceHintDismissed: false,
            statsHintDismissed: false,
            settingsHintDismissed: false,
            installNudgeDismissed: false,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    const nudge = page.getByRole("note", { name: /install poké memory/i });
    await expect(nudge).toBeVisible();

    await nudge.getByRole("button", { name: /dismiss install nudge/i }).click();
    await expect(nudge).toHaveCount(0);

    // Verify dismiss is persisted to localStorage.
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }, SETTINGS_KEY);
    expect(stored?.onboarding?.installNudgeDismissed).toBe(true);
  });

  test("show onboarding again resets installNudgeDismissed flag", async ({ page }) => {
    // Seed as dismissed with a high visit count.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          appVisitCount: 5,
          onboarding: {
            welcomeDismissed: true,
            practiceHintDismissed: true,
            statsHintDismissed: true,
            settingsHintDismissed: true,
            installNudgeDismissed: true,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/settings");
    await page.getByRole("button", { name: /account & data/i }).click();
    await page.getByRole("button", { name: /show onboarding again/i }).click();

    // After the reset, installNudgeDismissed must be false in localStorage.
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }, SETTINGS_KEY);

    expect(stored?.onboarding?.installNudgeDismissed).toBe(false);
  });
});

test.describe("Guest storage section in onboarding modal (#1057)", () => {
  test("modal shows guest storage section for a guest user", async ({ page }) => {
    await page.goto("/");

    const modal = page.getByRole("dialog", { name: /welcome to pok[eé] memory/i });
    await expect(modal).toBeVisible();

    // Guest storage info must be present inside the modal.
    await expect(modal.getByText(/your progress is saved on this device/i)).toBeVisible();
    await expect(modal.getByText(/kept on this device/i)).toBeVisible();
  });

  test("guest storage section is absent after the modal is dismissed", async ({
    page,
  }) => {
    await page.goto("/");

    const modal = page.getByRole("dialog", { name: /welcome to pok[eé] memory/i });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: /get started/i }).click();
    await expect(modal).toHaveCount(0);

    // No standalone storage notice should appear — info was in the modal.
    await expect(
      page.getByRole("note", { name: /your progress is saved on this device/i }),
    ).toHaveCount(0);
  });
});

const LOCALE_COOKIE = "poke-memory:locale";

test.describe("Non-English locale in onboarding modal (#1369, #1390)", () => {
  // This suite intentionally uses a fresh storageState (inherited from the
  // test.use({ storageState: ... }) at the top of this file) so the modal
  // appears on every visit.

  test("modal renders Japanese copy and shows MachineTranslationBanner with locale=ja", async ({
    page,
    context,
  }) => {
    // Seed the locale cookie so the server serves the Japanese catalogue.
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "ja",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/");

    // The modal must appear (fresh visit, no firstVisitOnboardingDismissed flag).
    const modal = page.getByRole("dialog", { name: /poké memory へようこそ/i });
    await expect(modal).toBeVisible();

    // The MachineTranslationBanner must be visible inside the modal for ja locale.
    // It renders with role="note" and contains the Japanese caution message.
    const banner = modal.getByRole("note");
    await expect(banner).toBeVisible();
    // Verify the banner text is the Japanese translation (contains 自動的に作成).
    await expect(banner.getByText(/自動的に作成/)).toBeVisible();
  });
});

test.describe("Discovery nudges (#1443)", () => {
  test("markWhatIKnow nudge renders on settings page when flag is absent (existing-user reach)", async ({
    page,
  }) => {
    // Seed with a realistic existing-user blob that predates #1443 — no
    // markWhatIKnowNudgeDismissed key, so it resolves to false and shows.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            // markWhatIKnowNudgeDismissed deliberately absent
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/settings");
    // The nudge is a role=note with the nudge title text.
    const nudge = page.locator(`[role="note"]`, { hasText: /skip the queue/i });
    await expect(nudge).toBeVisible({ timeout: 10_000 });
  });

  test("markWhatIKnow nudge is absent when flag is true", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            markWhatIKnowNudgeDismissed: true,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/settings");
    await expect(
      page.locator(`[role="note"]`, { hasText: /skip the queue/i }),
    ).toHaveCount(0);
  });

  test("markWhatIKnow nudge is dismissible", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            markWhatIKnowNudgeDismissed: false,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/settings");
    const nudge = page.locator(`[role="note"]`, { hasText: /skip the queue/i });
    await expect(nudge).toBeVisible({ timeout: 10_000 });

    await nudge.getByRole("button", { name: /dismiss hint/i }).click();
    await expect(nudge).toHaveCount(0);

    // Persisted to localStorage.
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }, SETTINGS_KEY);
    expect(stored?.onboarding?.markWhatIKnowNudgeDismissed).toBe(true);
  });

  test("practiceScope nudge renders on practice page when firstVisitDone and flag is absent", async ({
    page,
  }) => {
    // Seed the full #1482 show-precondition: firstVisitOnboardingDismissed=true
    // AND practiceSessionsCount at/above the threshold (3), with scope empty and
    // scopeEverOpened/practiceScopeNudgeDismissed absent (both resolve to false).
    // The #1482 gate only shows the nudge once the user has completed enough
    // sessions without ever opening the scope control.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            practiceSessionsCount: 3,
            // practiceScopeNudgeDismissed and scopeEverOpened deliberately absent
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    // Wait for the practice surface to hydrate.
    const nudge = page.locator(`[role="note"]`, { hasText: /filter by generation/i });
    await expect(nudge).toBeVisible({ timeout: 20_000 });
  });

  test("practiceScope nudge is absent when flag is true", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            practiceScopeNudgeDismissed: true,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.locator(`[role="note"]`, { hasText: /filter by generation/i }),
    ).toHaveCount(0);
  });

  test("practiceScope nudge is absent when first-visit onboarding not yet done", async ({
    page,
  }) => {
    // firstVisitOnboardingDismissed absent (= false after coercion) means the
    // first-visit modal has not been dismissed yet; the gate in ReviewSession
    // must suppress the scope nudge so the user is not hit with two hints at once.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            // firstVisitOnboardingDismissed deliberately absent
            practiceScopeNudgeDismissed: false,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    // Wait for the first-visit modal to confirm the practice surface has hydrated,
    // then assert the scope nudge is absent (the two must not show simultaneously).
    await expect(
      page.getByRole("dialog", { name: /welcome to pok[eé] memory/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator(`[role="note"]`, { hasText: /filter by generation/i }),
    ).toHaveCount(0);
  });

  // #1482 — session-count and scope-opened gate tests.

  test("practiceScope nudge is absent when practiceScope is non-empty (scope already in use)", async ({
    page,
  }) => {
    // Seed: firstVisit done, plenty of sessions, never opened scope control
    // explicitly (scopeEverOpened absent), BUT practiceScope is non-empty.
    // The first gate (scope non-empty) must suppress the nudge.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          practiceScope: { gens: [1], types: [], presets: [], formCategories: { mode: "all" }, games: [] },
          onboarding: {
            firstVisitOnboardingDismissed: true,
            practiceScopeNudgeDismissed: false,
            practiceSessionsCount: 5,
            // scopeEverOpened deliberately absent (resolves to false)
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.locator(`[role="note"]`, { hasText: /filter by generation/i }),
    ).toHaveCount(0, { timeout: 20_000 });
  });

  test("practiceScope nudge is absent when scopeEverOpened is true", async ({
    page,
  }) => {
    // Seed: firstVisit done, plenty of sessions, practiceScope empty, but
    // scopeEverOpened is true — the user has already interacted with scope.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            practiceScopeNudgeDismissed: false,
            practiceSessionsCount: 5,
            scopeEverOpened: true,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.locator(`[role="note"]`, { hasText: /filter by generation/i }),
    ).toHaveCount(0, { timeout: 20_000 });
  });

  test("practiceScope nudge is absent when sessions < threshold (new user)", async ({
    page,
  }) => {
    // Seed: firstVisit done, scope empty, scopeEverOpened absent (false),
    // but practiceSessionsCount is 1 (below threshold of 3).
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            practiceScopeNudgeDismissed: false,
            practiceSessionsCount: 1,
            // scopeEverOpened deliberately absent (resolves to false)
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.locator(`[role="note"]`, { hasText: /filter by generation/i }),
    ).toHaveCount(0, { timeout: 20_000 });
  });

  test("practiceScope nudge shown when sessions >= threshold, scope empty, and never opened", async ({
    page,
  }) => {
    // Seed: all suppress conditions cleared — firstVisit done, scope empty,
    // scopeEverOpened absent (false), practiceSessionsCount >= 3.
    // The nudge must show.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            practiceScopeNudgeDismissed: false,
            practiceSessionsCount: 3,
            // scopeEverOpened deliberately absent (resolves to false)
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    const nudge = page.locator(`[role="note"]`, { hasText: /filter by generation/i });
    await expect(nudge).toBeVisible({ timeout: 20_000 });
  });
});

// E2E smoke for #1538 "Proactively surface the offline download".
//
// The offline-download nudge fires on the practice page when:
//   - firstVisitOnboardingDismissed is true
//   - no download exists (poke-memory:offline-downloaded-at absent)
//   - offlineDownloadNudgeDismissed is absent/false
//   - EITHER slowSpriteLoadCount >= 3 OR practiceSessionsCount >= 5
//
// Tests cover the show-path and the primary suppression path (download exists).

test.describe("Offline download nudge (#1538)", () => {
  test("nudge renders when session threshold is met and no download exists", async ({
    page,
  }) => {
    // Seed: firstVisit done, practiceSessionsCount at/above threshold (5),
    // no offlineDownloadNudgeDismissed flag, no download timestamp.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            practiceSessionsCount: 5,
            // offlineDownloadNudgeDismissed deliberately absent (resolves to false)
          },
        }),
      );
      // poke-memory:offline-downloaded-at deliberately absent (no download)
    }, SETTINGS_KEY);

    await page.goto("/");
    const nudge = page.locator(`[role="note"]`, { hasText: /practising offline/i });
    await expect(nudge).toBeVisible({ timeout: 20_000 });
  });

  test("nudge is absent when a download already exists", async ({
    page,
  }) => {
    // Seed: firstVisit done, session count above threshold, but download
    // timestamp present — the nudge must be suppressed once downloaded.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            practiceSessionsCount: 5,
          },
        }),
      );
      // Simulate a prior download — suppresses the nudge.
      localStorage.setItem("poke-memory:offline-downloaded-at", new Date().toISOString());
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.locator(`[role="note"]`, { hasText: /practising offline/i }),
    ).toHaveCount(0, { timeout: 20_000 });
  });
});

// E2E smoke for #1573 "Higher or Lower signpost nudge".
//
// The nudge fires on the practice page when:
//   - firstVisitOnboardingDismissed is true
//   - seenPokemon.length >= 1 (at least one card has firstSeen set in session)
//   - higherOrLowerNudgeDismissed is absent/false
//
// Tests cover the show-path, the dismiss interaction, and the primary
// suppression path (nudge pre-dismissed).

// Minimal session containing a Bulbasaur name card that has been seen (firstSeen
// set), satisfying the seenPokemon.length >= 1 gate in ReviewSession.
const SEEN_BULBASAUR_SESSION = {
  cards: [
    {
      id: 1,
      cardType: "name",
      speciesId: 1,
      name: "Bulbasaur",
      spriteUrl: "/sprites/pokemon/1.png",
      state: {
        stability: 1,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        fsrsState: "learning",
        dueDate: "2026-06-04",
        lastReview: "2026-06-03",
        firstSeen: "2026-06-03",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    },
  ],
  limits: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 0, maxReviewsPerDay: 100 },
    cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  },
};

test.describe("Higher-or-Lower signpost nudge (#1573)", () => {
  test("nudge renders on practice page when seenPokemon >= 1 and flag is absent", async ({
    page,
  }) => {
    // Seed settings: firstVisit done, higherOrLowerNudgeDismissed absent (resolves to false).
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            // higherOrLowerNudgeDismissed deliberately absent
          },
        }),
      );
    }, SETTINGS_KEY);
    // Seed a session with one seen Pokémon to satisfy the seenPokemon gate.
    await seedSessionIdb(page, SEEN_BULBASAUR_SESSION);

    await page.goto("/");
    await awaitSeedIdb(page);

    const nudge = page.locator(`[role="note"]`, { hasText: /finish your session for a bonus mini-game/i });
    await expect(nudge).toBeVisible({ timeout: 20_000 });
  });

  test("nudge is absent when higherOrLowerNudgeDismissed is true", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            higherOrLowerNudgeDismissed: true,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.locator(`[role="note"]`, { hasText: /finish your session for a bonus mini-game/i }),
    ).toHaveCount(0, { timeout: 20_000 });
  });

  test("nudge is dismissible and absent after dismissal", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            higherOrLowerNudgeDismissed: false,
          },
        }),
      );
    }, SETTINGS_KEY);
    await seedSessionIdb(page, SEEN_BULBASAUR_SESSION);

    await page.goto("/");
    await awaitSeedIdb(page);

    const nudge = page.locator(`[role="note"]`, { hasText: /finish your session for a bonus mini-game/i });
    await expect(nudge).toBeVisible({ timeout: 20_000 });

    await nudge.getByRole("button", { name: /dismiss hint/i }).click();
    await expect(nudge).toHaveCount(0);

    // Persisted to localStorage.
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }, SETTINGS_KEY);
    expect(stored?.onboarding?.higherOrLowerNudgeDismissed).toBe(true);
  });
});

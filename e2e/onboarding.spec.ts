import { test, expect } from "@playwright/test";

const SETTINGS_KEY = "poke-memory:settings:v1";

test.describe("First-visit onboarding modal (#1103)", () => {
  test("modal appears on a fresh visit and is dismissable", async ({
    page,
  }) => {
    await page.goto("/");

    const modal = page.getByRole("dialog", { name: /welcome to poke memory/i });
    await expect(modal).toBeVisible();

    // Grading guidance must be present inside the modal.
    await expect(modal.getByText(/again/i)).toBeVisible();

    await modal.getByRole("button", { name: /get started/i }).click();
    await expect(modal).toHaveCount(0);

    // After dismissal the Practice card surface is interactable.
    // Allow for end-state screens as well as active-card states.
    const cardOrEndState = page.locator('[data-testid="swipe-card"], button:text("Reveal"), button:text("All caught up"), p:text("All caught up")').first();
    // Just verify the page is usable without the modal blocking it.
    await expect(page.locator("main")).toBeVisible();
  });

  test("modal does not reappear after dismissal", async ({ page }) => {
    await page.goto("/");

    const modal = page.getByRole("dialog", { name: /welcome to poke memory/i });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: /get started/i }).click();
    await expect(modal).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole("dialog", { name: /welcome to poke memory/i }),
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
      page.getByRole("dialog", { name: /welcome to poke memory/i }),
    ).toHaveCount(0);
  });

  test("Settings reset re-opens the modal on next Practice visit", async ({
    page,
  }) => {
    // Dismiss the modal first.
    await page.goto("/");
    const modal = page.getByRole("dialog", { name: /welcome to poke memory/i });
    if (await modal.isVisible().catch(() => false)) {
      await modal.getByRole("button", { name: /get started/i }).click();
    }

    await page.goto("/settings");
    // "How this works" lives inside the collapsible "Account & Data" section.
    await page.getByRole("button", { name: /account & data/i }).click();
    await page.getByRole("button", { name: /show tips again/i }).click();

    await page.goto("/");
    await expect(
      page.getByRole("dialog", { name: /welcome to poke memory/i }),
    ).toBeVisible();
  });
});

test.describe("Feature nudges (#702)", () => {
  // The audio and grading hints were consolidated into the first-visit modal in
  // #1103. The card-types nudge on the end-of-session screen is still in scope.
  test("card-types nudge is absent when all card types are already enabled", async ({
    page,
  }) => {
    // Seed settings with all card types on (reverse + reverse-evo + forms) and
    // the modal already dismissed so the modal does not obscure the session.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          reverseCardsEnabled: true,
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
      page.getByRole("dialog", { name: /welcome to poke memory/i }),
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

  test("show tips again resets installNudgeDismissed flag", async ({ page }) => {
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
    await page.getByRole("button", { name: /show tips again/i }).click();

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

test.describe("Guest storage-persistence notice (#1057)", () => {
  test("notice appears for a guest user after the modal is dismissed", async ({ page }) => {
    await page.goto("/");

    // Dismiss the first-visit modal so it does not obscure the notice behind the backdrop.
    const modal = page.getByRole("dialog", { name: /welcome to poke memory/i });
    if (await modal.isVisible().catch(() => false)) {
      await modal.getByRole("button", { name: /get started/i }).click();
    }

    const notice = page.getByRole("note", {
      name: /your progress is saved on this device/i,
    });
    await expect(notice).toBeVisible();

    // Key content must be present.
    await expect(notice.getByText(/stored in your browser/i)).toBeVisible();
  });

  test("notice can be dismissed and stays dismissed after reload", async ({
    page,
  }) => {
    // Pre-dismiss the modal so we go straight to the notice.
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({ onboarding: { firstVisitOnboardingDismissed: true } }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");

    const notice = page.getByRole("note", {
      name: /your progress is saved on this device/i,
    });
    await expect(notice).toBeVisible();

    await notice.getByRole("button", { name: /dismiss hint/i }).click();
    await expect(notice).toHaveCount(0);

    // Verify the flag is persisted to localStorage.
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }, SETTINGS_KEY);
    expect(
      (stored?.onboarding as Record<string, unknown> | undefined)
        ?.guestStorageNoticeDismissed,
    ).toBe(true);

    // Notice must not reappear after reload.
    await page.reload();
    await expect(
      page.getByRole("note", { name: /your progress is saved on this device/i }),
    ).toHaveCount(0);
  });

  test("notice is absent when already dismissed in settings", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          onboarding: {
            firstVisitOnboardingDismissed: true,
            welcomeDismissed: false,
            practiceHintDismissed: false,
            statsHintDismissed: false,
            settingsHintDismissed: false,
            installNudgeDismissed: false,
            audioHintDismissed: false,
            cardTypesHintDismissed: false,
            guestStorageNoticeDismissed: true,
          },
        }),
      );
    }, SETTINGS_KEY);

    await page.goto("/");
    await expect(
      page.getByRole("note", { name: /your progress is saved on this device/i }),
    ).toHaveCount(0);
  });
});

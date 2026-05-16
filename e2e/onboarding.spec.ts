import { test, expect } from "@playwright/test";

const SETTINGS_KEY = "poke-memory:settings:v1";

test.describe("Onboarding (#433)", () => {
  test("welcome callout appears on a fresh visit and stays dismissed", async ({
    page,
  }) => {
    await page.goto("/");

    const welcome = page.getByRole("note", { name: /welcome to poké memory/i });
    await expect(welcome).toBeVisible();

    await welcome.getByRole("button", { name: /dismiss hint/i }).click();
    await expect(welcome).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole("note", { name: /welcome to poké memory/i }),
    ).toHaveCount(0);
  });

  test("settings explainer + reset onboarding restores the hints", async ({
    page,
  }) => {
    // Dismiss the home welcome callout first so the reset has something to undo.
    await page.goto("/");
    const welcome = page.getByRole("note", { name: /welcome to poké memory/i });
    if (await welcome.isVisible().catch(() => false)) {
      await welcome.getByRole("button", { name: /dismiss hint/i }).click();
    }

    await page.goto("/settings");
    // "How this works" now lives inside the collapsible "Account & Data" section.
    // Expand the section first, then interact with the reset button.
    await page.getByRole("button", { name: /account & data/i }).click();

    await page.getByRole("button", { name: /show tips again/i }).click();

    await page.goto("/");
    await expect(
      page.getByRole("note", { name: /welcome to poké memory/i }),
    ).toBeVisible();
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

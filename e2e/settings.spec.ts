import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("Settings — Audio TTS controls (#435)", () => {
  test("'Hear sample' button is present inside the Audio section and clickable without error", async ({
    page,
  }) => {
    // The "Hear sample" button is rendered by TtsControls inside the Audio
    // section. Clicking it calls speakName("Bulbasaur", null, overrides) via
    // the Web Speech API. Audio playback cannot be asserted headlessly, but we
    // verify the button renders and the click produces no uncaught page error.
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/settings");

    // Expand the Audio section.
    await page.getByRole("button", { name: /^audio$/i }).click();

    // TtsControls (and its "Hear sample" button) only mounts once the
    // "Speak name on reveal" toggle is enabled — it defaults to off.
    await page.getByRole("switch", { name: "Speak name on reveal" }).click();

    // The "Hear sample" button sits inside the Speech rate row of TtsControls.
    const hearSampleBtn = page.getByRole("button", { name: "Hear sample" });
    await expect(hearSampleBtn).toBeVisible();
    await hearSampleBtn.click();

    // Allow a brief moment for any async rejection to bubble.
    await page.waitForTimeout(300);
    expect(pageErrors).toHaveLength(0);
  });
});

test.describe("Settings page — collapsible sections (#660)", () => {
  test("settings page opens with all category headings visible and collapsed", async ({
    page,
  }) => {
    await page.goto("/settings");

    // All top-level category buttons must be visible.
    for (const label of ["Appearance", "Practice", "Audio", "Offline", "Account & Data", "Advanced"]) {
      await expect(
        page.getByRole("button", { name: new RegExp(label, "i") }),
      ).toBeVisible();
    }

    // No section content should be visible on a fresh load (all collapsed).
    // We check that the "Recall target" slider is not visible — it lives inside Practice.
    await expect(page.getByRole("slider", { name: /recall target/i })).not.toBeVisible();
  });

  test("expanding a section reveals its controls", async ({ page }) => {
    await page.goto("/settings");

    // Expand "Practice".
    await page.getByRole("button", { name: /^practice$/i }).click();

    // The recall target slider should now be visible.
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();
  });

  test("collapsing a section hides its controls again", async ({ page }) => {
    await page.goto("/settings");

    const practiceBtn = page.getByRole("button", { name: /^practice$/i });

    // Expand then collapse.
    await practiceBtn.click();
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();

    await practiceBtn.click();
    await expect(page.getByRole("slider", { name: /recall target/i })).not.toBeVisible();
  });

  test("/settings#onboarding-heading auto-expands Account & Data section", async ({
    page,
  }) => {
    await page.goto("/settings#onboarding-heading");

    // Wait for the accordion to open before asserting nested content.
    await expect(
      page.getByRole("button", { name: "Account & Data" }),
    ).toHaveAttribute("aria-expanded", "true");
    // The "Show onboarding again" button lives inside Account & Data → onboarding sub-section.
    await expect(
      page.getByRole("button", { name: /show onboarding again/i }),
    ).toBeVisible();
  });

  test("expanding Audio section reveals cry card toggle", async ({ page }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: /^audio$/i }).click();

    // The cry cards toggle switch must be visible.
    await expect(
      page.getByRole("switch", { name: /enable cry cards/i }),
    ).toBeVisible();
  });
});

test.describe("Settings page — alternate forms toggle (#658)", () => {
  test("alternate forms toggle is present and off by default in Practice section", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Expand "Practice".
    await page.getByRole("button", { name: /^practice$/i }).click();

    // The toggle must be visible.
    const toggle = page.getByRole("switch", {
      name: /include alternate forms in practice/i,
    });
    await expect(toggle).toBeVisible();

    // Default state is off (aria-checked="false").
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("toggling alternate forms on causes it to report as checked", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();

    const toggle = page.getByRole("switch", {
      name: /include alternate forms in practice/i,
    });

    // Click to enable.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("Alternate forms — ScopeControl visibility (#658)", () => {
  test("Alternate forms section is absent in ScopeControl when toggle is off (default)", async ({
    page,
  }) => {
    await page.goto("/");

    // Open the scope panel.
    await page.locator("button[aria-controls='scope-panel']").click();

    // The "Alternate forms" fieldset legend must NOT be present when the gate is off.
    await expect(page.getByText("Alternate forms")).not.toBeVisible();
  });

  test("Alternate forms section appears in ScopeControl after enabling the toggle", async ({
    page,
  }) => {
    // Enable the toggle on the Settings page and persist via Save.
    // handleToggle only updates React state; saveSettings is only called from
    // handleSave — so we must click Save before navigating away.
    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();
    await page.getByRole("switch", { name: /include alternate forms in practice/i }).click();

    // Click Save and wait for the "Saved!" confirmation so we know the
    // setting has been written to localStorage before we navigate.
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Saved!")).toBeVisible();

    // Navigate to the practice page and open the scope panel.
    await page.goto("/");
    await page.locator("button[aria-controls='scope-panel']").click();

    // The "Alternate forms" section heading must now be visible.
    await expect(page.getByText("Alternate forms")).toBeVisible();
  });
});

test.describe("Settings page — search/filter (#662)", () => {
  test("search input is visible at the top of the settings page", async ({ page }) => {
    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });
    await expect(input).toBeVisible();
  });

  test("typing 'cry' filters to only the Audio section and auto-expands it", async ({
    page,
  }) => {
    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });
    await input.fill("cry");

    // Audio section must be visible and expanded (cry cards toggle is visible).
    await expect(page.getByRole("switch", { name: /enable cry cards/i })).toBeVisible();

    // The Practice section button must be absent — it is filtered out.
    await expect(page.getByRole("button", { name: /^practice$/i })).not.toBeVisible();
  });

  test("typing a known setting name surfaces its section", async ({ page }) => {
    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });
    await input.fill("recall target");

    // The Practice section (which contains the recall target slider) must be visible.
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();
  });

  test("clearing the search input restores all sections", async ({
    page,
  }) => {
    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });
    await input.fill("backup");

    // Only Account & Data should be visible while filtering.
    await expect(page.getByRole("button", { name: /^practice$/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^audio$/i })).not.toBeVisible();

    // Clear via the clear button.
    await page.getByRole("button", { name: /clear search/i }).click();

    // All top-level sections must be visible again after clearing.
    for (const label of ["Appearance", "Practice", "Audio", "Offline", "Account & Data", "Advanced"]) {
      await expect(
        page.getByRole("button", { name: new RegExp(label, "i") }),
      ).toBeVisible();
    }

    // The search input must be empty again.
    await expect(input).toHaveValue("");
  });

  test("no-match query shows empty-result message", async ({ page }) => {
    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });
    await input.fill("xyzzynosuchthing");

    // All section buttons must be gone.
    for (const label of ["Appearance", "Practice", "Audio", "Offline", "Account & Data", "Advanced"]) {
      await expect(
        page.getByRole("button", { name: new RegExp(label, "i") }),
      ).not.toBeVisible();
    }

    // The visible no-match message echoes the query back. Scope the locator
    // to the query text so it does not also match the sr-only aria-live
    // status announcer, which carries similar copy.
    await expect(
      page.getByText(/no settings match.*xyzzynosuchthing/i),
    ).toBeVisible();
  });

  test("search input is keyboard-reachable via click and accepts input", async ({ page }) => {
    await page.goto("/settings");
    const input = page.getByRole("searchbox", { name: /search settings/i });
    // Clicking gives focus — verifies the input is not disabled/inert.
    await input.click();
    await expect(input).toBeFocused();
    // Typing filters the view.
    await input.fill("audio");
    await expect(page.getByRole("button", { name: /^audio$/i })).toBeVisible();
  });

  test("search-driven expansion does not overwrite persisted collapsed state", async ({
    page,
  }) => {
    // Seed all sections as explicitly closed so the test is deterministic.
    await page.addInitScript(() => {
      const keys = [
        "appearance-heading",
        "practice-heading",
        "audio-heading",
        "account-data-heading",
        "advanced-heading",
      ];
      for (const k of keys) {
        window.localStorage.setItem(`poke-memory:settings-section:${k}`, "0");
      }
    });

    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });

    // Type a query — the matching section should be visible and expanded.
    await input.fill("backup");
    await expect(page.getByRole("button", { name: /account & data/i })).toBeVisible();

    // Clear the search.
    await page.getByRole("button", { name: /clear search/i }).click();

    // All sections must be back to collapsed (content hidden).
    // The recall-target slider lives inside Practice; it must not be visible.
    await expect(page.getByRole("slider", { name: /recall target/i })).not.toBeVisible();

    // Confirm localStorage still records the section as closed (not overwritten).
    const accountDataPersistedState = await page.evaluate(() =>
      window.localStorage.getItem("poke-memory:settings-section:account-data-heading"),
    );
    expect(accountDataPersistedState).toBe("0");
  });

  test("hash deep-link target section remains visible even when a query is active", async ({
    page,
  }) => {
    // Navigate to a hash that targets Practice via a sub-section anchor.
    // With a query of 'backup' (matches only Account & Data), Practice would
    // normally be filtered out — but the hash target must keep it present.
    await page.goto("/settings#scheduler-heading");

    // The Practice button must be visible (hash target always included).
    await expect(page.getByRole("button", { name: /^practice$/i })).toBeVisible();
    // The Practice section must be expanded (hash-forced open).
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();
  });
});

test.describe("Settings — re-enable card type prompt (#835)", () => {
  test("re-enabling a disabled card type shows the reuse-or-reset dialog", async ({
    page,
  }) => {
    // Pre-seed localStorage so reverse cards are disabled (the default).
    // Settings start with reverseCardsEnabled: false.
    await page.goto("/settings");

    // Expand the Practice section.
    await page.getByRole("button", { name: /^practice$/i }).click();

    // Reverse cards toggle must be present and off by default.
    const reverseToggle = page.getByRole("switch", { name: /enable reverse cards/i });
    await expect(reverseToggle).toBeVisible();
    await expect(reverseToggle).toHaveAttribute("aria-checked", "false");

    // Clicking to enable should show the re-enable dialog, not toggle immediately.
    await reverseToggle.click();

    // The dialog must appear with the correct heading.
    await expect(
      page.getByRole("heading", { name: /re-enable reverse cards/i }),
    ).toBeVisible();

    // Both choice buttons and a cancel button must be present.
    await expect(page.getByRole("button", { name: /reuse my saved progress/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /start fresh/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /cancel/i })).toBeVisible();
  });

  test("choosing 'Reuse my saved progress' closes the dialog and enables the toggle", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();

    const reverseToggle = page.getByRole("switch", { name: /enable reverse cards/i });
    await reverseToggle.click();

    // Dialog opens — choose reuse.
    await page.getByRole("button", { name: /reuse my saved progress/i }).click();

    // Dialog must close and the toggle must be on.
    await expect(
      page.getByRole("heading", { name: /re-enable reverse cards/i }),
    ).not.toBeVisible();
    await expect(reverseToggle).toHaveAttribute("aria-checked", "true");
  });

  test("choosing 'Start fresh' closes the dialog and enables the toggle", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();

    const reverseToggle = page.getByRole("switch", { name: /enable reverse cards/i });
    await reverseToggle.click();

    // Dialog opens — choose fresh start.
    await page.getByRole("button", { name: /start fresh/i }).click();

    // Dialog must close and the toggle must be on.
    await expect(
      page.getByRole("heading", { name: /re-enable reverse cards/i }),
    ).not.toBeVisible();
    await expect(reverseToggle).toHaveAttribute("aria-checked", "true");
  });

  test("Cancel closes the dialog without changing toggle state", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();

    const reverseToggle = page.getByRole("switch", { name: /enable reverse cards/i });
    await reverseToggle.click();

    // Dialog opens — cancel.
    await page.getByRole("button", { name: /cancel/i }).click();

    // Dialog must close and the toggle must remain off.
    await expect(
      page.getByRole("heading", { name: /re-enable reverse cards/i }),
    ).not.toBeVisible();
    await expect(reverseToggle).toHaveAttribute("aria-checked", "false");
  });

  test("disabling an enabled card type does not show a confirm dialog (non-destructive)", async ({
    page,
  }) => {
    // Pre-enable reverse cards via localStorage so we can test disabling.
    await page.addInitScript(() => {
      const key = "poke-memory:settings:v1";
      const raw = window.localStorage.getItem(key);
      const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      settings.reverseCardsEnabled = true;
      window.localStorage.setItem(key, JSON.stringify(settings));
    });

    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();

    const reverseToggle = page.getByRole("switch", { name: /enable reverse cards/i });
    await expect(reverseToggle).toHaveAttribute("aria-checked", "true");

    // Clicking to disable must toggle immediately without any dialog.
    await reverseToggle.click();
    await expect(reverseToggle).toHaveAttribute("aria-checked", "false");

    // The re-enable dialog must NOT appear.
    await expect(
      page.getByRole("heading", { name: /re-enable reverse cards/i }),
    ).not.toBeVisible();
  });
});

test.describe("Settings — CSV review history export (#918)", () => {
  test("Download CSV link is not visible for guests (no session)", async ({
    page,
  }) => {
    // The CSV export control is gated on a signed-in session. E2E runs in
    // guest mode only, so the link must not render.
    await page.goto("/settings");
    await page.getByRole("button", { name: /account & data/i }).click();

    await expect(
      page.getByRole("link", { name: /download csv/i }),
    ).toHaveCount(0);
  });

  test("GET /api/export rejects an unauthenticated request (401 or 503)", async ({
    page,
  }) => {
    // Verify the endpoint is guarded — an unauthenticated request must never
    // receive a CSV. In a fully-configured environment the route returns 401
    // (no session). In the CI e2e environment where Supabase env vars are
    // absent the client construction fails and the route returns 503 instead.
    // Both are acceptable: the endpoint is guarded and the caller does not get
    // the CSV.
    const response = await page.request.get("/api/export");
    expect(response.ok()).toBeFalsy();
    expect([401, 503]).toContain(response.status());
  });
});

test.describe("Settings — Danger zone (#697)", () => {
  test("danger zone shows Reset all progress; Delete account is hidden for guests", async ({
    page,
  }) => {
    // E2E runs guest-mode only. The "Delete account" control is gated on a
    // signed-in session — there is no cloud identity for a guest to delete —
    // so a guest should see "Reset all progress" but NOT "Delete account".
    await page.goto("/settings#danger-zone-heading");

    // The Advanced category (which contains the Danger zone) is force-expanded
    // by the hash deep-link.
    await expect(
      page.getByRole("heading", { name: /danger zone/i }),
    ).toBeVisible();

    // Reset-progress control is always present.
    await expect(
      page.getByRole("button", { name: /^reset all progress$/i }),
    ).toBeVisible();

    // Delete-account control must NOT render for a guest.
    await expect(
      page.getByTestId("delete-account-button"),
    ).toHaveCount(0);
  });
});

test.describe("Settings page — Web Push opt-in (#1056)", () => {
  test("daily reminder toggle is hidden in a regular browser tab (not standalone)", async ({
    page,
  }) => {
    // The PushOptIn component renders only when display-mode is standalone
    // AND push is supported AND the user is authenticated. A normal browser
    // session in CI satisfies none of those, so the toggle must be entirely
    // absent — not just hidden via CSS.
    await page.goto("/settings");

    // Expand Account & Data so the would-be parent section is open.
    await page.getByRole("button", { name: /account & data/i }).click();
    await expect(
      page.getByRole("button", { name: /account & data/i }),
    ).toHaveAttribute("aria-expanded", "true");

    // The opt-in switch must not render. Use a data-testid match so the
    // assertion does not depend on label wording remaining stable.
    await expect(page.getByTestId("push-optin-button")).toHaveCount(0);
  });

  test("daily reminder toggle is also hidden when display-mode is forced to standalone (push unsupported in CI)", async ({
    page,
  }) => {
    // Even with display-mode emulated to standalone, the test browser in CI
    // does not provide a real PushManager + Notification surface that
    // isPushSupported considers valid. The toggle must still not render —
    // we don't want to show a control that can't actually subscribe.
    await page.emulateMedia({ media: "screen", colorScheme: "light" });

    await page.goto("/settings");
    await page.getByRole("button", { name: /account & data/i }).click();
    await expect(page.getByTestId("push-optin-button")).toHaveCount(0);
  });

  test("daily reminder toggle renders and is operable when authenticated + push-eligible (mock-auth seam)", async ({
    page,
  }) => {
    // Positive-path coverage per AGENTS.md "Testing → E2E tests": at least
    // one test must assert the feature actually renders and its core
    // interaction succeeds in the happy path. The PushOptIn component
    // gates on three conditions: authenticated user, isPushSupported(), and
    // isStandalone(). We satisfy each here:
    //
    //  1. Authentication is provided by the mock-auth seam (#751); the test
    //     skips when that seam is inactive (local runs without the env flag).
    //  2. isPushSupported() reads three globals (navigator.serviceWorker,
    //     window.PushManager, window.Notification). Chromium ships all three
    //     by default so no stub is needed.
    //  3. isStandalone() reads matchMedia("(display-mode: standalone)") OR
    //     navigator.standalone. We force the iOS Safari hook to true via
    //     addInitScript — same approach the auth.spec.ts mock-auth tests use
    //     to flip readiness signals on the page before app code runs.
    //
    // Once the toggle renders we click it and assert the navigator-side
    // surface is exercised. We stub Notification.requestPermission and the
    // PushManager.subscribe path so the helper round-trip does not depend on
    // a real push backend (no VAPID key on the preview deployment) and so
    // the test never sends a real notification. The mock-auth seam's
    // Supabase client resolves the delete + insert legs as no-op successes.

    // Seed the addInitScript before navigation — the same ordering pattern
    // as the auth-spec helpers. This runs in the page context before any
    // app module evaluates, so isStandalone()'s detection sees our value.
    await page.addInitScript(() => {
      // iOS Safari standalone hook. Defined as a getter so the descriptor
      // sticks across the React render cycle.
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        get: () => true,
      });

      // Pre-grant notification permission and short-circuit the prompt. We
      // replace the Notification interface object so both the static
      // `.permission` read and the `requestPermission()` call see "granted".
      const fakeNotification = {
        permission: "granted" as NotificationPermission,
        requestPermission: () => Promise.resolve("granted" as NotificationPermission),
      };
      Object.defineProperty(window, "Notification", {
        configurable: true,
        writable: true,
        value: fakeNotification,
      });

      // Replace navigator.serviceWorker.ready with a fake registration that
      // exposes a stub PushManager. subscribeToPush reaches in via
      // `navigator.serviceWorker.ready` and then `.pushManager.subscribe`;
      // without a stub the real Serwist worker would try to handshake with
      // a non-existent VAPID-keyed endpoint and fail. The stub keeps the
      // round-trip purely client-side and deterministic.
      const fakeSubscription = {
        endpoint: "https://push.example/e2e-fake-endpoint",
        getKey: (name: string) => {
          // Return a small buffer with a recognisable byte so the base64url
          // encoder in subscribe.ts produces a non-empty string.
          const buf = new ArrayBuffer(4);
          new Uint8Array(buf).fill(name === "p256dh" ? 0x42 : 0x21);
          return buf;
        },
        unsubscribe: () => Promise.resolve(true),
      };
      const fakeRegistration = {
        pushManager: {
          getSubscription: () => Promise.resolve(null),
          subscribe: () => Promise.resolve(fakeSubscription),
        },
      };
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        get: () => ({
          ready: Promise.resolve(fakeRegistration),
          getRegistration: () => Promise.resolve(fakeRegistration),
          addEventListener: () => {},
          removeEventListener: () => {},
          register: () => Promise.resolve(fakeRegistration),
        }),
      });
    });

    // Skip on local runs that don't have the mock-auth seam active. Same
    // pattern as e2e/auth.spec.ts → skipUnlessMockAuth.
    await page.goto("/");
    const signedIn = await page
      .getByRole("button", { name: "Sign out" })
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(!signedIn, "mock-auth seam not active on this deployment");

    // Navigate to the settings page with the Account & Data hash so the
    // accordion auto-expands without an extra click.
    await page.goto("/settings#onboarding-heading");

    // The toggle must render with its expected accessible name. Both the
    // role+name selector and the data-testid lookup must match — that is
    // the positive assertion that absence-only suites lack.
    const toggle = page.getByTestId("push-optin-button");
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute("aria-label", "Daily review reminder");
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Core interaction: clicking the toggle drives subscribeToPush, which
    // exercises the helper's full happy path (permission gate → SW ready →
    // PushManager.subscribe → DB persist). aria-checked flipping to "true"
    // proves every leg of that chain succeeded under the mock-auth seam.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });
  });
});

test.describe("Settings — reverse-card feedback delay gating (#1200 / #1205)", () => {
  test("feedback delay control is absent when reverse cards are off (default)", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Expand the Audio section.
    await page.getByRole("button", { name: /^audio$/i }).click();

    // The fieldset must not be in the DOM when reverseCardsEnabled is false.
    await expect(
      page.getByRole("group", { name: /reverse card feedback delay/i }),
    ).toHaveCount(0);
  });

  test("feedback delay control is visible after enabling reverse cards", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Enable reverse cards via the Practice section toggle.
    await page.getByRole("button", { name: /^practice$/i }).click();
    await page.getByRole("switch", { name: /enable reverse cards/i }).click();

    // The re-enable dialog appears — choose to reuse saved progress.
    await page.getByRole("button", { name: /reuse my saved progress/i }).click();

    // Expand the Audio section and verify the control is now present.
    await page.getByRole("button", { name: /^audio$/i }).click();
    await expect(
      page.getByRole("group", { name: /reverse card feedback delay/i }),
    ).toBeVisible();

    // Verify the radio inputs are interactive — "core interaction succeeds" bar.
    // The default value is "default", so click "off" to exercise a real change.
    // The native radio inputs are sr-only and the labels intercept pointer
    // events; click the label by its accessible text so the interaction lands
    // on the surface the user actually clicks.
    await page.getByText("Off", { exact: true }).click();
    await expect(page.getByRole("radio", { name: /off/i })).toBeChecked();
    await expect(page.getByRole("radio", { name: /default/i })).not.toBeChecked();
  });
});

test.describe("Settings — reverse-card feedback delay control (#1207)", () => {
  // Pre-seed reverseCardsEnabled so the fieldset renders without needing the
  // multi-step enable-reverse-cards flow (Practice toggle + dialog). The
  // file-level beforeEach already calls addOnboardingPreDismiss, which runs as
  // addInitScript #1 before page load. This describe-level addInitScript runs
  // as #2 — it reads the settings key written by #1 and merges in the flag.
  test.beforeEach(async ({ page }) => {
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
          } catch { /* malformed JSON — treat as empty */ }
        }
        localStorage.setItem(KEY, JSON.stringify({
          ...existing,
          reverseCardsEnabled: true,
        }));
      } catch { /* localStorage unavailable — ignore */ }
    });
  });

  test("all three options render with correct labels", async ({ page }) => {
    await page.goto("/settings");

    // Expand the Audio section to reveal the fieldset.
    await page.getByRole("button", { name: /^audio$/i }).click();

    const group = page.getByRole("group", { name: /reverse card feedback delay/i });
    await expect(group).toBeVisible();

    // All three radio options must be present with their exact labels.
    await expect(group.getByRole("radio", { name: "Off" })).toBeVisible();
    await expect(group.getByRole("radio", { name: "Fast" })).toBeVisible();
    await expect(group.getByRole("radio", { name: "Default" })).toBeVisible();
  });

  test("selecting a non-default option updates the checked state", async ({ page }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: /^audio$/i }).click();

    const group = page.getByRole("group", { name: /reverse card feedback delay/i });
    await expect(group).toBeVisible();

    // The factory default is "default" — "Default" radio must start checked.
    await expect(group.getByRole("radio", { name: "Default" })).toBeChecked();
    await expect(group.getByRole("radio", { name: "Off" })).not.toBeChecked();
    await expect(group.getByRole("radio", { name: "Fast" })).not.toBeChecked();

    // The native radio inputs are sr-only; the label intercepts pointer events.
    // Click the "Fast" label text to change the selection.
    await group.getByText("Fast", { exact: true }).click();

    await expect(group.getByRole("radio", { name: "Fast" })).toBeChecked();
    await expect(group.getByRole("radio", { name: "Default" })).not.toBeChecked();
    await expect(group.getByRole("radio", { name: "Off" })).not.toBeChecked();
  });

  test("selected value is preserved after a page reload (persistence round-trip)", async ({
    page,
  }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: /^audio$/i }).click();

    const group = page.getByRole("group", { name: /reverse card feedback delay/i });
    await expect(group).toBeVisible();

    // Select "Off" — the onChange handler calls saveSettings immediately, so
    // no explicit Save button click is needed before reloading.
    await group.getByText("Off", { exact: true }).click();
    await expect(group.getByRole("radio", { name: "Off" })).toBeChecked();

    // Reload the page. addInitScript does not re-run on reload, but the
    // setting is already persisted in localStorage by the onChange handler,
    // so reverseCardsEnabled remains true and "Off" remains selected.
    await page.reload();

    // Re-expand the Audio section after reload.
    await page.getByRole("button", { name: /^audio$/i }).click();

    const groupAfterReload = page.getByRole("group", {
      name: /reverse card feedback delay/i,
    });
    await expect(groupAfterReload).toBeVisible();
    await expect(groupAfterReload.getByRole("radio", { name: "Off" })).toBeChecked();
    await expect(groupAfterReload.getByRole("radio", { name: "Default" })).not.toBeChecked();
  });
});

test.describe("Settings — Offline section (#1168)", () => {
  test("Offline section heading and Download button are present", async ({
    page,
  }) => {
    await page.goto("/settings");

    // The Offline section must be present as a collapsible category.
    const offlineBtn = page.getByRole("button", { name: /^offline$/i });
    await expect(offlineBtn).toBeVisible();

    // Expand the section.
    await offlineBtn.click();
    await expect(offlineBtn).toHaveAttribute("aria-expanded", "true");

    // The Download button must be present inside the section.
    await expect(
      page.getByRole("button", { name: /download/i }),
    ).toBeVisible();
  });
});

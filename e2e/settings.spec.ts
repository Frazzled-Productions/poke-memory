import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("Settings - Audio TTS controls (#435)", () => {
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
    // "Speak name on reveal" toggle is enabled - it defaults to off.
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

test.describe("Settings page - collapsible sections (#660)", () => {
  test("settings page opens with all category headings visible and collapsed", async ({
    page,
  }) => {
    await page.goto("/settings");

    // All top-level category buttons must be visible.
    // Use exact-word anchors to avoid ambiguity with the Pokémon name language
    // pill button (which contains "language" in its accessible name).
    for (const label of [
      "Practice schedule",
      "Card types",
      "Audio",
      "Language",
      "Appearance",
      "Offline",
      "Regional & reminders",
      "Data & backup",
      "About",
      "Advanced",
    ]) {
      await expect(
        page.getByRole("button", { name: new RegExp("^" + label + "$", "i") }),
      ).toBeVisible();
    }

    // No section content should be visible on a fresh load (all collapsed).
    // Card types is default-open on the first visit but once dismissed stays closed.
    // We check that the "Recall target" slider is not visible - it lives inside Practice schedule.
    await expect(page.getByRole("slider", { name: /recall target/i })).not.toBeVisible();
  });

  test("expanding a section reveals its controls", async ({ page }) => {
    await page.goto("/settings");

    // Expand "Practice schedule".
    await page.getByRole("button", { name: /^practice schedule$/i }).click();

    // The recall target slider should now be visible.
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();
  });

  test("collapsing a section hides its controls again", async ({ page }) => {
    await page.goto("/settings");

    const practiceBtn = page.getByRole("button", { name: /^practice schedule$/i });

    // Expand then collapse.
    await practiceBtn.click();
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();

    await practiceBtn.click();
    await expect(page.getByRole("slider", { name: /recall target/i })).not.toBeVisible();
  });

  test("/settings#onboarding-heading auto-expands Data & backup section", async ({
    page,
  }) => {
    await page.goto("/settings#onboarding-heading");

    // Wait for the accordion to open before asserting nested content.
    await expect(
      page.getByRole("button", { name: /data.*backup/i }),
    ).toHaveAttribute("aria-expanded", "true");
    // The "Show onboarding again" button lives inside Data & backup.
    await expect(
      page.getByRole("button", { name: /show onboarding again/i }),
    ).toBeVisible();
  });

  test("expanding Card types section reveals cry card toggle", async ({ page }) => {
    // Seed the section as closed AND dismiss the default-open flag so that the
    // click opens (not closes) the section. cardTypesDefaultOpen overrides the
    // localStorage persisted state, so we must set cardTypesDefaultOpenDismissed
    // to prevent the section from force-opening despite the "0" value.
    await page.addInitScript(() => {
      window.localStorage.setItem("poke-memory:settings-section:card-types-heading", "0");
      try {
        const KEY = "poke-memory:settings:v1";
        const raw = window.localStorage.getItem(KEY);
        let existing: Record<string, unknown> = {};
        if (raw !== null) {
          try { existing = JSON.parse(raw) as Record<string, unknown>; } catch { /* ignore */ }
        }
        window.localStorage.setItem(KEY, JSON.stringify({
          ...existing,
          onboarding: {
            ...(typeof existing.onboarding === "object" && existing.onboarding !== null
              ? (existing.onboarding as Record<string, unknown>)
              : {}),
            cardTypesDefaultOpenDismissed: true,
          },
        }));
      } catch { /* ignore */ }
    });
    await page.goto("/settings");

    await page.getByRole("button", { name: /^card types$/i }).click();

    // The cry cards toggle switch must be visible inside Card types.
    await expect(
      page.getByRole("switch", { name: /enable cry cards/i }),
    ).toBeVisible();
  });
});

test.describe("Settings page - alternate forms toggle (#658)", () => {
  // Seed cardTypesDefaultOpenDismissed so Card types starts collapsed and
  // clicking the button opens (not closes) it. Without this, the default-open
  // behaviour on first visits means the first click closes the section.
  async function dismissCardTypesDefault(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
      try {
        const KEY = "poke-memory:settings:v1";
        const raw = window.localStorage.getItem(KEY);
        let existing: Record<string, unknown> = {};
        if (raw !== null) {
          try { existing = JSON.parse(raw) as Record<string, unknown>; } catch { /* ignore */ }
        }
        window.localStorage.setItem(KEY, JSON.stringify({
          ...existing,
          onboarding: {
            ...(typeof existing.onboarding === "object" && existing.onboarding !== null
              ? (existing.onboarding as Record<string, unknown>)
              : {}),
            cardTypesDefaultOpenDismissed: true,
          },
        }));
        window.localStorage.setItem("poke-memory:settings-section:card-types-heading", "0");
      } catch { /* ignore */ }
    });
  }

  test("alternate forms toggle is present and off by default in Card types section", async ({
    page,
  }) => {
    await dismissCardTypesDefault(page);
    await page.goto("/settings");

    // Expand "Card types".
    await page.getByRole("button", { name: /^card types$/i }).click();

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
    await dismissCardTypesDefault(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: /^card types$/i }).click();

    const toggle = page.getByRole("switch", {
      name: /include alternate forms in practice/i,
    });

    // Click to enable.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("Alternate forms - ScopeControl visibility (#658)", () => {
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
    // Seed cardTypesDefaultOpenDismissed so clicking the button opens the section.
    await page.addInitScript(() => {
      try {
        const KEY = "poke-memory:settings:v1";
        const raw = window.localStorage.getItem(KEY);
        let existing: Record<string, unknown> = {};
        if (raw !== null) {
          try { existing = JSON.parse(raw) as Record<string, unknown>; } catch { /* ignore */ }
        }
        window.localStorage.setItem(KEY, JSON.stringify({
          ...existing,
          onboarding: {
            ...(typeof existing.onboarding === "object" && existing.onboarding !== null
              ? (existing.onboarding as Record<string, unknown>)
              : {}),
            cardTypesDefaultOpenDismissed: true,
          },
        }));
        window.localStorage.setItem("poke-memory:settings-section:card-types-heading", "0");
      } catch { /* ignore */ }
    });
    // Enable the toggle on the Settings page and persist via Save.
    // handleToggle only updates React state; saveSettings is only called from
    // handleSave - so we must click Save before navigating away.
    await page.goto("/settings");
    await page.getByRole("button", { name: /^card types$/i }).click();
    await page.getByRole("switch", { name: /include alternate forms in practice/i }).click();

    // Click Save inside the Card types region and wait for "Saved!" confirmation
    // so we know the setting has been written to localStorage before we navigate.
    // Scoped to the Card types region to avoid strict-mode ambiguity when multiple
    // sections are expanded simultaneously.
    const cardTypesRegion = page.getByRole("region", { name: /^card types$/i });
    await cardTypesRegion.getByRole("button", { name: /^save$/i }).click();
    await expect(cardTypesRegion.getByText("Saved!")).toBeVisible();

    // Navigate to the practice page and open the scope panel.
    await page.goto("/");
    await page.locator("button[aria-controls='scope-panel']").click();

    // The "Alternate forms" section heading must now be visible.
    await expect(page.getByText("Alternate forms")).toBeVisible();
  });
});

test.describe("Settings page - search/filter (#662)", () => {
  test("search input is visible at the top of the settings page", async ({ page }) => {
    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });
    await expect(input).toBeVisible();
  });

  test("typing 'cry' filters to Audio and Card types sections and auto-expands them", async ({
    page,
  }) => {
    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });
    await input.fill("cry");

    // Both Audio and Card types match "cry" - the cry cards toggle lives in Card types.
    await expect(page.getByRole("switch", { name: /enable cry cards/i })).toBeVisible();

    // The Practice schedule section button must be absent - it is filtered out.
    await expect(page.getByRole("button", { name: /^practice schedule$/i })).not.toBeVisible();
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

    // Only Data & backup should be visible while filtering.
    await expect(page.getByRole("button", { name: /^practice schedule$/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^audio$/i })).not.toBeVisible();

    // Clear via the clear button.
    await page.getByRole("button", { name: /clear search/i }).click();

    // All top-level sections must be visible again after clearing.
    // Use exact-word anchors to avoid ambiguity with the Pokémon name language
    // pill button (which contains "language" in its accessible name).
    for (const label of [
      "Practice schedule",
      "Card types",
      "Audio",
      "Language",
      "Appearance",
      "Offline",
      "Regional & reminders",
      "About",
      "Advanced",
    ]) {
      await expect(
        page.getByRole("button", { name: new RegExp("^" + label + "$", "i") }),
      ).toBeVisible();
    }

    // The search input must be empty again.
    await expect(input).toHaveValue("");
  });

  test("no-match query shows empty-result message", async ({ page }) => {
    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });
    await input.fill("xyzzynosuchthing");

    // All section buttons must be gone. Use exact-word anchors to avoid
    // ambiguity with the Pokémon name language pill (which contains "language"
    // in its accessible name but is unaffected by the settings search filter).
    for (const label of [
      "Practice schedule",
      "Card types",
      "Audio",
      "Language",
      "Appearance",
      "Offline",
      "Advanced",
    ]) {
      await expect(
        page.getByRole("button", { name: new RegExp("^" + label + "$", "i") }),
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
    // Clicking gives focus - verifies the input is not disabled/inert.
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
        "practice-schedule-heading",
        "card-types-heading",
        "audio-heading",
        "language-heading",
        "offline-heading",
        "regional-reminders-heading",
        "data-backup-heading",
        "about-heading",
        "advanced-heading",
      ];
      for (const k of keys) {
        window.localStorage.setItem(`poke-memory:settings-section:${k}`, "0");
      }
    });

    await page.goto("/settings");

    const input = page.getByRole("searchbox", { name: /search settings/i });

    // Type a query - the matching section should be visible and expanded.
    await input.fill("backup");
    await expect(page.getByRole("button", { name: /data.*backup/i })).toBeVisible();

    // Clear the search.
    await page.getByRole("button", { name: /clear search/i }).click();

    // All sections must be back to collapsed (content hidden).
    // The recall-target slider lives inside Practice schedule; it must not be visible.
    await expect(page.getByRole("slider", { name: /recall target/i })).not.toBeVisible();

    // Confirm localStorage still records the section as closed (not overwritten).
    const dataBackupPersistedState = await page.evaluate(() =>
      window.localStorage.getItem("poke-memory:settings-section:data-backup-heading"),
    );
    expect(dataBackupPersistedState).toBe("0");
  });

  test("hash deep-link target section remains visible even when a query is active", async ({
    page,
  }) => {
    // Navigate to a hash that targets Practice schedule via a sub-section anchor.
    // With a query of 'backup' (matches only Data & backup), Practice schedule would
    // normally be filtered out - but the hash target must keep it present.
    await page.goto("/settings#scheduler-heading");

    // The Practice schedule button must be visible (hash target always included).
    await expect(page.getByRole("button", { name: /^practice schedule$/i })).toBeVisible();
    // The Practice schedule section must be expanded (hash-forced open).
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();
  });
});

// The "re-enable card type prompt (#835)" describe block was removed in #1234.
// Since #1234, reverse cards are a required practice direction - the
// reverseCardsEnabled toggle and its re-enable dialog no longer exist on the
// Settings page. The tests that exercised clicking that toggle, confirming the
// dialog, and choosing "Reuse" / "Start fresh" / "Cancel" have been deleted
// rather than left as dead assertions against a removed UI element.

test.describe("Settings - CSV review history export (#918)", () => {
  test("Download CSV link is not visible for guests (no session)", async ({
    page,
  }) => {
    // The CSV export control is gated on a signed-in session. E2E runs in
    // guest mode only, so the link must not render.
    await page.goto("/settings");
    await page.getByRole("button", { name: /data.*backup/i }).click();

    await expect(
      page.getByRole("link", { name: /download csv/i }),
    ).toHaveCount(0);
  });

  test("GET /api/export rejects an unauthenticated request (401 or 503)", async ({
    page,
  }) => {
    // Verify the endpoint is guarded - an unauthenticated request must never
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

test.describe("Settings - Danger zone (#697)", () => {
  test("danger zone shows Reset all progress; Delete account is hidden for guests", async ({
    page,
  }) => {
    // E2E runs guest-mode only. The "Delete account" control is gated on a
    // signed-in session - there is no cloud identity for a guest to delete - 
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

test.describe("Settings page - Web Push opt-in (#1056)", () => {
  test("daily reminder toggle is hidden in a regular browser tab (not standalone)", async ({
    page,
  }) => {
    // The PushOptIn component renders only when display-mode is standalone
    // AND push is supported AND the user is authenticated. A normal browser
    // session in CI satisfies none of those, so the toggle must be entirely
    // absent - not just hidden via CSS.
    await page.goto("/settings");

    // Expand Regional & reminders so the would-be parent section is open.
    await page.getByRole("button", { name: /regional.*reminders/i }).click();
    await expect(
      page.getByRole("button", { name: /regional.*reminders/i }),
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
    // isPushSupported considers valid. The toggle must still not render -
    // we don't want to show a control that can't actually subscribe.
    await page.emulateMedia({ media: "screen", colorScheme: "light" });

    await page.goto("/settings");
    await page.getByRole("button", { name: /regional.*reminders/i }).click();
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
    //     addInitScript - same approach the auth.spec.ts mock-auth tests use
    //     to flip readiness signals on the page before app code runs.
    //
    // Once the toggle renders we click it and assert the navigator-side
    // surface is exercised. We stub Notification.requestPermission and the
    // PushManager.subscribe path so the helper round-trip does not depend on
    // a real push backend (no VAPID key on the preview deployment) and so
    // the test never sends a real notification. The mock-auth seam's
    // Supabase client resolves the delete + insert legs as no-op successes.

    // Seed the addInitScript before navigation - the same ordering pattern
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

    // Navigate to the settings page with the Regional & reminders hash so the
    // accordion auto-expands without an extra click.
    await page.goto("/settings#regional-reminders-heading");

    // The toggle must render with its expected accessible name. Both the
    // role+name selector and the data-testid lookup must match - that is
    // the positive assertion that absence-only suites lack.
    const toggle = page.getByTestId("push-optin-button");
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute("aria-label", "Daily review reminder");
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // #1950 streak reminder toggle: nested under the primary toggle, same
    // card. It must render and be OFF + disabled while the primary daily
    // reminder is not yet subscribed - state IN (disabled) before state OUT
    // (enabled) below.
    const streakToggle = page.getByTestId("push-streak-optin-button");
    await expect(streakToggle).toBeVisible();
    await expect(streakToggle).toHaveAttribute("aria-checked", "false");
    await expect(streakToggle).toBeDisabled();

    // Clicking while disabled must not flip the state (defence in depth on
    // top of the native `disabled` attribute already blocking the click).
    await streakToggle.click({ force: true });
    await expect(streakToggle).toHaveAttribute("aria-checked", "false");

    // Core interaction: clicking the toggle drives subscribeToPush, which
    // exercises the helper's full happy path (permission gate → SW ready →
    // PushManager.subscribe → DB persist). aria-checked flipping to "true"
    // proves every leg of that chain succeeded under the mock-auth seam.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });

    // Once the primary reminder is on, the streak toggle becomes usable.
    await expect(streakToggle).toBeEnabled();
    await streakToggle.click();
    await expect(streakToggle).toHaveAttribute("aria-checked", "true");

    // Turning the primary reminder back off must re-disable the streak
    // toggle (its dependency is gone) without erroring.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false", {
      timeout: 10_000,
    });
    await expect(streakToggle).toBeDisabled();
  });
});

test.describe("Settings - reverse-card feedback delay gating (#1200 / #1205 / #1234)", () => {
  // Since #1234 reverse cards are always on - the reverseCardsEnabled toggle
  // has been removed. The feedback delay fieldset is now unconditionally
  // visible whenever the Audio section is expanded.
  test("feedback delay control is always visible in the Audio section", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Expand the Audio section.
    await page.getByRole("button", { name: /^audio$/i }).click();

    // The fieldset must be present unconditionally (reverse is always on).
    await expect(
      page.getByRole("group", { name: /reverse card feedback delay/i }),
    ).toBeVisible();

    // Verify the radio inputs are interactive - "core interaction succeeds" bar.
    // The default value is "default", so click "off" to exercise a real change.
    // The native radio inputs are sr-only and the labels intercept pointer
    // events; click the label by its accessible text so the interaction lands
    // on the surface the user actually clicks.
    await page.getByText("Off", { exact: true }).click();
    await expect(page.getByRole("radio", { name: /off/i })).toBeChecked();
    await expect(page.getByRole("radio", { name: /default/i })).not.toBeChecked();
  });
});

test.describe("Settings - reverse-card feedback delay control (#1207)", () => {
  // Since #1234 reverse cards are always on, so the feedback delay fieldset
  // is unconditionally visible once the Audio section is expanded.
  // No beforeEach setup is needed here - the fieldset renders by default.

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

    // The factory default is "default" - "Default" radio must start checked.
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

    // Select "Off" - the onChange handler calls saveSettings immediately, so
    // no explicit Save button click is needed before reloading.
    await group.getByText("Off", { exact: true }).click();
    await expect(group.getByRole("radio", { name: "Off" })).toBeChecked();

    // Reload the page. The setting is already persisted in localStorage by
    // the onChange handler, so "Off" remains selected. CollapsibleSection
    // also persists its open/closed state under
    // poke-memory:settings-section:audio-heading, so the Audio section
    // reopens itself on reload - no click needed (clicking would toggle it
    // closed again).
    await page.reload();

    const groupAfterReload = page.getByRole("group", {
      name: /reverse card feedback delay/i,
    });
    await expect(groupAfterReload).toBeVisible();
    await expect(groupAfterReload.getByRole("radio", { name: "Off" })).toBeChecked();
    await expect(groupAfterReload.getByRole("radio", { name: "Default" })).not.toBeChecked();
  });
});

test.describe("Settings - Offline section (#1168)", () => {
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

test.describe("Settings - Language section (#1720 / #1726)", () => {
  // Language is now GA (no Labs flag gate). The Language section renders
  // unconditionally as the fourth top-level section.

  test("Language section is always visible on the settings page", async ({
    page,
  }) => {
    await page.goto("/settings");

    // The Language collapsible section must be present without any flag setup.
    await expect(
      page.getByRole("button", { name: /^language$/i }),
    ).toBeVisible();
  });

  test("Language section contains the app-language picker and enrolment list", async ({
    page,
  }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: /^language$/i }).click();

    // App interface language select must be present.
    await expect(
      page.getByLabel(/app interface language/i),
    ).toBeVisible();

    // Pokémon name practice languages heading must be present.
    await expect(
      page.getByText(/Pokémon name practice languages/i),
    ).toBeVisible();
  });
});

// ─── #1315: push notification hour picker ────────────────────────────────────

// ─── #1622: Feedback modal ───────────────────────────────────────────────────

test.describe("Settings - Send feedback modal (#1622 / #1849)", () => {
  test("'Send feedback' button is visible at the top of Settings (lifted above accordions, #1849)", async ({
    page,
  }) => {
    await page.goto("/settings");

    // The Send feedback row sits ABOVE all accordions (lifted in #1849) - visible
    // without scrolling.
    const sendFeedbackBtn = page.getByRole("button", { name: /send feedback/i });
    await expect(sendFeedbackBtn).toBeVisible();
  });

  test("clicking Send feedback opens the modal with form fields and privacy notice", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Open the modal - no accordion expand needed.
    await page.getByRole("button", { name: /send feedback/i }).click();

    // The dialog title must be visible.
    await expect(page.getByRole("heading", { name: /send feedback/i })).toBeVisible();

    // The category select must be present.
    await expect(page.getByLabel(/category/i)).toBeVisible();

    // The message textarea must be present.
    await expect(page.getByLabel(/message/i)).toBeVisible();

    // The privacy notice must be present.
    await expect(
      page.getByText(/please do not include personal information/i),
    ).toBeVisible();

    // The Submit and Cancel buttons must be present.
    await expect(page.getByRole("button", { name: /^send$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /cancel/i })).toBeVisible();
  });

  test("feedback form opens and is interactable (category, message, counter, privacy notice, Send enabled)", async ({
    page,
  }) => {
    // NOTE: The submit->success and submit->error round-trips are NOT asserted
    // here. The PWA service worker bypasses page.route(), so a stubbed 200
    // cannot be reliably delivered by the local e2e server; the real
    // /api/feedback route returns 500 in CI (no Supabase env vars). Both the
    // success and error branches are fully covered by the 21 FeedbackModal
    // unit tests in components/feedback/FeedbackModal.test.tsx (mocked fetch).
    // The error branch IS covered by the "error state shows inline error"
    // test below, which relies on the real env-less 500 and is deterministic.

    await page.goto("/settings");
    await page.getByRole("button", { name: /send feedback/i }).click();

    // Modal title must be visible.
    await expect(page.getByRole("heading", { name: /send feedback/i })).toBeVisible();

    // Category selector must be present and selectable.
    const categorySelect = page.getByLabel(/category/i);
    await expect(categorySelect).toBeVisible();
    await categorySelect.selectOption({ label: "Bug report" });
    await expect(categorySelect).toHaveValue("bug");

    // Message textarea must be fillable.
    const messageInput = page.getByLabel(/message/i);
    await expect(messageInput).toBeVisible();
    await messageInput.fill("This is a test bug report from e2e.");

    // Character counter must be visible after typing.
    await expect(page.getByText(/\/2[,\s]?000/)).toBeVisible();

    // Privacy notice must be visible.
    await expect(
      page.getByText(/please do not include personal information/i),
    ).toBeVisible();

    // Send button must be ENABLED when category is chosen and message is non-empty.
    const sendBtn = page.getByRole("button", { name: /^send$/i });
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeEnabled();
  });

  test("error state shows inline error and keeps modal open (stubbed 500)", async ({
    page,
  }) => {
    // Stub /api/feedback to return 500.
    await page.route("**/api/feedback", (route) => {
      void route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false }),
      });
    });

    await page.goto("/settings");
    await page.getByRole("button", { name: /send feedback/i }).click();

    await page.getByLabel(/category/i).selectOption({ label: "Feature request" });
    await page.getByLabel(/message/i).fill("A feature I would like.");
    await page.getByRole("button", { name: /^send$/i }).click();

    // Inline error must appear.
    await expect(
      page.getByText(/something went wrong/i),
    ).toBeVisible({ timeout: 5_000 });

    // Form must still be visible (modal stayed open, user can retry).
    await expect(page.getByLabel(/category/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^send$/i })).toBeVisible();
  });
});

test.describe("Settings - Play cry on reveal is independent of Cry cards (#1885)", () => {
  test("Play-cry-on-reveal toggle is fully enabled and operable when Cry cards are off", async ({
    page,
  }) => {
    // Cry cards default to off. The previous behaviour greyed the Play-cry-on-reveal
    // row with opacity-50 and showed a disabled note whenever cryCardsEnabled was
    // false - even though the reveal path never gated on cryCardsEnabled. This test
    // guards against that regression being re-introduced.
    await page.goto("/settings");

    // Cry cards default to off, so no setup is needed to reach the
    // "cry cards disabled" condition that previously greyed this row. (Driving
    // the Card types section here is avoided on purpose: it can be open by
    // default, so a navigation click would collapse it and is collapse-state
    // dependent. The independence we actually guard lives on the Audio toggle.)

    // Expand the Audio section.
    await page.getByRole("button", { name: /^audio$/i }).click();

    // The Play-cry-on-reveal switch must be visible inside the Audio section.
    const playCrySwitch = page.getByRole("switch", { name: /play cry on reveal/i });
    await expect(playCrySwitch).toBeVisible();

    // The switch must not be disabled - it is independent of cryCardsEnabled.
    await expect(playCrySwitch).not.toBeDisabled();

    // Core interaction: clicking the switch must toggle it on, proving it is
    // independently operable without cry cards being enabled.
    await playCrySwitch.click();
    await expect(playCrySwitch).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("Settings - push notification hour picker (#1315)", () => {
  test("hour picker renders in Regional & reminders section and can be set", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Expand "Regional & reminders".
    await page.getByRole("button", { name: /regional.*reminders/i }).click();

    // The 'Daily reminder time' picker must be visible in the Regional sub-section.
    const select = page.getByLabel(/daily reminder time/i);
    await expect(select).toBeVisible();

    // The default option must read "Default (08:00)" - no preference set.
    await expect(select).toHaveValue("");

    // Select a specific hour and verify the value updates.
    await select.selectOption("20");
    await expect(select).toHaveValue("20");
  });

  test("hour picker has 25 options (default + hours 00:00 to 23:00)", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /regional.*reminders/i }).click();

    const select = page.getByLabel(/daily reminder time/i);
    await expect(select).toBeVisible();

    const optionCount = await select.locator("option").count();
    expect(optionCount).toBe(25);
  });
});

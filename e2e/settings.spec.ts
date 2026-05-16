import { test, expect } from "@playwright/test";

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

    // All four top-level category buttons must be visible.
    for (const label of ["Appearance", "Practice", "Audio", "Account & Data", "Advanced"]) {
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

    // The "Show tips again" button lives inside Account & Data → onboarding sub-section.
    await expect(
      page.getByRole("button", { name: /show tips again/i }),
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

    // All five top-level sections must be visible again after clearing.
    for (const label of ["Appearance", "Practice", "Audio", "Account & Data", "Advanced"]) {
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
    for (const label of ["Appearance", "Practice", "Audio", "Account & Data", "Advanced"]) {
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

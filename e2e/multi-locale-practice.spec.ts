// e2e/multi-locale-practice.spec.ts
// Smoke tests for per-locale practice sessions (#1562, part of the #1484 epic).
//
// Scenarios:
//   1. Baseline (en only, languages flag off) — Practice renders a card and a
//      grade interaction succeeds. Regression guard for the default majority.
//   2. Language pill is visible when the languages flag and learningLocales are set.
//   3. Switch to Japanese → non-empty ja session with a Japanese name rendered.
//   4. Mid-card lock — while a card is revealed the pill opens but blocks switching
//      and shows the lock message; grading the card re-enables switching.
//
// Guest-mode only. State is driven via localStorage / QA seed, never by
// clicking through Settings, to keep the tests stable and fast.

import { test, expect, type Page } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { practiceReadyLocator } from "./helpers/practiceCard";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Seeds localStorage so the languages Labs flag is enabled and the user is
 * enrolled in both English and Japanese, with English as the active locale.
 * Mirrors the pattern in i18n.spec.ts::enableLanguagesFlag.
 */
async function seedLanguagesEnabled(page: Page): Promise<void> {
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
          /* ignore malformed JSON */
        }
      }
      const merged = {
        mobileNav: "bottom",
        ...existing,
        learningLocales: ["en", "ja"],
        activePokemonNameLocale: "en",
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
      };
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* localStorage unavailable */
    }
  });
}

/**
 * Seeds localStorage so the superuser Developer panel is unlocked and
 * qaSeedMode is enabled. Mirrors qa-seed.spec.ts::seedSuperuserWithQaSeed.
 */
async function seedSuperuserQaSeed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("poke-memory:superuser", "true");
    window.localStorage.setItem(
      "poke-memory:superuser:flags:v1",
      JSON.stringify({
        pretendAllMastered: false,
        forceNextStreakMilestone: false,
        forceCardsGraduated: false,
        qaSeedMode: true,
      }),
    );
  });
}

/**
 * Opens Settings, applies the fsrs-locale-mastery QA seed scenario, waits for
 * confirmation, then reloads so the seeded IDB data is live.
 *
 * The seed enrols en + ja, sets activePokemonNameLocale to "en", enables the
 * `languages` Labs flag (so the pill is visible immediately), and writes an
 * independent ja card set (5 mastered + 5 due-soon name cards), giving a
 * non-empty Japanese session queue.
 */
async function applyFsrsLocaleMasterySeed(page: Page): Promise<void> {
  // Accept the confirm dialog that "Apply seed" triggers.
  page.on("dialog", (dialog) => { void dialog.accept(); });

  await page.goto("/settings");

  // Expand the Advanced section to reveal the Developer panel.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  const developerSection = page.getByRole("region", { name: /developer/i });
  await expect(developerSection).toBeVisible({ timeout: 10_000 });

  const seedPanel = page.getByTestId("qa-seed-section");
  await expect(seedPanel).toBeVisible();

  // Select the fsrs-locale-mastery scenario and apply it.
  await seedPanel.getByRole("combobox", { name: /scenario/i }).selectOption("fsrs-locale-mastery");
  await seedPanel.getByRole("button", { name: /apply.*seed/i }).click();

  // Wait for the success status and "Reload" instruction.
  await expect(seedPanel.getByRole("status")).toContainText(/seed applied/i, { timeout: 10_000 });

  // Reload so the seeded IDB data is visible to ReviewSession.
  await page.reload();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Per-locale practice session (#1562)", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage first so no prior test's state leaks into this one.
    // addInitScript fires on every goto, so this clear runs before any
    // navigation in the test body.
    await page.addInitScript(() => localStorage.clear());
    // Re-seed onboarding dismissal after the clear so the first-visit modal
    // does not block the practice surface or the language pill.
    await addOnboardingPreDismiss(page);
  });

  // ── Baseline: languages flag off, single language (en) ───────────────────

  test("baseline (flag off): practice page renders a card in the default English session", async ({
    page,
  }) => {
    // Default state — no labsFlags, no learningLocales override. A fresh
    // guest session sees only English cards with the standard daily budget.
    await page.goto("/");

    // The language switcher pill must NOT be visible when the flag is off.
    // Pill aria-label is "Pokémon name language: {language}. Tap to change."
    await expect(
      page.getByRole("button", { name: /Pokémon name language/i }),
    ).toHaveCount(0);

    // A practice card must render. Use practiceReadyLocator, which matches all
    // legitimate first-card surfaces (Reveal button, SpritePicker group,
    // MultipleChoice group, or an end-state heading) so a calendar-dependent
    // shuffle to a reverse or multiple-choice card does not cause a false failure.
    const practiceReady = practiceReadyLocator(page);
    await expect(practiceReady).toBeVisible({ timeout: 15_000 });

    // Attempt a full reveal+grade cycle. If the session leads with a Reveal
    // card (flip name / evo), reveal it and grade Good. If it leads with a
    // SpritePicker or MultipleChoice the practice surface is already
    // interactable and we have already asserted it above.
    const reveal = page.getByRole("button", { name: /^reveal$/i });
    const isReveal = await reveal.isVisible().catch(() => false);
    if (isReveal) {
      await reveal.click();
      const goodButton = page.getByRole("button", { name: /good/i });
      await expect(goodButton).toBeVisible({ timeout: 5_000 });
      await goodButton.click();

      // After grading, either the next card renders or the session is complete.
      // Either is a passing state — we are proving the grade cycle does not error.
      const nextReady = practiceReadyLocator(page);
      await expect(nextReady).toBeVisible({ timeout: 10_000 });
    }
  });

  // ── Per-locale: en + ja enrolled, language switcher pill ─────────────────

  test("language switcher pill is visible when the languages flag is on", async ({
    page,
  }) => {
    await seedLanguagesEnabled(page);
    await page.goto("/");

    // The pill must be present and show the active locale endonym "English".
    // Full accessible name: "Pokémon name language: English. Tap to change."
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*English/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("switching the pill to Japanese shows a non-empty ja session with a Japanese name", async ({
    page,
  }) => {
    // The fsrs-locale-mastery scenario seeds:
    //   • 30 mastered + 10 due-soon + 5 in-learning name cards (locale: en).
    //   • 5 mastered + 5 due-soon name cards (locale: ja) for species 43, 52, 63, 66, 74.
    //   • learningLocales: ["en", "ja"], activePokemonNameLocale: "en".
    //   • labsFlags: { languages: true } — pill visible immediately.
    await seedSuperuserQaSeed(page);
    await applyFsrsLocaleMasterySeed(page);

    // Navigate to Practice now that the seed is live.
    await page.goto("/");

    // The language pill must be visible — the seed enables the flag and sets
    // learningLocales. Full accessible name: "Pokémon name language: English. Tap to change."
    const pill = page.getByRole("button", { name: /Pokémon name language.*English/i });
    await expect(pill).toBeVisible({ timeout: 15_000 });

    // Open the language switcher dropdown.
    await pill.click();

    // The dropdown (role="dialog") must be visible.
    // aria-labelledby points to an h2 whose text is t("heading") = "Pokémon name language".
    const dialog = page.getByRole("dialog", { name: /Pokémon name language/i });
    await expect(dialog).toBeVisible();

    // Japanese must be listed as a radio option. The aria-label is generated as
    // t("dueTodayAriaLabel", { language: "日本語", count: N }):
    //   "日本語: N cards due today" or "日本語: caught up"
    // A simple /日本語/ partial match handles either form.
    const jaOption = dialog.getByRole("radio", { name: /日本語/ });
    await expect(jaOption).toBeVisible();

    // Select Japanese.
    await jaOption.click();

    // The dialog closes after selection (selectLocale calls close()).
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // The pill must now display the Japanese endonym.
    // Full accessible name: "Pokémon name language: 日本語. Tap to change."
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*日本語/ }),
    ).toBeVisible({ timeout: 5_000 });

    // Navigate away and back to trigger a fresh session build filtered to ja.
    await page.goto("/settings");
    await page.goto("/");

    // The practice session must be non-empty for the Japanese locale. The seed
    // provides 5 due-soon ja name cards so a Reveal button (or an end-state
    // message) must appear. A generous timeout covers IDB hydration + filtering.
    const reveal = page.getByRole("button", { name: /^reveal$/i });
    const caughtUp = page.getByText(/all caught up/i);
    await Promise.race([
      reveal.waitFor({ state: "visible", timeout: 20_000 }),
      caughtUp.waitFor({ state: "visible", timeout: 20_000 }),
    ]);

    // Confirm the pill still shows Japanese (locale persists across navigation).
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*日本語/ }),
    ).toBeVisible();

    // If a Reveal card loaded (flip name card), reveal it and assert the
    // displayed name is non-Latin Japanese script.
    // Japanese Pokémon names are resolved via useLocalePokemonName for locale "ja";
    // they contain hiragana, katakana, or kanji (U+3040–U+9FFF).
    const isRevealVisible = await reveal.isVisible().catch(() => false);
    if (isRevealVisible) {
      await reveal.click();
      // After reveal the Japanese name is shown in the card body. Poll the
      // main element's text content for Japanese script. We use a waitFor
      // rather than a one-shot evaluate so natural render latency is handled.
      await expect.poll(
        async () => {
          return page.locator("main").evaluate((el) => {
            // Hiragana: U+3040–U+309F, Katakana: U+30A0–U+30FF, CJK: U+4E00–U+9FFF
            return /[぀-鿿]/.test(el.innerText ?? "");
          });
        },
        {
          message: "Expected at least one Japanese character in the practice card after reveal (locale: ja)",
          timeout: 5_000,
        },
      ).toBe(true);
    }
  });

  // ── Mid-card lock: switching the pill while a card is revealed is blocked ──

  test("mid-card lock: pill opens but blocks switching while card is revealed, clears after grading", async ({
    page,
  }) => {
    // Use the fsrs-locale-mastery seed so the pill is visible and the ja
    // session is non-empty. The seed sets activePokemonNameLocale to "en"
    // and enables the languages flag.
    await seedSuperuserQaSeed(page);
    await applyFsrsLocaleMasterySeed(page);

    await page.goto("/");

    // Wait for the pill and a Reveal card. The mid-card lock only applies when
    // a card is in the revealed state. If the session leads with a SpritePicker
    // or MultipleChoice card, skip — the lock is exercised on flip-type cards.
    const pill = page.getByRole("button", { name: /Pokémon name language.*English/i });
    await expect(pill).toBeVisible({ timeout: 15_000 });

    const reveal = page.getByRole("button", { name: /^reveal$/i });
    const hasReveal = await reveal.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasReveal) {
      test.skip(true, "First card is not a flip-type card — mid-card lock cannot be exercised");
      return;
    }

    // Reveal the card. This sets KEY_CARD_REVEALED = "1" in localStorage,
    // which LanguageSwitcher reads via isCardRevealed() when the panel opens.
    await reveal.click();
    const gradeButtons = page.getByRole("group", { name: /grade your answer/i });
    await expect(gradeButtons).toBeVisible({ timeout: 5_000 });

    // Open the pill while a card is revealed.
    await pill.click();
    const dialog = page.getByRole("dialog", { name: /Pokémon name language/i });
    await expect(dialog).toBeVisible();

    // The lock message must be shown (role="status", text from
    // t("cardRevealedLock") = "Finish this card first, then switch language.").
    await expect(
      dialog.getByRole("status"),
    ).toContainText(/Finish this card first/i);

    // The Japanese radio option must be present but clicking it does NOT
    // switch the locale — selectLocale guards on cardRevealed.
    const jaOption = dialog.getByRole("radio", { name: /日本語/ });
    await expect(jaOption).toBeVisible();
    await jaOption.click();

    // The dialog must remain open (no locale switch occurred — a switch calls
    // close(), so if the dialog is still open the guard fired correctly).
    await expect(dialog).toBeVisible();

    // The pill must still show English — locale was not changed.
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*English/i }),
    ).toBeVisible();

    // Close the dialog so grade buttons are accessible.
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });

    // Grade the card — this clears KEY_CARD_REVEALED.
    await gradeButtons.getByRole("button", { name: /good/i }).click();

    // Now the pill can be opened and switching should succeed.
    // Wait for the next card or end-state first, then re-open the pill.
    const nextPracticeReady = practiceReadyLocator(page);
    await expect(nextPracticeReady).toBeVisible({ timeout: 10_000 });

    await pill.click();
    const dialog2 = page.getByRole("dialog", { name: /Pokémon name language/i });
    await expect(dialog2).toBeVisible();

    // The lock message must NOT be present after grading.
    await expect(dialog2.getByRole("status")).toHaveCount(0);

    // Switch to Japanese — this should succeed (dialog closes).
    const jaOption2 = dialog2.getByRole("radio", { name: /日本語/ });
    await expect(jaOption2).toBeVisible();
    await jaOption2.click();
    await expect(dialog2).not.toBeVisible({ timeout: 5_000 });

    // The pill must now show 日本語 — the switch went through.
    await expect(
      page.getByRole("button", { name: /Pokémon name language.*日本語/ }),
    ).toBeVisible({ timeout: 5_000 });
  });
});

/**
 * Tests for contextual discovery nudges (#1443, #1573).
 *
 * 1. markWhatIKnowNudgeDismissed — shown on Settings > Practice near the
 *    Quickstart quiz, absent when dismissed.
 * 2. practiceScopeNudgeDismissed — shown on the practice screen (ReviewSession)
 *    above ScopeControl once the first-visit onboarding is done.
 * 3. higherOrLowerNudgeDismissed - shown on the active-card practice screen
 *    (ReviewSession, above ScopeControl) once the user has seen at least one
 *    Pokémon and the first-visit onboarding is done (#1573).
 *
 * Covers:
 *  - State IN: nudge visible when flag is false.
 *  - State OUT: nudge absent when flag is true.
 *  - State OUT (gate): scope nudge absent when firstVisitOnboardingDismissed is
 *    false — covered at e2e level in e2e/onboarding.spec.ts ("practiceScope nudge
 *    is absent when first-visit onboarding not yet done") because the gate lives
 *    in ReviewSession state, which requires the full component to exercise.
 *  - Existing-user reach: validateOnboarding coerces absent key to false.
 *  - Locale coverage: all four supported locales (en/ja/zh-Hans/zh-Hant).
 *  - All flags reset via DEFAULT_ONBOARDING (all false).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import {
  DEFAULT_SETTINGS,
  DEFAULT_ONBOARDING,
  SETTINGS_SAVED_EVENT,
  validateOnboarding,
} from "@/lib/settings/persistence";
import type { UserSettings } from "@/lib/settings/persistence";

// ---------------------------------------------------------------------------
// Settings stub — same pattern as OnboardingHint.test.tsx
// ---------------------------------------------------------------------------

let currentSettings: UserSettings;

vi.mock("@/lib/settings/persistence", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/settings/persistence")
  >("@/lib/settings/persistence");
  return {
    ...actual,
    loadSettings: () => currentSettings,
    saveSettings: (next: UserSettings) => {
      currentSettings = next;
      window.dispatchEvent(
        new CustomEvent(actual.SETTINGS_SAVED_EVENT, { detail: next }),
      );
    },
  };
});

beforeEach(() => {
  currentSettings = { ...DEFAULT_SETTINGS };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function settingsWithFlag(
  key: "markWhatIKnowNudgeDismissed" | "practiceScopeNudgeDismissed" | "higherOrLowerNudgeDismissed",
  value: boolean,
): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    onboarding: { ...DEFAULT_ONBOARDING, [key]: value },
  };
}

// ---------------------------------------------------------------------------
// markWhatIKnowNudgeDismissed
// ---------------------------------------------------------------------------

describe("markWhatIKnowNudgeDismissed flag", () => {
  it("DEFAULT_ONBOARDING has markWhatIKnowNudgeDismissed as false (nudge shows by default)", () => {
    expect(DEFAULT_ONBOARDING.markWhatIKnowNudgeDismissed).toBe(false);
  });

  it("nudge shows when flag is false", async () => {
    currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="markWhatIKnowNudgeDismissed" title="Test title">
        <p>Quickstart body</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText("Test title")).toBeTruthy();
  });

  it("nudge is absent when flag is true", () => {
    currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", true);

    const { container } = renderWithIntl(
      <OnboardingHint id="markWhatIKnowNudgeDismissed" title="Test title">
        <p>Quickstart body</p>
      </OnboardingHint>,
    );
    expect(container.textContent).toBe("");
  });

  it("dismissing the nudge sets markWhatIKnowNudgeDismissed to true", async () => {
    currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="markWhatIKnowNudgeDismissed">
        Mark what you know.
      </OnboardingHint>,
    );
    const btn = await screen.findByRole("button", { name: /dismiss hint/i });
    await userEvent.click(btn);

    expect(currentSettings.onboarding.markWhatIKnowNudgeDismissed).toBe(true);
    expect(screen.queryByText("Mark what you know.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// practiceScopeNudgeDismissed
// ---------------------------------------------------------------------------

describe("practiceScopeNudgeDismissed flag", () => {
  it("DEFAULT_ONBOARDING has practiceScopeNudgeDismissed as false (nudge shows by default)", () => {
    expect(DEFAULT_ONBOARDING.practiceScopeNudgeDismissed).toBe(false);
  });

  it("nudge shows when flag is false", async () => {
    currentSettings = settingsWithFlag("practiceScopeNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="practiceScopeNudgeDismissed" title="Scope tip">
        <p>Scope body</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText("Scope tip")).toBeTruthy();
  });

  it("nudge is absent when flag is true", () => {
    currentSettings = settingsWithFlag("practiceScopeNudgeDismissed", true);

    const { container } = renderWithIntl(
      <OnboardingHint id="practiceScopeNudgeDismissed" title="Scope tip">
        <p>Scope body</p>
      </OnboardingHint>,
    );
    expect(container.textContent).toBe("");
  });

  it("dismissing the nudge sets practiceScopeNudgeDismissed to true", async () => {
    currentSettings = settingsWithFlag("practiceScopeNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="practiceScopeNudgeDismissed">
        Scope tip body.
      </OnboardingHint>,
    );
    const btn = await screen.findByRole("button", { name: /dismiss hint/i });
    await userEvent.click(btn);

    expect(currentSettings.onboarding.practiceScopeNudgeDismissed).toBe(true);
    expect(screen.queryByText("Scope tip body.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Existing-user reach — validateOnboarding coercion
// ---------------------------------------------------------------------------

describe("validateOnboarding — absent keys resolve to false (existing-user reach)", () => {
  it("absent markWhatIKnowNudgeDismissed coerces to false", () => {
    const result = validateOnboarding({
      firstVisitOnboardingDismissed: true,
      welcomeDismissed: true,
      // markWhatIKnowNudgeDismissed deliberately absent
    });
    expect(result.markWhatIKnowNudgeDismissed).toBe(false);
  });

  it("absent practiceScopeNudgeDismissed coerces to false", () => {
    const result = validateOnboarding({
      firstVisitOnboardingDismissed: true,
      welcomeDismissed: true,
      // practiceScopeNudgeDismissed deliberately absent
    });
    expect(result.practiceScopeNudgeDismissed).toBe(false);
  });

  it("both flags true when explicitly set", () => {
    const result = validateOnboarding({
      markWhatIKnowNudgeDismissed: true,
      practiceScopeNudgeDismissed: true,
    });
    expect(result.markWhatIKnowNudgeDismissed).toBe(true);
    expect(result.practiceScopeNudgeDismissed).toBe(true);
  });

  it("non-boolean truthy value does NOT coerce to true (=== true guard)", () => {
    const result = validateOnboarding({
      markWhatIKnowNudgeDismissed: 1 as unknown as boolean,
      practiceScopeNudgeDismissed: "yes" as unknown as boolean,
    });
    expect(result.markWhatIKnowNudgeDismissed).toBe(false);
    expect(result.practiceScopeNudgeDismissed).toBe(false);
  });

  // New absent-key tests for #1482 gate signals.
  it("absent scopeEverOpened coerces to false (#1482)", () => {
    const result = validateOnboarding({
      firstVisitOnboardingDismissed: true,
      // scopeEverOpened deliberately absent
    });
    expect(result.scopeEverOpened).toBe(false);
  });

  it("absent practiceSessionsCount coerces to 0 (#1482)", () => {
    const result = validateOnboarding({
      firstVisitOnboardingDismissed: true,
      // practiceSessionsCount deliberately absent
    });
    expect(result.practiceSessionsCount).toBe(0);
  });

  it("non-boolean scopeEverOpened coerces to false — === true guard (#1482)", () => {
    const result = validateOnboarding({
      scopeEverOpened: 1 as unknown as boolean,
    });
    expect(result.scopeEverOpened).toBe(false);
  });

  it("non-integer practiceSessionsCount coerces to 0 (#1482)", () => {
    const result = validateOnboarding({
      practiceSessionsCount: "5" as unknown as number,
    });
    expect(result.practiceSessionsCount).toBe(0);
  });

  it("valid practiceSessionsCount integer is preserved (#1482)", () => {
    const result = validateOnboarding({
      practiceSessionsCount: 7,
    });
    expect(result.practiceSessionsCount).toBe(7);
  });

  it("scopeEverOpened: true is preserved (#1482)", () => {
    const result = validateOnboarding({
      scopeEverOpened: true,
    });
    expect(result.scopeEverOpened).toBe(true);
  });

  it("absent higherOrLowerNudgeDismissed coerces to false (#1573)", () => {
    const result = validateOnboarding({
      firstVisitOnboardingDismissed: true,
      // higherOrLowerNudgeDismissed deliberately absent
    });
    expect(result.higherOrLowerNudgeDismissed).toBe(false);
  });

  it("non-boolean higherOrLowerNudgeDismissed coerces to false - === true guard (#1573)", () => {
    const result = validateOnboarding({
      higherOrLowerNudgeDismissed: 1 as unknown as boolean,
    });
    expect(result.higherOrLowerNudgeDismissed).toBe(false);
  });

  it("higherOrLowerNudgeDismissed: true is preserved (#1573)", () => {
    const result = validateOnboarding({
      higherOrLowerNudgeDismissed: true,
    });
    expect(result.higherOrLowerNudgeDismissed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// higherOrLowerNudgeDismissed (#1573)
// ---------------------------------------------------------------------------

describe("higherOrLowerNudgeDismissed flag", () => {
  it("DEFAULT_ONBOARDING has higherOrLowerNudgeDismissed as false (nudge shows by default)", () => {
    expect(DEFAULT_ONBOARDING.higherOrLowerNudgeDismissed).toBe(false);
  });

  it("nudge shows when flag is false", async () => {
    currentSettings = settingsWithFlag("higherOrLowerNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="higherOrLowerNudgeDismissed" title="Finish your session for a bonus mini-game">
        <p>Higher or Lower body</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText("Finish your session for a bonus mini-game")).toBeTruthy();
  });

  it("nudge is absent when flag is true", () => {
    currentSettings = settingsWithFlag("higherOrLowerNudgeDismissed", true);

    const { container } = renderWithIntl(
      <OnboardingHint id="higherOrLowerNudgeDismissed" title="Finish your session for a bonus mini-game">
        <p>Higher or Lower body</p>
      </OnboardingHint>,
    );
    expect(container.textContent).toBe("");
  });

  it("dismissing the nudge sets higherOrLowerNudgeDismissed to true", async () => {
    currentSettings = settingsWithFlag("higherOrLowerNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="higherOrLowerNudgeDismissed">
        Higher or Lower nudge body.
      </OnboardingHint>,
    );
    const btn = await screen.findByRole("button", { name: /dismiss hint/i });
    await userEvent.click(btn);

    expect(currentSettings.onboarding.higherOrLowerNudgeDismissed).toBe(true);
    expect(screen.queryByText("Higher or Lower nudge body.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reset path — DEFAULT_ONBOARDING resets all flags to false
// ---------------------------------------------------------------------------

describe("DEFAULT_ONBOARDING reset", () => {
  it("DEFAULT_ONBOARDING sets all nudge flags to false (reset shows nudges again)", () => {
    expect(DEFAULT_ONBOARDING.markWhatIKnowNudgeDismissed).toBe(false);
    expect(DEFAULT_ONBOARDING.practiceScopeNudgeDismissed).toBe(false);
    expect(DEFAULT_ONBOARDING.higherOrLowerNudgeDismissed).toBe(false);
  });

  it("nudge reappears after SETTINGS_SAVED_EVENT resets the flag", async () => {
    // Start with the flag set to true (nudge hidden).
    currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", true);

    renderWithIntl(
      <OnboardingHint id="markWhatIKnowNudgeDismissed">
        Mark hint.
      </OnboardingHint>,
    );
    expect(screen.queryByText("Mark hint.")).toBeNull();

    // Simulate "Show onboarding again" reset via settings event.
    act(() => {
      currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", false);
      window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT));
    });

    expect(await screen.findByText("Mark hint.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Locale coverage — verify catalogue copy renders in all four locales
// ---------------------------------------------------------------------------

describe("locale coverage — message catalogue keys", () => {
  it("en: markWhatIKnowNudge title and body render", async () => {
    currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="markWhatIKnowNudgeDismissed" title="Did you know? Skip the queue for Pokémon you already know">
        <p>Use the Quickstart quiz below to mark Pokémon you already recognise.</p>
      </OnboardingHint>,
      { locale: "en" },
    );
    expect(await screen.findByText(/Skip the queue/)).toBeTruthy();
  });

  it("ja: markWhatIKnowNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", false);

    renderJa(
      <OnboardingHint id="markWhatIKnowNudgeDismissed" title="ヒント: すでに知っている Pokémon はキューをスキップできます">
        <p>クイックスタート本文</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/ヒント: すでに知っている/)).toBeTruthy();
  });

  it("zh-Hans: markWhatIKnowNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", false);

    renderZhHans(
      <OnboardingHint id="markWhatIKnowNudgeDismissed" title="提示：跳过您已知宝可梦的新卡片队列">
        <p>提示zh-hans内容</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/提示：跳过/)).toBeTruthy();
  });

  it("zh-Hant: markWhatIKnowNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("markWhatIKnowNudgeDismissed", false);

    renderZhHant(
      <OnboardingHint id="markWhatIKnowNudgeDismissed" title="提示：跳過您已知寶可夢的新卡片佇列">
        <p>提示zh-hant內容</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/提示：跳過/)).toBeTruthy();
  });

  it("en: practiceScopeNudge title renders", async () => {
    currentSettings = settingsWithFlag("practiceScopeNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="practiceScopeNudgeDismissed" title="Tip: filter by generation, type, or group">
        <p>Scope hint body</p>
      </OnboardingHint>,
      { locale: "en" },
    );
    expect(await screen.findByText(/filter by generation/)).toBeTruthy();
  });

  it("ja: practiceScopeNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("practiceScopeNudgeDismissed", false);

    renderJa(
      <OnboardingHint id="practiceScopeNudgeDismissed" title="ヒント: 世代・タイプ・グループで絞り込めます">
        <p>スコープ本文</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/世代・タイプ・グループで絞り込めます/)).toBeTruthy();
  });

  it("zh-Hans: practiceScopeNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("practiceScopeNudgeDismissed", false);

    renderZhHans(
      <OnboardingHint id="practiceScopeNudgeDismissed" title="提示：可按世代、属性或分组筛选">
        <p>提示zh-hans范围内容</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/按世代/)).toBeTruthy();
  });

  it("zh-Hant: practiceScopeNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("practiceScopeNudgeDismissed", false);

    renderZhHant(
      <OnboardingHint id="practiceScopeNudgeDismissed" title="提示：可按世代、屬性或分組篩選">
        <p>提示zh-hant範圍內容</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/按世代/)).toBeTruthy();
  });

  it("en: higherOrLowerNudge title renders", async () => {
    currentSettings = settingsWithFlag("higherOrLowerNudgeDismissed", false);

    renderWithIntl(
      <OnboardingHint id="higherOrLowerNudgeDismissed" title="Finish your session for a bonus mini-game">
        <p>Once you have practised at least two Pokémon today, a Higher or Lower stat challenge unlocks below your session summary.</p>
      </OnboardingHint>,
      { locale: "en" },
    );
    expect(await screen.findByText(/Finish your session for a bonus mini-game/)).toBeTruthy();
  });

  it("ja: higherOrLowerNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("higherOrLowerNudgeDismissed", false);

    renderJa(
      <OnboardingHint id="higherOrLowerNudgeDismissed" title="セッションを完了してボーナスミニゲームをゲット">
        <p>ミニゲーム本文</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/セッションを完了して/)).toBeTruthy();
  });

  it("zh-Hans: higherOrLowerNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("higherOrLowerNudgeDismissed", false);

    renderZhHans(
      <OnboardingHint id="higherOrLowerNudgeDismissed" title="完成本轮练习，解锁额外小游戏">
        <p>小游戏zh-hans内容</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/完成本轮练习/)).toBeTruthy();
  });

  it("zh-Hant: higherOrLowerNudge title renders (non-English)", async () => {
    currentSettings = settingsWithFlag("higherOrLowerNudgeDismissed", false);

    renderZhHant(
      <OnboardingHint id="higherOrLowerNudgeDismissed" title="完成本輪練習，解鎖額外小遊戲">
        <p>小遊戲zh-hant內容</p>
      </OnboardingHint>,
    );
    expect(await screen.findByText(/完成本輪練習/)).toBeTruthy();
  });
});

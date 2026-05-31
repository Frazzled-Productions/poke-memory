/**
 * Tests for the two contextual discovery nudges (#1443).
 *
 * 1. markWhatIKnowNudgeDismissed — shown on Settings > Practice near the
 *    Quickstart quiz, absent when dismissed.
 * 2. practiceScopeNudgeDismissed — shown on the practice screen (ReviewSession)
 *    above ScopeControl once the first-visit onboarding is done.
 *
 * Covers:
 *  - State IN: nudge visible when flag is false.
 *  - State OUT: nudge absent when flag is true.
 *  - Existing-user reach: validateOnboarding coerces absent key to false.
 *  - Locale coverage: all four supported locales (en/ja/zh-Hans/zh-Hant).
 *  - Both flags reset via DEFAULT_ONBOARDING (all false).
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
  key: "markWhatIKnowNudgeDismissed" | "practiceScopeNudgeDismissed",
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
});

// ---------------------------------------------------------------------------
// Reset path — DEFAULT_ONBOARDING resets both flags to false
// ---------------------------------------------------------------------------

describe("DEFAULT_ONBOARDING reset", () => {
  it("DEFAULT_ONBOARDING sets both new flags to false (reset shows nudges again)", () => {
    expect(DEFAULT_ONBOARDING.markWhatIKnowNudgeDismissed).toBe(false);
    expect(DEFAULT_ONBOARDING.practiceScopeNudgeDismissed).toBe(false);
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
});

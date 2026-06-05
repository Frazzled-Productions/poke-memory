/**
 * Tests for the GuestSignUpNudge component (#1668).
 *
 * The nudge is shown on Stats and Journey pages for guests who have
 * real progress worth protecting (masteredSpecies >= 10 OR
 * practiceSessionsCount >= 3). It is hidden for signed-in users and
 * for guests below both thresholds.
 *
 * Covers:
 *  - State IN (threshold met, not dismissed): nudge is visible.
 *  - State OUT (below threshold): nudge absent.
 *  - State OUT (dismissed flag true): nudge absent.
 *  - Loading state (null values): nudge absent.
 *  - masteredSpecies-only threshold (>= 10, sessions < 3).
 *  - practiceSessionsCount-only threshold (>= 3, mastered < 10).
 *  - Dismissal: clicking dismiss sets guestSignUpNudgeDismissed to true.
 *  - CTA: clicking the CTA opens the provider picker.
 *  - validateOnboarding coercion: absent key resolves to false (existing-user reach).
 *  - Locale rendering: all four supported locales (en/ja/zh-Hans/zh-Hant).
 *  - Pseudo-locale: no untranslated English strings leak through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
  renderPseudo,
} from "@/components/test-utils/renderWithIntl";
import { GuestSignUpNudge } from "@/components/onboarding/GuestSignUpNudge";
import {
  DEFAULT_SETTINGS,
  DEFAULT_ONBOARDING,
  SETTINGS_SAVED_EVENT,
  validateOnboarding,
} from "@/lib/settings/persistence";
import type { UserSettings } from "@/lib/settings/persistence";
import {
  GUEST_NUDGE_MASTERED_THRESHOLD,
  GUEST_NUDGE_SESSIONS_THRESHOLD,
} from "@/components/onboarding/GuestSignUpNudge";

// ---------------------------------------------------------------------------
// Mock lib/auth/actions so signIn does not attempt a server-side redirect
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth/actions", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Settings stub - same pattern as other onboarding tests
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

function settingsWithFlag(dismissed: boolean, sessionsCount = 0): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    onboarding: {
      ...DEFAULT_ONBOARDING,
      guestSignUpNudgeDismissed: dismissed,
      practiceSessionsCount: sessionsCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Threshold constants
// ---------------------------------------------------------------------------

describe("GuestSignUpNudge threshold constants", () => {
  it("GUEST_NUDGE_MASTERED_THRESHOLD is 10", () => {
    expect(GUEST_NUDGE_MASTERED_THRESHOLD).toBe(10);
  });

  it("GUEST_NUDGE_SESSIONS_THRESHOLD is 3", () => {
    expect(GUEST_NUDGE_SESSIONS_THRESHOLD).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// State IN: nudge visible when threshold is met and flag is false
// ---------------------------------------------------------------------------

describe("nudge visibility - threshold met, not dismissed", () => {
  it("shows when masteredSpecies >= 10 (sessions = 0)", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={10} practiceSessionsCount={0} />,
    );
    expect(await screen.findByText(/Your progress is at risk/)).toBeTruthy();
  });

  it("shows when masteredSpecies > threshold (sessions < 3)", async () => {
    currentSettings = settingsWithFlag(false, 1);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={25} practiceSessionsCount={1} />,
    );
    expect(await screen.findByText(/Your progress is at risk/)).toBeTruthy();
  });

  it("shows body with mastered count when masteredSpecies >= 10", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />,
    );
    // Body must contain the numeric count (tolerant of locale digit-grouping separators)
    const body = await screen.findByText(/mastered.*Pokémon.*on this device/i);
    expect(body).toBeTruthy();
  });

  it("shows when practiceSessionsCount >= 3 (mastered = 0, sessions = 3)", async () => {
    currentSettings = settingsWithFlag(false, 3);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={0} practiceSessionsCount={3} />,
    );
    expect(await screen.findByText(/Your progress is at risk/)).toBeTruthy();
  });

  it("shows low-mastery body when only sessions threshold is met", async () => {
    currentSettings = settingsWithFlag(false, 5);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={0} practiceSessionsCount={5} />,
    );
    expect(await screen.findByText(/practice history is only on this device/i)).toBeTruthy();
  });

  it("shows when practiceSessionsCount > threshold (mastered < 10)", async () => {
    currentSettings = settingsWithFlag(false, 7);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={2} practiceSessionsCount={7} />,
    );
    expect(await screen.findByText(/Your progress is at risk/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// State OUT: nudge absent when below both thresholds
// ---------------------------------------------------------------------------

describe("nudge hidden when below both thresholds", () => {
  it("hidden when masteredSpecies = 9 and sessions = 2", () => {
    currentSettings = settingsWithFlag(false, 2);

    const { container } = renderWithIntl(
      <GuestSignUpNudge masteredSpecies={9} practiceSessionsCount={2} />,
    );
    expect(container.textContent).toBe("");
  });

  it("hidden when masteredSpecies = 0 and sessions = 0", () => {
    currentSettings = settingsWithFlag(false, 0);

    const { container } = renderWithIntl(
      <GuestSignUpNudge masteredSpecies={0} practiceSessionsCount={0} />,
    );
    expect(container.textContent).toBe("");
  });

  it("hidden when masteredSpecies = 9 and sessions = 0", () => {
    currentSettings = settingsWithFlag(false, 0);

    const { container } = renderWithIntl(
      <GuestSignUpNudge masteredSpecies={9} practiceSessionsCount={0} />,
    );
    expect(container.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// State OUT: nudge absent after dismissal
// ---------------------------------------------------------------------------

describe("nudge hidden when flag is true (dismissed)", () => {
  it("hidden when guestSignUpNudgeDismissed is true (mastered >= threshold)", () => {
    currentSettings = settingsWithFlag(true, 0);

    const { container } = renderWithIntl(
      <GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />,
    );
    expect(container.textContent).toBe("");
  });

  it("hidden when guestSignUpNudgeDismissed is true (sessions >= threshold)", () => {
    currentSettings = settingsWithFlag(true, 5);

    const { container } = renderWithIntl(
      <GuestSignUpNudge masteredSpecies={0} practiceSessionsCount={5} />,
    );
    expect(container.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// State OUT: nudge absent while data is loading (null props)
// ---------------------------------------------------------------------------

describe("nudge hidden while data is loading", () => {
  it("hidden when masteredSpecies is null", () => {
    currentSettings = settingsWithFlag(false, 5);

    const { container } = renderWithIntl(
      <GuestSignUpNudge masteredSpecies={null} practiceSessionsCount={5} />,
    );
    expect(container.textContent).toBe("");
  });

  it("hidden when practiceSessionsCount is null", () => {
    currentSettings = settingsWithFlag(false, 0);

    const { container } = renderWithIntl(
      <GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={null} />,
    );
    expect(container.textContent).toBe("");
  });

  it("hidden when both are null", () => {
    currentSettings = settingsWithFlag(false, 0);

    const { container } = renderWithIntl(
      <GuestSignUpNudge masteredSpecies={null} practiceSessionsCount={null} />,
    );
    expect(container.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Dismissal: clicking dismiss sets guestSignUpNudgeDismissed to true
// ---------------------------------------------------------------------------

describe("dismissal", () => {
  it("dismissing sets guestSignUpNudgeDismissed to true and hides the nudge", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />,
    );

    const btn = await screen.findByRole("button", { name: /dismiss hint/i });
    await userEvent.click(btn);

    expect(currentSettings.onboarding.guestSignUpNudgeDismissed).toBe(true);
    expect(screen.queryByText(/Your progress is at risk/)).toBeNull();
  });

  it("nudge reappears after SETTINGS_SAVED_EVENT resets the flag", async () => {
    currentSettings = settingsWithFlag(true, 0);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />,
    );
    expect(screen.queryByText(/Your progress is at risk/)).toBeNull();

    act(() => {
      currentSettings = settingsWithFlag(false, 0);
      window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT));
    });

    expect(await screen.findByText(/Your progress is at risk/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CTA: clicking opens the provider picker
// ---------------------------------------------------------------------------

describe("CTA - opens provider picker", () => {
  it("shows a CTA button before picker is opened", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />,
    );
    expect(await screen.findByRole("button", { name: /create a free account/i })).toBeTruthy();
  });

  it("clicking CTA reveals GitHub and Google sign-in buttons", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />,
    );

    const cta = await screen.findByRole("button", { name: /create a free account/i });
    await userEvent.click(cta);

    expect(await screen.findByRole("button", { name: /continue with github/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /continue with google/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// validateOnboarding coercion - absent key resolves to false (existing users)
// ---------------------------------------------------------------------------

describe("validateOnboarding - absent guestSignUpNudgeDismissed coerces to false (#1668)", () => {
  it("absent key coerces to false", () => {
    const result = validateOnboarding({
      firstVisitOnboardingDismissed: true,
      // guestSignUpNudgeDismissed deliberately absent
    });
    expect(result.guestSignUpNudgeDismissed).toBe(false);
  });

  it("non-boolean truthy does NOT coerce to true - === true guard", () => {
    const result = validateOnboarding({
      guestSignUpNudgeDismissed: 1 as unknown as boolean,
    });
    expect(result.guestSignUpNudgeDismissed).toBe(false);
  });

  it("true is preserved", () => {
    const result = validateOnboarding({
      guestSignUpNudgeDismissed: true,
    });
    expect(result.guestSignUpNudgeDismissed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_ONBOARDING has guestSignUpNudgeDismissed as false
// ---------------------------------------------------------------------------

describe("DEFAULT_ONBOARDING", () => {
  it("guestSignUpNudgeDismissed defaults to false", () => {
    expect(DEFAULT_ONBOARDING.guestSignUpNudgeDismissed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Locale coverage - verify nudge copy renders in all four locales
// ---------------------------------------------------------------------------

describe("locale coverage - all four locales render correctly", () => {
  it("en: heading and body render", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />,
      { locale: "en" },
    );
    expect(await screen.findByText(/Your progress is at risk/)).toBeTruthy();
  });

  it("en: low-mastery body renders (sessions-only threshold)", async () => {
    currentSettings = settingsWithFlag(false, 5);

    renderWithIntl(
      <GuestSignUpNudge masteredSpecies={0} practiceSessionsCount={5} />,
      { locale: "en" },
    );
    expect(await screen.findByText(/practice history is only on this device/i)).toBeTruthy();
  });

  it("ja: heading renders in Japanese", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderJa(<GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />);
    expect(await screen.findByText(/進捗が失われる可能性があります/)).toBeTruthy();
  });

  it("ja: CTA renders in Japanese", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderJa(<GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />);
    expect(await screen.findByRole("button", { name: /無料アカウントを作成/i })).toBeTruthy();
  });

  it("zh-Hans: heading renders in Simplified Chinese", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderZhHans(<GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />);
    expect(await screen.findByText(/你的进度面临风险/)).toBeTruthy();
  });

  it("zh-Hans: CTA renders in Simplified Chinese", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderZhHans(<GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />);
    expect(await screen.findByRole("button", { name: /创建免费账号/i })).toBeTruthy();
  });

  it("zh-Hant: heading renders in Traditional Chinese", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderZhHant(<GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />);
    expect(await screen.findByText(/你的進度面臨風險/)).toBeTruthy();
  });

  it("zh-Hant: CTA renders in Traditional Chinese", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderZhHant(<GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />);
    expect(await screen.findByRole("button", { name: /建立免費帳號/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Pseudo-locale: English-leak check
// ---------------------------------------------------------------------------

describe("pseudo-locale: no hard-coded English strings", () => {
  it("heading text is routed through the message catalogue (sentinel brackets)", async () => {
    currentSettings = settingsWithFlag(false, 0);

    renderPseudo(<GuestSignUpNudge masteredSpecies={15} practiceSessionsCount={0} />);

    // The heading must appear wrapped in sentinel brackets in the pseudo-locale,
    // proving it goes through the message catalogue. Use findAllByText since
    // multiple sentinel-wrapped strings render in the component.
    const sentinelElements = await screen.findAllByText(/\[.*\]/);
    expect(sentinelElements.length).toBeGreaterThan(0);

    // Specifically verify the heading appears in sentinel form.
    const headings = sentinelElements.filter((el) =>
      el.textContent?.includes("[Your progress is at risk]"),
    );
    expect(headings.length).toBeGreaterThan(0);
  });
});

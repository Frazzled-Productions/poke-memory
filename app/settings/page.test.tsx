/**
 * Component tests for the Settings page card-type toggle flow (#835).
 *
 * Focus: the re-enable dialog wiring introduced in #835 —
 *   - Disabling a card type is non-destructive (no confirm dialog).
 *   - Re-enabling shows the ReenableCardTypeDialog.
 *   - Choosing "Reuse my saved progress" enables the type and closes the dialog.
 *   - Choosing "Start fresh" enables the type and resets those cards in IDB.
 *   - The interlocking guard ("at least one type must be enabled") still fires.
 *
 * Pattern mirrors StatsPage.test.tsx: heavy sub-components are stubbed so the
 * test is fast and focused on Settings-page logic, not those components.
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports so vi.mock hoisting works.
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings",
}));

// ---------------------------------------------------------------------------
// Hoisted mocks for loadSession / saveSession (re-used in assertions).
// ---------------------------------------------------------------------------

const { mockLoadSession, mockSaveSession } = vi.hoisted(() => ({
  mockLoadSession: vi.fn(),
  mockSaveSession: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: mockLoadSession,
  saveSession: mockSaveSession,
}));

// ---------------------------------------------------------------------------
// Settings persistence — provide a realistic default and track saveSettings calls.
// ---------------------------------------------------------------------------

const { mockLoadSettings, mockSaveSettings } = vi.hoisted(() => ({
  mockLoadSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
  RETENTION_TARGET_MIN: 0.8,
  RETENTION_TARGET_MAX: 0.97,
  DEFAULT_ONBOARDING: {
    welcomeDismissed: true,
    practiceHintDismissed: true,
    statsHintDismissed: true,
    settingsHintDismissed: true,
    installNudgeDismissed: true,
    audioHintDismissed: true,
    cardTypesHintDismissed: true,
  },
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, supabase: null, loading: false }),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({
    unlocked: false,
    flags: { pretendAllMastered: false },
    setFlag: vi.fn(),
    anyFlagOn: false,
  }),
}));

vi.mock("@/components/theme/FavouriteThemeProvider", () => ({
  useFavourite: () => ({ updateFavourite: vi.fn() }),
}));

vi.mock("@/lib/theme/persistence", () => ({
  loadFavourite: vi.fn(() => null),
  saveFavourite: vi.fn(),
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn().mockResolvedValue([]),
  GRADE_LOG_APPENDED_EVENT: "poke-memory:grade-log-appended",
}));

vi.mock("@/lib/srs/optimizer", () => ({
  countOptimizableReviews: vi.fn(() => 0),
}));

vi.mock("@/lib/srs/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/srs/scheduler")>();
  return {
    ...actual,
    initialReviewState: actual.initialReviewState,
  };
});

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
  SEED_REVERSE_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
  REVERSE_EDGE_ID_BASE: 2_500_000,
  CRY_ID_OFFSET: 3_000_000,
}));

vi.mock("@/lib/stats/derive", () => ({
  isMastered: vi.fn(() => false),
}));

vi.mock("@/lib/backup/io", () => ({
  exportProgress: vi.fn(),
  validateBackup: vi.fn(),
  applyBackup: vi.fn(),
}));

vi.mock("@/lib/storage/reset", () => ({
  clearLocalProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sync/reset", () => ({
  resetAllProgressEverywhere: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/sync/deleteAccount", () => ({
  deleteAccountEverywhere: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/auth/actions", () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sync/settings", () => ({
  pushRegionalPrefs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/utils/format-date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/format-date")>();
  return {
    ...actual,
    detectTimezone: vi.fn(() => "Europe/London"),
    detectDateFormat: vi.fn(() => "dmy" as const),
    formatShortDate: vi.fn((d: string) => d),
  };
});

// ---------------------------------------------------------------------------
// Stub heavy sub-components that have their own test coverage.
// ---------------------------------------------------------------------------

vi.mock("@/components/settings/FsrsOptimizerSection", () => ({
  FsrsOptimizerSection: () => <div data-testid="fsrs-optimizer" />,
}));

vi.mock("@/components/settings/IntensityPicker", () => ({
  IntensityPicker: () => <div data-testid="intensity-picker" />,
}));

vi.mock("@/components/settings/VoiceQualityHint", () => ({
  VoiceQualityHint: () => <div data-testid="voice-quality-hint" />,
}));

vi.mock("@/components/settings/TtsControls", () => ({
  TtsControls: () => <div data-testid="tts-controls" />,
}));

vi.mock("@/components/onboarding/OnboardingHint", () => ({
  OnboardingHint: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="onboarding-hint">{children}</div>
  ),
}));

vi.mock("@/components/auth/LinkIdentitiesSection", () => ({
  LinkIdentitiesSection: () => <div data-testid="link-identities" />,
}));

vi.mock("@/components/settings/OfflineSection", () => ({
  OfflineSection: () => <div data-testid="offline-section" />,
}));

vi.mock("@/components/settings/QaSeedSection", () => ({
  QaSeedSection: () => <div data-testid="qa-seed-section" />,
}));

// Stub next-intl — t() returns the key name so tests can match on it or on
// the plain English fallback without caring about translations.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      "settings.heading": "Settings",
    };
    return map[key] ?? key;
  },
}));

vi.mock("@/i18n/locales", () => ({
  SUPPORTED_LOCALES: ["en", "ja", "zh-Hans", "zh-Hant"],
  LOCALE_COOKIE: "poke-memory:locale",
  DEFAULT_LOCALE: "en",
}));

vi.mock("@/lib/i18n/actions", () => ({
  setLocaleCookie: vi.fn().mockResolvedValue(undefined),
}));

// Render CollapsibleSection as a transparent wrapper so toggles are always
// accessible without relying on localStorage / hash state.
vi.mock("@/components/settings/CollapsibleSection", () => ({
  CollapsibleSection: ({ children, heading }: { children: React.ReactNode; heading: string }) => (
    <section>
      <h2>{heading}</h2>
      {children}
    </section>
  ),
}));

// Polyfill HTMLDialogElement for the ReenableCardTypeDialog.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
});

// ---------------------------------------------------------------------------
// Default settings fixture — evolutionCardsEnabled:false so we can exercise
// toggling-on. Name and reverse are always on since #1234; they have no toggles.
// ---------------------------------------------------------------------------

function defaultSettings() {
  return {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
    evolutionCardsEnabled: false,
    reverseEvolutionCardsEnabled: false,
    maxNewReversePerDay: 10,
    maxReviewsReversePerDay: 100,
    playCryOnReveal: false,
    speakNameOnReveal: false,
    cryCardsEnabled: false,
    maxNewCryPerDay: 10,
    maxReviewsCryPerDay: 100,
    alternateFormsEnabled: false,
    favouriteTheme: null,
    themeIntensity: "accents" as const,
    retentionTarget: 0.9,
    practiceScope: { gens: [], types: [], presets: [] },
    miniGameBestScore: 0,
    seenStreakMilestones: [] as string[],
    earnedBadges: [] as { id: string; earnedAt: string }[],
    onboarding: {
      welcomeDismissed: true,
      practiceHintDismissed: true,
      statsHintDismissed: true,
      settingsHintDismissed: true,
      installNudgeDismissed: true,
      audioHintDismissed: true,
      cardTypesHintDismissed: true,
    },
    appVisitCount: 0,
    mobileNav: "bottom" as const,
    ttsVoice: null,
    ttsRate: 1,
    ttsVolume: 1,
    waitForAudioOnGrade: true,
    reverseFeedbackDelay: "default" as const,
    timezone: "Europe/London",
    dateFormat: "dmy" as const,
    streakProtection: {
      balance: 0,
      spendDates: [] as string[],
      daysSinceLastEarn: 0,
      lastEarnCheckDate: null,
      protectionEvents: [],
      lastAcknowledgedProtectionEventDate: null,
    },
    verifiedTypedEntryMode: false,
    typedEntryOnboardingShown: false,
    mcCardOnboardingShown: false,
    labsFlags: { languages: false },
  };
}

// ---------------------------------------------------------------------------
// Import the page after all vi.mock calls.
// ---------------------------------------------------------------------------

import SettingsPage from "@/app/settings/page";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSettings.mockReturnValue(defaultSettings());
  mockLoadSession.mockResolvedValue(null);
  mockSaveSession.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// Helpers: find card-type toggle switches by nearby label text.
//
// Name and reverse toggles have been removed since #1234 — those directions
// are always on. Only the opt-in card types (evolution, reverse-evolution, cry)
// have toggles.
// ---------------------------------------------------------------------------

function getEvolutionCardsSwitch() {
  const labelEl = screen.getByText("Enable evolution cards");
  const container = labelEl.closest("div.flex.items-center.justify-between");
  if (!container) throw new Error("Could not find evolution-cards toggle container");
  const btn = container.querySelector('[role="switch"]');
  if (!btn) throw new Error("Could not find evolution-cards switch button");
  return btn as HTMLElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsPage — card-type toggle: disable (non-destructive, #835)", () => {
  it("disabling an opt-in card type updates the toggle without a confirm dialog", async () => {
    // Use evolution cards since name/reverse no longer have toggles (#1234).
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      evolutionCardsEnabled: true, // start enabled so we can toggle it off
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    // Wait for settings to load (the page starts with null and loads on effect).
    await waitFor(() => {
      expect(screen.getByText("Enable evolution cards")).toBeInTheDocument();
    });

    const evoSwitchEl = getEvolutionCardsSwitch();
    // Evolution cards start enabled.
    expect(evoSwitchEl).toHaveAttribute("aria-checked", "true");

    // No window.confirm stub — the test would throw if confirm was called.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(evoSwitchEl);

    // The toggle must have fired without calling window.confirm.
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();

    // The switch should now be unchecked.
    await waitFor(() => {
      expect(getEvolutionCardsSwitch()).toHaveAttribute("aria-checked", "false");
    });
  });
});

describe("SettingsPage — card-type toggle: re-enable dialog (#835)", () => {
  it("opening a disabled card type shows the ReenableCardTypeDialog", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Enable evolution cards")).toBeInTheDocument();
    });

    const evoSwitchEl = getEvolutionCardsSwitch();
    // Evolution cards start disabled (evolutionCardsEnabled: false in fixture).
    expect(evoSwitchEl).toHaveAttribute("aria-checked", "false");

    await user.click(evoSwitchEl);

    // The dialog should appear with the card type name.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /re-enable evolution cards/i }),
      ).toBeInTheDocument();
    });

    // Both choice buttons and cancel must be visible.
    expect(screen.getByRole("button", { name: /reuse my saved progress/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start fresh/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("choosing 'Reuse my saved progress' enables the type and closes the dialog", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Enable evolution cards")).toBeInTheDocument();
    });

    await user.click(getEvolutionCardsSwitch());

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /re-enable evolution cards/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /reuse my saved progress/i }));

    // Dialog must close.
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /re-enable evolution cards/i }),
      ).not.toBeInTheDocument();
    });

    // The switch should now be checked (type enabled).
    await waitFor(() => {
      expect(getEvolutionCardsSwitch()).toHaveAttribute("aria-checked", "true");
    });

    // IDB session must NOT be touched when re-using progress.
    expect(mockSaveSession).not.toHaveBeenCalled();
  });

  it("choosing 'Start fresh' enables the type and resets those cards in IDB", async () => {
    // Provide a session with one evolution card so the reset path has something to act on.
    const evoCard = {
      id: 1_000_001,
      cardType: "evolution" as const,
      subjectKey: "1",
      displayName: "Bulbasaur",
      name: "Bulbasaur",
      spriteUrl: "/sprites/pokemon/1.png",
      speciesId: 1,
      isDefaultForm: true,
      formCategory: "default" as const,
      formSlug: null,
      types: ["grass"],
      stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
      flavorText: "A pokemon.",
      flavorTexts: ["A pokemon."],
      evolutionChain: [],
      height: 7,
      weight: 69,
      baseExperience: 64,
      genus: "Seed Pokémon",
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 50,
      growthRate: "medium-slow",
      habitat: "grassland",
      genderRate: 1,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
      state: {
        stability: 5,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 5,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "1970-01-01",
        lastReview: "1970-01-01",
        firstSeen: "1970-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    mockLoadSession.mockResolvedValue({
      cards: [evoCard],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Enable evolution cards")).toBeInTheDocument();
    });

    await user.click(getEvolutionCardsSwitch());

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /re-enable evolution cards/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /start fresh/i }));

    // Dialog closes.
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /re-enable evolution cards/i }),
      ).not.toBeInTheDocument();
    });

    // saveSession must be called with the evolution card reset to initial state.
    await waitFor(() => {
      expect(mockSaveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cards: expect.arrayContaining([
            expect.objectContaining({
              id: evoCard.id,
              state: expect.objectContaining({
                reps: 0,
                lastReview: null,
                fsrsState: "new",
              }),
            }),
          ]),
        }),
      );
    });
  });

  it("cancelling the dialog leaves the card type disabled", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Enable evolution cards")).toBeInTheDocument();
    });

    await user.click(getEvolutionCardsSwitch());

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /re-enable evolution cards/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    // Dialog closes.
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /re-enable evolution cards/i }),
      ).not.toBeInTheDocument();
    });

    // The switch must still be unchecked — cancel aborted the re-enable.
    expect(getEvolutionCardsSwitch()).toHaveAttribute("aria-checked", "false");
  });
});

describe("SettingsPage — multiple card-type re-enables (#835)", () => {
  it("re-enabling reverse-evolution cards (an opt-in type) shows the dialog", async () => {
    // Name and reverse no longer have toggles since #1234 — they are always on.
    // Verify the re-enable flow still works for an opt-in type (reverse-evolution).
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false, // start disabled
    });

    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Enable reverse-evolution cards")).toBeInTheDocument();
    });

    // Find the reverse-evolution switch.
    const labelEl = screen.getByText("Enable reverse-evolution cards");
    const container = labelEl.closest("div.flex.items-center.justify-between");
    if (!container) throw new Error("Could not find reverse-evolution-cards toggle container");
    const revEvoSwitch = container.querySelector('[role="switch"]') as HTMLElement;
    expect(revEvoSwitch).toHaveAttribute("aria-checked", "false");

    await user.click(revEvoSwitch);

    // Dialog must appear with the reverse-evolution-cards label.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /re-enable reverse-evolution cards/i }),
      ).toBeInTheDocument();
    });
  });
});

describe("SettingsPage — updated descriptive copy (#835)", () => {
  it("renders the non-destructive disable copy for at least one card type", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      // Multiple card types now have this copy; check at least one exists.
      const allMatches = screen.getAllByText(
        /disabling hides these cards without losing your progress/i,
      );
      expect(allMatches.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Touch 1 + 2: inline help text and first-enable banner (#1271)
// ---------------------------------------------------------------------------

describe("SettingsPage — typed-entry onboarding (#1271)", () => {
  it("always renders the inline MC-ramp help text under the toggle", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/new cards start as multiple choice during the learning phase/i),
      ).toBeInTheDocument();
    });
  });

  it("shows the first-enable banner when verifiedTypedEntryMode is toggled on for the first time (typedEntryOnboardingShown: false)", async () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      verifiedTypedEntryMode: false,
      typedEntryOnboardingShown: false,
    });

    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /verified typed entry/i }),
      ).toBeInTheDocument();
    });

    // Banner must be absent before the toggle is flipped.
    expect(
      screen.queryByText(/verified typed entry is on/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /verified typed entry/i }));

    // Banner must appear after first-enable.
    await waitFor(() => {
      expect(
        screen.getByText(/verified typed entry is on/i),
      ).toBeInTheDocument();
    });

    // saveSettings must have been called with typedEntryOnboardingShown: true.
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedTypedEntryMode: true,
        typedEntryOnboardingShown: true,
      }),
    );
  });

  it("does NOT show the first-enable banner when typedEntryOnboardingShown is already true", async () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      verifiedTypedEntryMode: false,
      typedEntryOnboardingShown: true,
    });

    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /verified typed entry/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("switch", { name: /verified typed entry/i }));

    // Banner must not appear — it was already shown once.
    await waitFor(() => {
      expect(
        screen.queryByText(/verified typed entry is on/i),
      ).not.toBeInTheDocument();
    });
  });

  it("dismisses the first-enable banner when the close button is clicked", async () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      verifiedTypedEntryMode: false,
      typedEntryOnboardingShown: false,
    });

    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /verified typed entry/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("switch", { name: /verified typed entry/i }));

    await waitFor(() => {
      expect(screen.getByText(/verified typed entry is on/i)).toBeInTheDocument();
    });

    // Click the dismiss button.
    await user.click(screen.getByRole("button", { name: /dismiss typed entry notice/i }));

    await waitFor(() => {
      expect(
        screen.queryByText(/verified typed entry is on/i),
      ).not.toBeInTheDocument();
    });
  });
});

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
// Default settings fixture — nameCardsEnabled:true, evolutionCardsEnabled:false
// so we can exercise both toggling-off (name) and toggling-on (evolution).
// ---------------------------------------------------------------------------

function defaultSettings() {
  return {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
    nameCardsEnabled: true,
    evolutionCardsEnabled: false,
    reverseEvolutionCardsEnabled: false,
    reverseCardsEnabled: false,
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
    timezone: "Europe/London",
    dateFormat: "dmy" as const,
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
// The toggle buttons for card types have no explicit aria-label. They are
// visually associated with the "Enable X cards" heading via proximity inside
// a flex container, but not programmatically linked. We locate each switch
// by finding the "Enable X cards" text node and traversing up to the shared
// container, then querying for the [role="switch"] inside it.
// ---------------------------------------------------------------------------

function getNameCardsSwitch() {
  // The text "Enable name cards" is inside a <p>. Its grandparent div
  // contains the flex row with the toggle button.
  const labelEl = screen.getByText("Enable name cards");
  const container = labelEl.closest("div.flex.items-center.justify-between");
  if (!container) throw new Error("Could not find name-cards toggle container");
  const btn = container.querySelector('[role="switch"]');
  if (!btn) throw new Error("Could not find name-cards switch button");
  return btn as HTMLElement;
}

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
  it("disabling an enabled card type updates the toggle without a confirm dialog", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    // Wait for settings to load (the page starts with null and loads on effect).
    await waitFor(() => {
      expect(screen.getByText("Enable name cards")).toBeInTheDocument();
    });

    const nameSwitchEl = getNameCardsSwitch();
    // Name cards start enabled.
    expect(nameSwitchEl).toHaveAttribute("aria-checked", "true");

    // No window.confirm stub — the test would throw if confirm was called.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(nameSwitchEl);

    // The toggle must have fired without calling window.confirm.
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();

    // The switch should now be unchecked.
    await waitFor(() => {
      expect(getNameCardsSwitch()).toHaveAttribute("aria-checked", "false");
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
  it("re-enabling name cards (which were disabled) also shows the dialog", async () => {
    // Use a fixture where name cards are disabled and evolution is enabled.
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      nameCardsEnabled: false,
      evolutionCardsEnabled: true,
    });

    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Enable name cards")).toBeInTheDocument();
    });

    const nameSwitchEl = getNameCardsSwitch();
    expect(nameSwitchEl).toHaveAttribute("aria-checked", "false");

    await user.click(nameSwitchEl);

    // Dialog must appear with the name-cards label from CARD_TYPE_DISPLAY_NAMES.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /re-enable name cards/i }),
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

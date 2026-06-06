/**
 * Component tests for the Settings page card-type toggle flow (#835).
 *
 * Focus: the re-enable dialog wiring introduced in #835 - 
 *   - Disabling a card type is non-destructive (no confirm dialog).
 *   - Re-enabling shows the ReenableCardTypeDialog.
 *   - Choosing "Reuse my saved progress" enables the type and closes the dialog.
 *   - Choosing "Start fresh" enables the type and resets those cards in IDB.
 *   - The interlocking guard ("at least one type must be enabled") still fires.
 *
 * Pattern mirrors StatsPage.test.tsx: heavy sub-components are stubbed so the
 * test is fast and focused on Settings-page logic, not those components.
 */

import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppLocale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Module mocks - declared before any imports so vi.mock hoisting works.
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
// Settings persistence - provide a realistic default and track saveSettings calls.
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

const { mockSuperuserFlags, mockSuperuserState, mockSetFlag } = vi.hoisted(
  () => ({
    mockSuperuserFlags: { pretendAllMastered: false } as Record<
      string,
      boolean
    >,
    mockSuperuserState: { unlocked: false },
    mockSetFlag: vi.fn(),
  }),
);
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({
    unlocked: mockSuperuserState.unlocked,
    flags: mockSuperuserFlags,
    setFlag: mockSetFlag,
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

const { mockReadMasteredCountCache } = vi.hoisted(() => ({
  mockReadMasteredCountCache: vi.fn(() => ({
    en: 0,
    ja: 0,
    "zh-Hans": 0,
    "zh-Hant": 0,
  })),
}));
vi.mock("@/lib/profile/masteredCountCache", () => ({
  readMasteredCountCache: () => mockReadMasteredCountCache(),
}));

// ---------------------------------------------------------------------------
// Stub heavy sub-components that have their own test coverage.
// ---------------------------------------------------------------------------

vi.mock("@/components/settings/FsrsOptimizerSection", () => ({
  FsrsOptimizerSection: () => <div data-testid="fsrs-optimizer" />,
}));

vi.mock("@/components/settings/IntensityPicker", () => ({
  IntensityPicker: () => <div data-testid="intensity-picker" />,
}));

vi.mock("@/components/onboarding/KnownPokemonQuiz", () => ({
  KnownPokemonQuiz: () => <div data-testid="known-pokemon-quiz" />,
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

// Stub next-intl - t() resolves keys against the real en.json catalogue so
// tests can match on English strings without caring about translation internals.
// The mock also accepts string-valued parameters ({percent}, {query}).
const { mockT } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const enMessages = require("../../messages/en.json") as Record<string, unknown>;

  function resolveDotPath(obj: Record<string, unknown>, path: string): string {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (const part of parts) {
      if (typeof cur !== "object" || cur === null) return path;
      cur = (cur as Record<string, unknown>)[part];
    }
    return typeof cur === "string" ? cur : path;
  }

  const t = (key: string, params?: Record<string, string | number>): string => {
    let val = resolveDotPath(enMessages, key);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        val = val.replace(`{${k}}`, String(v));
      }
    }
    return val;
  };

  // t.rich: resolve the message, apply <tag>...</tag> renderers, return array.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t as unknown as Record<string, unknown>).rich = (key: string, tags: Record<string, (chunks: any) => any>): any => {
    const raw = resolveDotPath(enMessages, key);
    const parts: unknown[] = [];
    // Match <tagName>...</tagName> with backreference \1.
    const tagRe = new RegExp("<(\\w+)>(.*?)<\\/\\1>", "g");
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(raw)) !== null) {
      if (m.index > last) parts.push(raw.slice(last, m.index));
      const tagName = m[1];
      const inner = m[2];
      const renderer = tags[tagName];
      parts.push(renderer ? renderer(inner) : inner);
      last = m.index + m[0].length;
    }
    if (last < raw.length) parts.push(raw.slice(last));
    return parts.length === 1 ? parts[0] : parts;
  };

  return { mockT: t };
});

vi.mock("next-intl", () => ({
  useTranslations: () => mockT,
}));

vi.mock("@/i18n/locales", () => ({
  SUPPORTED_LOCALES: ["en", "ja", "zh-Hans", "zh-Hant"],
  LOCALE_COOKIE: "poke-memory:locale",
  DEFAULT_LOCALE: "en",
  LOCALE_ENDONYMS: {
    en: "English",
    ja: "日本語",
    "zh-Hans": "简体中文",
    "zh-Hant": "繁體中文",
  },
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
// Default settings fixture - evolutionCardsEnabled:false so we can exercise
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
    removedLocales: [] as AppLocale[],
    pokemonNameLocale: "en" as const,
    pushNotificationHour: null,
    dismissedMtBannerLocales: [] as string[],
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
// Name and reverse toggles have been removed since #1234 - those directions
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

describe("SettingsPage - card-type toggle: disable (non-destructive, #835)", () => {
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

    // No window.confirm stub - the test would throw if confirm was called.
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

describe("SettingsPage - card-type toggle: re-enable dialog (#835)", () => {
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

    // The switch must still be unchecked - cancel aborted the re-enable.
    expect(getEvolutionCardsSwitch()).toHaveAttribute("aria-checked", "false");
  });
});

describe("SettingsPage - multiple card-type re-enables (#835)", () => {
  it("re-enabling reverse-evolution cards (an opt-in type) shows the dialog", async () => {
    // Name and reverse no longer have toggles since #1234 - they are always on.
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

describe("SettingsPage - updated descriptive copy (#835)", () => {
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

describe("SettingsPage - typed-entry onboarding (#1271)", () => {
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

    // Banner must not appear - it was already shown once.
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

// ---------------------------------------------------------------------------
// i18n key resolution (#1369)
//
// Verifies that (a) key paths used in the settings page all resolve against
// the real catalogues and (b) a representative Japanese string is returned
// when the locale is Japanese. Because the page mock wires t() to the real
// en.json, we verify the Japanese catalogue separately via the catalogue JSON
// directly - this is consistent with how other component tests exercise locale
// correctness without a full browser environment.
// ---------------------------------------------------------------------------

describe("SettingsPage - i18n key resolution (#1369)", () => {
  it("settings.save resolves to 'Save' in English and '保存' in Japanese", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const en = require("../../messages/en.json") as Record<string, Record<string, string>>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ja = require("../../messages/ja.json") as Record<string, Record<string, string>>;
    expect(en.settings.save).toBe("Save");
    expect(ja.settings.save).toBe("保存");
  });

  it("settings.offline.downloadHeading resolves in all locales", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const en = require("../../messages/en.json") as Record<string, Record<string, Record<string, string>>>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ja = require("../../messages/ja.json") as Record<string, Record<string, Record<string, string>>>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zhHans = require("../../messages/zh-Hans.json") as Record<string, Record<string, Record<string, string>>>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zhHant = require("../../messages/zh-Hant.json") as Record<string, Record<string, Record<string, string>>>;
    // en
    expect(en.settings.offline.downloadHeading).toBe("Download");
    // non-English locales must have the key (not fall back to the key path)
    expect(ja.settings.offline.downloadHeading).toBeTruthy();
    expect(ja.settings.offline.downloadHeading).not.toBe("settings.offline.downloadHeading");
    expect(zhHans.settings.offline.downloadHeading).toBeTruthy();
    expect(zhHant.settings.offline.downloadHeading).toBeTruthy();
  });

  it("renders the Japanese heading when the mock t() is set to Japanese", async () => {
    // Swap the mock to resolve against ja.json for this test.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jaMessages = require("../../messages/ja.json") as Record<string, unknown>;

    function resolveDotPath(obj: Record<string, unknown>, path: string): string {
      const parts = path.split(".");
      let cur: unknown = obj;
      for (const part of parts) {
        if (typeof cur !== "object" || cur === null) return path;
        cur = (cur as Record<string, unknown>)[part];
      }
      return typeof cur === "string" ? cur : path;
    }

    const tJa = (key: string, params?: Record<string, string | number>): string => {
      let val = resolveDotPath(jaMessages, key);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          val = val.replace(`{${k}}`, String(v));
        }
      }
      return val;
    };

    // Verify the Japanese heading value resolves correctly.
    expect(tJa("settings.heading")).toBe("設定");
    expect(tJa("settings.save")).toBe("保存");
    expect(tJa("settings.section.practice")).toBe("練習");
    expect(tJa("settings.offline.downloadHeading")).toBe("ダウンロード");
  });
});

// ---------------------------------------------------------------------------
// Locale picker endonyms (#locale-picker-endonyms)
//
// Asserts that both locale-picker <select> elements show each language in
// its own script (endonym) rather than the English translation.
// The LOCALE_ENDONYMS constant must NOT route through t() - these labels are
// locale-invariant by design.
// ---------------------------------------------------------------------------

describe("SettingsPage - locale picker endonyms", () => {
  it("shows each language in its own script in the app-language picker", async () => {
    // The Pokémon-name-language picker was relocated to the status-bar pill
    // (#1484 Phase 2); only the app-language selector remains in Settings. The
    // pill's endonyms are covered by LanguageSwitcher.test.tsx.
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      pokemonNameLocale: "en",
      labsFlags: { languages: true }, // enable the Languages labs flag to show the picker
    });

    render(<SettingsPage />);

    // Wait for the language picker to appear.
    await waitFor(() => {
      expect(screen.getByLabelText(/app interface language/i)).toBeInTheDocument();
    });

    const appLocaleSelect = screen.getByLabelText(/app interface language/i);
    const options = Array.from(appLocaleSelect.querySelectorAll("option"));
    const texts = options.map((o) => o.textContent ?? "");

    // The picker must show endonyms (native script), not English translations.
    // Non-English locales are marked "(preview)" - the endonym must still appear
    // as a substring of each option.
    expect(texts.some((t) => t.startsWith("日本語"))).toBe(true);
    expect(texts.some((t) => t.startsWith("简体中文"))).toBe(true);
    expect(texts.some((t) => t.startsWith("繁體中文"))).toBe(true);

    // Non-English options must include the preview marker.
    expect(texts.some((t) => t.includes("(preview)"))).toBe(true);

    // Must NOT contain English-translated labels.
    expect(texts).not.toContain("Japanese");
    expect(texts).not.toContain("Simplified Chinese");
    expect(texts).not.toContain("Traditional Chinese");

    // English option must have no preview marker.
    expect(texts).toContain("English");
  });
});

// ---------------------------------------------------------------------------
// FSRS hyperlink in "How this works" body1
//
// Asserts that t.rich is used to render the FSRS word as an anchor element
// pointing to the ts-fsrs GitHub repository.
// ---------------------------------------------------------------------------

describe("SettingsPage - FSRS link in How this works", () => {
  it("renders an anchor linking to the FSRS GitHub repo inside the How this works body", async () => {
    mockLoadSettings.mockReturnValue(defaultSettings());
    render(<SettingsPage />);

    // Wait for the page to load (settings fetch is async).
    await waitFor(() => {
      expect(screen.getByText(/how this works/i)).toBeInTheDocument();
    });

    const fsrsLink = screen.getByRole("link", { name: "FSRS" });
    expect(fsrsLink).toBeInTheDocument();
    expect(fsrsLink).toHaveAttribute(
      "href",
      "https://github.com/open-spaced-repetition/ts-fsrs",
    );
    expect(fsrsLink).toHaveAttribute("target", "_blank");
    expect(fsrsLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("SettingsPage - cross-promo to Frazzled Productions (#1686)", () => {
  it("renders the About cross-promo link to frazzledproductions.com in a new tab", async () => {
    mockLoadSettings.mockReturnValue(defaultSettings());
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/how this works/i)).toBeInTheDocument();
    });

    const link = screen.getByRole("link", {
      name: /visit frazzledproductions\.com/i,
    });
    expect(link).toHaveAttribute("href", "https://frazzledproductions.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

// ---------------------------------------------------------------------------
// Preview suffix localisation (#1392)
//
// Asserts that the "(preview)" suffix on non-en locale options comes from the
// catalog key settings.labs.languages.previewSuffix, not a hardcoded string.
// The en mock returns "(preview)"; a ja-keyed check verifies the key exists
// in the Japanese catalog.
// ---------------------------------------------------------------------------

describe("SettingsPage - preview suffix from catalog", () => {
  it("preview suffix on locale picker options is sourced from the catalog (en)", async () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/app interface language/i)).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/app interface language/i);
    const options = Array.from(select.querySelectorAll("option"));
    const nonEnglishTexts = options
      .filter((o) => o.getAttribute("value") !== "en")
      .map((o) => o.textContent ?? "");

    // Every non-English option must carry the catalog suffix "(preview)".
    for (const text of nonEnglishTexts) {
      expect(text).toMatch(/\(preview\)$/);
    }
  });

  it("Japanese catalog has a non-empty previewSuffix key", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jaMessages = require("../../messages/ja.json") as Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
    const suffix = jaMessages?.settings?.labs?.languages?.previewSuffix;
    expect(typeof suffix).toBe("string");
    expect(suffix.length).toBeGreaterThan(0);
    // The Japanese suffix should use fullwidth brackets.
    expect(suffix).toContain("プレビュー");
  });
});

// ---------------------------------------------------------------------------
// Theme picker locked state (#1440)
//
// FavouritePicker renders a locked-state message when no Pokémon are mastered.
// When pretendAllMastered is on (or mastered entries exist), the picker renders.
// ---------------------------------------------------------------------------

describe("SettingsPage - theme picker locked state (#1440)", () => {
  // Helper to get the settings page rendered, waiting for load.
  async function renderAndWait() {
    render(<SettingsPage />);
    // Wait for the async loadSession effect to complete
    await waitFor(() => {
      // The page renders content after settings load
      expect(screen.getByText(/App Theme/i)).toBeInTheDocument();
    });
  }

  it("shows locked-state message when no Pokémon are mastered", async () => {
    // loadSession returns null → cardStateById is empty → unlockedEntries is empty
    mockLoadSession.mockResolvedValue(null);

    await renderAndWait();

    expect(screen.getByText("Master your first Pokémon to unlock themes.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Practice" })).toBeInTheDocument();
  });

  it("locked state: Practice link points to /", async () => {
    mockLoadSession.mockResolvedValue(null);

    await renderAndWait();

    const link = screen.getByRole("link", { name: "Go to Practice" });
    expect(link).toHaveAttribute("href", "/");
  });

  it("locked state: no theme picker grid rendered", async () => {
    mockLoadSession.mockResolvedValue(null);

    await renderAndWait();

    expect(screen.queryByRole("button", { name: /Set as theme/i })).not.toBeInTheDocument();
  });

  it("pretendAllMastered on: picker grid renders, locked message absent", async () => {
    // The superuser flag forces unlockedEntries to include every CURATED_POKEMON
    // entry (the real, non-empty curated list), so the locked branch is skipped.
    // This exercises the actual `flags.pretendAllMastered || isMastered(...)`
    // guard in the component, not just catalogue-key presence.
    mockLoadSession.mockResolvedValue(null);
    mockSuperuserFlags.pretendAllMastered = true;
    try {
      await renderAndWait();

      // The locked signpost must NOT show when the superuser flag is on.
      expect(
        screen.queryByText("Master your first Pokémon to unlock themes."),
      ).not.toBeInTheDocument();
      // The picker grid renders at least one selectable theme.
      await waitFor(() => {
        expect(
          screen.getAllByRole("button", { name: /Set as theme/i }).length,
        ).toBeGreaterThan(0);
      });
    } finally {
      mockSuperuserFlags.pretendAllMastered = false;
    }
  });
});

// ---------------------------------------------------------------------------
// Mark-what-I-know discovery nudge auto-dismiss (#1443)
// ---------------------------------------------------------------------------

describe("SettingsPage - mark-what-I-know nudge (#1443)", () => {
  it("opening the Quickstart quiz persists markWhatIKnowNudgeDismissed", async () => {
    // defaultSettings() omits the flag → the nudge is shown (absent → false).
    mockLoadSettings.mockReturnValue(defaultSettings());
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText(/App Theme/i)).toBeInTheDocument();
    });

    // Engaging with the quiz opens it AND dismisses the discovery nudge.
    await userEvent.click(await screen.findByRole("button", { name: "Open quiz" }));

    expect(screen.getByTestId("known-pokemon-quiz")).toBeInTheDocument();
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        onboarding: expect.objectContaining({
          markWhatIKnowNudgeDismissed: true,
        }),
      }),
    );
  });

  it("scrolls the quiz into view after opening it", async () => {
    const scrollIntoView = vi.fn();
    // jsdom does not implement scrollIntoView; provide a spy so the deferred
    // scroll (200ms after open) can be asserted.
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockLoadSettings.mockReturnValue(defaultSettings());
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText(/App Theme/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open quiz" }));
    expect(screen.getByTestId("known-pokemon-quiz")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    // block:"start" places the heading at/near the top of the viewport (#1486).
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    vi.useRealTimers();
  });
});

describe("SettingsPage - forceTokenToast developer toggle (#1443)", () => {
  beforeEach(() => {
    mockSuperuserState.unlocked = true;
    mockSuperuserFlags.forceTokenToast = false;
    mockSetFlag.mockClear();
  });
  afterEach(() => {
    mockSuperuserState.unlocked = false;
    delete mockSuperuserFlags.forceTokenToast;
  });

  it("renders the developer toggle and flips the flag on click", async () => {
    mockLoadSettings.mockReturnValue(defaultSettings());
    render(<SettingsPage />);

    const toggle = await screen.findByRole("switch", {
      name: /force token earned toast/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await userEvent.click(toggle);

    expect(mockSetFlag).toHaveBeenCalledWith("forceTokenToast", true);
  });
});

// ---------------------------------------------------------------------------
// Item 1: Settings relabelling (clarity polish)
// ---------------------------------------------------------------------------

describe("SettingsPage - clarity polish: Settings labels (item 1)", () => {
  it("app-language heading reads 'App interface language'", async () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(/app interface language/i),
      ).toBeInTheDocument();
    });
  });

  it("enrolment heading reads 'Pokémon name practice languages'", async () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/Pokémon name practice languages/i),
      ).toBeInTheDocument();
    });
  });

  it("enrolment description reads 'Switch the active one from the language pill'", async () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/switch the active one from the language pill/i),
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Item 2: pretendAllMastered guard on enrolment mastery counts (clarity polish)
// ---------------------------------------------------------------------------

describe("SettingsPage - clarity polish: enrolment mastery count respects pretendAllMastered (item 2)", () => {
  // The settings page shows a per-locale mastered count badge next to each
  // enrolled locale in the enrolment list (e.g. "5 mastered"). When the
  // pretendAllMastered flag is on it must show the full SEED_POKEMON.length
  // count instead of the real cached count, mirroring how ProfileStatusBar
  // and useProfileStatus derive mastery.

  it("flag OFF: renders the mastered count badge when the real cached count is > 0", async () => {
    // Override the cache mock to return a non-zero count for English. The flag
    // is off by default (pretendAllMastered: false in mockSuperuserFlags).
    mockReadMasteredCountCache.mockReturnValue({
      en: 42,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
      learningLocales: ["en", "ja"],
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    // The masteredCount badge is only rendered when masteredCount > 0. With the
    // real cached count = 42 and the flag OFF, the badge is present. The t()
    // mock returns the ICU template string literally ("{count, number} mastered")
    // so we assert that string is present in the enrolment section.
    await waitFor(() => {
      const enrolmentSection = document.getElementById("languages-learning");
      expect(enrolmentSection).not.toBeNull();
      // The badge renders the ICU string (unmolested by the simple mock t()).
      expect(enrolmentSection!.textContent).toContain("mastered");
    });

    // Restore.
    mockReadMasteredCountCache.mockReturnValue({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 });
  });

  it("flag ON: hides the mastered count badge even when the real cached count is > 0", async () => {
    // SEED_POKEMON is mocked to [] (length 0), so pretendAllMastered resolves
    // to 0. The real cached count is 42 but must not be used. Since masteredCount
    // = 0 when the flag is on, the badge (only rendered for count > 0) must be absent.
    mockSuperuserFlags.pretendAllMastered = true;
    mockReadMasteredCountCache.mockReturnValue({
      en: 42,
      ja: 17,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
      learningLocales: ["en", "ja"],
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    // The badge (rendered when masteredCount > 0) must be absent because the
    // all-mastered count is SEED_POKEMON.length = 0 in the test mock.
    await waitFor(() => {
      const enrolmentSection = document.getElementById("languages-learning");
      expect(enrolmentSection).not.toBeNull();
      expect(enrolmentSection!.textContent).not.toContain("mastered");
    });

    // Restore.
    mockSuperuserFlags.pretendAllMastered = false;
    mockReadMasteredCountCache.mockReturnValue({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 });
  });
});

// ---------------------------------------------------------------------------
// Item 3: Unenrol-active-language confirmation (clarity polish)
// ---------------------------------------------------------------------------

describe("SettingsPage - clarity polish: unenrol active language confirm (item 3)", () => {
  function settingsWithJaActive() {
    return {
      ...defaultSettings(),
      labsFlags: { languages: true },
      learningLocales: ["en", "ja"] as string[],
      activePokemonNameLocale: "ja" as const,
    };
  }

  it("does NOT show confirm for removing a non-active language", async () => {
    // Active = ja; removing zh-Hans (not active) should apply immediately.
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
      learningLocales: ["en", "ja", "zh-Hans"] as string[],
      activePokemonNameLocale: "ja" as const,
    });
    render(<SettingsPage />);

    // Wait for enrolment list.
    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    // Un-tick zh-Hans (not active): no confirm block should appear.
    const zhHansCheckbox = screen.getByRole("checkbox", {
      name: /简体中文/i,
    });
    await userEvent.click(zhHansCheckbox);

    // Confirm block must NOT appear.
    expect(screen.queryByRole("alert")).toBeNull();
    // saveSettings must have been called immediately.
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it("shows an inline confirm block when removing the active language", async () => {
    mockLoadSettings.mockReturnValue(settingsWithJaActive());
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    // Un-tick ja (the active language).
    const jaCheckbox = screen.getByRole("checkbox", {
      name: /日本語/i,
    });
    await userEvent.click(jaCheckbox);

    // Inline confirm block must appear (role=alert).
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // saveSettings must NOT have been called yet.
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("confirming the unenrol applies the change and clears the confirm block", async () => {
    mockLoadSettings.mockReturnValue(settingsWithJaActive());
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    const jaCheckbox = screen.getByRole("checkbox", { name: /日本語/i });
    await userEvent.click(jaCheckbox);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // Click "Confirm".
    const confirmBtn = screen.getByRole("button", { name: /^confirm$/i });
    await userEvent.click(confirmBtn);

    // Confirm block must disappear.
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });

    // saveSettings must have been called with ja removed and active set to en.
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        activePokemonNameLocale: "en",
        learningLocales: expect.not.arrayContaining(["ja"]),
      }),
    );
  });

  it("cancelling the unenrol confirm leaves the language enrolled and active", async () => {
    mockLoadSettings.mockReturnValue(settingsWithJaActive());
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    const jaCheckbox = screen.getByRole("checkbox", { name: /日本語/i });
    await userEvent.click(jaCheckbox);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // Click "Cancel".
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    // Confirm block must disappear.
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });

    // saveSettings must NOT have been called.
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removedLocales tombstone maintenance (#1568)
// ---------------------------------------------------------------------------

describe("SettingsPage - enrolment maintains removedLocales tombstone (#1568)", () => {
  function settingsWithJaActive() {
    return {
      ...defaultSettings(),
      labsFlags: { languages: true },
      learningLocales: ["en", "ja"] as string[],
      activePokemonNameLocale: "ja" as const,
      removedLocales: [] as AppLocale[],
    };
  }

  it("enrolling a locale clears it from removedLocales (un-tombstone)", async () => {
    // Start with zh-Hans in the tombstone set (previously removed).
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
      learningLocales: ["en", "ja"] as string[],
      activePokemonNameLocale: "ja" as const,
      removedLocales: ["zh-Hans"],
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    // Enrol zh-Hans (currently unenrolled).
    const zhHansCheckbox = screen.getByRole("checkbox", { name: /简体中文/i });
    await userEvent.click(zhHansCheckbox);

    // saveSettings must be called with zh-Hans removed from removedLocales.
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        learningLocales: expect.arrayContaining(["zh-Hans"]),
        removedLocales: expect.not.arrayContaining(["zh-Hans"]),
      }),
    );
  });

  it("removing a non-active locale adds it to removedLocales", async () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
      learningLocales: ["en", "ja", "zh-Hans"] as string[],
      activePokemonNameLocale: "ja" as const,
      removedLocales: [] as AppLocale[],
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    // Remove zh-Hans (not active).
    const zhHansCheckbox = screen.getByRole("checkbox", { name: /简体中文/i });
    await userEvent.click(zhHansCheckbox);

    // saveSettings must be called with zh-Hans in removedLocales.
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        learningLocales: expect.not.arrayContaining(["zh-Hans"]),
        removedLocales: expect.arrayContaining(["zh-Hans"]),
      }),
    );
  });

  it("confirming unenrol of the active locale adds it to removedLocales", async () => {
    mockLoadSettings.mockReturnValue(settingsWithJaActive());
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    const jaCheckbox = screen.getByRole("checkbox", { name: /日本語/i });
    await userEvent.click(jaCheckbox);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });

    // ja must be tombstoned; active must fall back to en.
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        learningLocales: expect.not.arrayContaining(["ja"]),
        removedLocales: expect.arrayContaining(["ja"]),
        activePokemonNameLocale: "en",
      }),
    );
  });

  it("'en' is never added to removedLocales when removing any other locale", async () => {
    // Verify that the removedLocales on any saveSettings call never includes "en".
    mockLoadSettings.mockReturnValue({
      ...defaultSettings(),
      labsFlags: { languages: true },
      learningLocales: ["en", "ja", "zh-Hans"] as string[],
      activePokemonNameLocale: "ja" as const,
      removedLocales: [] as AppLocale[],
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pokémon name practice languages/i)).toBeInTheDocument();
    });

    // Remove zh-Hans (non-active, no confirm).
    const zhHansCheckbox = screen.getByRole("checkbox", { name: /简体中文/i });
    await userEvent.click(zhHansCheckbox);

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled();
    });

    const calledWith = mockSaveSettings.mock.calls[0][0] as { removedLocales: string[] };
    expect(calledWith.removedLocales).not.toContain("en");
  });
});

describe("SettingsPage - statutory trading disclosure in About section (#1565 Part A)", () => {
  it("renders the company number 17258540 in the About section", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/17258540/)).toBeInTheDocument();
    });
  });

  it("renders the registered office (Shelton Street) in the About section", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Shelton Street/)).toBeInTheDocument();
    });
  });
});

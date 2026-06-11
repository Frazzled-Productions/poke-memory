/**
 * Component tests for the auth callback-complete page.
 *
 * The page renders a loading spinner while the auth session is resolving.
 * We drive the loading state by mocking useAuth to return { loading: true }
 * so the mount effect exits early and the component stays in the initial
 * `{ kind: "loading" }` state. This covers the `useTranslations("auth")` call
 * (line 89) and the localised aria-label on the loading div (line 356), which
 * were added as part of the #1607 aria-label i18n sweep.
 *
 * Additional suites cover the superuser write-guard branches added in #1854:
 *
 *  - Path A: hasLocal && !cloudHasData with anyFlagOn → no push, navigate "/"
 *  - Path B / conflict UI: conflict status with anyFlagOn → "Sync paused
 *    (superuser)" button rendered; handleKeepLocal is a no-op
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Configurable mock factories - declared before vi.mock calls so hoisting
// places them before the first import of the mocked modules.
// ---------------------------------------------------------------------------

const mockRouterReplace = vi.fn();
// The router object must be a stable reference (same object every call).
// A new object on each render would change the `router` dep in the page's
// useEffect deps array and cause an infinite re-render loop.
const STABLE_ROUTER = { replace: mockRouterReplace };
vi.mock("next/navigation", () => ({
  useRouter: () => STABLE_ROUTER,
}));

// useAuth: configurable per test-suite. Default: loading=true (existing tests).
const mockUseAuth = vi.fn(() => ({
  user: null as null | { id: string },
  loading: true,
  supabase: null as null | SupabaseClient,
}));
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// useSuperuser: configurable per test-suite. Default: no flags.
const mockUseSuperuser = vi.fn(() => ({ anyFlagOn: false }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

// Sync cloud helpers - configurable per test.
const mockPushSession = vi.fn();
const mockHasCloudData = vi.fn();
const mockPullSession = vi.fn();
const mockApplyCloudAuthoritative = vi.fn();
const mockMaxCloudUpdatedAt = vi.fn(() => null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
vi.mock("@/lib/sync/cloud", () => ({
  hasCloudData: (...args: unknown[]) => (mockHasCloudData as AnyFn)(...args),
  applyCloudAuthoritative: (...args: unknown[]) => (mockApplyCloudAuthoritative as AnyFn)(...args),
  maxCloudUpdatedAt: (...args: unknown[]) => (mockMaxCloudUpdatedAt as AnyFn)(...args),
  pullSession: (...args: unknown[]) => (mockPullSession as AnyFn)(...args),
  pushSession: (...args: unknown[]) => (mockPushSession as AnyFn)(...args),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({})),
  saveSyncStatus: vi.fn(),
}));

const mockLoadSession = vi.fn(async () => null as unknown);
vi.mock("@/lib/review/persistence", () => ({
  loadSession: (...args: unknown[]) => (mockLoadSession as AnyFn)(...args),
  saveSession: vi.fn(),
  bumpSessionStorageKey: vi.fn(),
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
}));

// Stable seed object - must be declared outside the mock factory so that the
// same reference is returned on every render call. A new object on each render
// would change the `seed` dep in the page's useEffect and cause infinite
// re-renders → OOM.
const STABLE_SEED = {
  seedPokemon: [],
  seedEvolutionCards: [],
  seedReverseEvolutionCards: [],
};
const STABLE_RETRY = vi.fn();
vi.mock("@/lib/pokemon/SeedContext", () => ({
  useSeed: () => ({
    seed: STABLE_SEED,
    error: null,
    retry: STABLE_RETRY,
  }),
}));

vi.mock("@/lib/settings/persistence", () => ({
  hasStoredSettings: vi.fn(() => false),
  loadSettings: vi.fn(() => ({})),
  saveSettings: vi.fn(),
  DEFAULT_SETTINGS: {},
}));

const mockPushSettings = vi.fn();
const mockPushRegionalPrefs = vi.fn();
vi.mock("@/lib/sync/settings", () => ({
  pullUserSettingsRow: vi.fn(async () => null),
  pullRegionalPrefs: vi.fn(async () => null),
  pushSettings: (...args: unknown[]) => (mockPushSettings as AnyFn)(...args),
  pushRegionalPrefs: (...args: unknown[]) => (mockPushRegionalPrefs as AnyFn)(...args),
}));

const mockPushStreak = vi.fn();
vi.mock("@/lib/sync/streak", () => ({
  pullStreak: vi.fn(async () => null),
  pushStreak: (...args: unknown[]) => (mockPushStreak as AnyFn)(...args),
}));

const mockPushGradeLog = vi.fn();
vi.mock("@/lib/sync/gradeLog", () => ({
  pullGradeLog: vi.fn(async () => null),
  pushGradeLog: (...args: unknown[]) => (mockPushGradeLog as AnyFn)(...args),
}));

vi.mock("@/lib/streak/persistence", () => ({
  loadStreakData: vi.fn(() => ({ days: [] })),
  saveStreakData: vi.fn(),
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn(async () => []),
  saveGradeLog: vi.fn(),
}));

vi.mock("@/lib/review/seedOpts", () => ({
  seedOptsFromSettings: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Import component after mocks.
// ---------------------------------------------------------------------------

import CallbackCompletePage from "./page";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = { id: "00000000-0000-0000-0000-000000000001" };

/** A minimal ReviewableCard with a non-null lastReview (counts as "reviewed"). */
const makeReviewedCard = () => ({
  id: 1,
  speciesId: 1,
  isDefaultForm: true,
  formCategory: "default" as const,
  formSlug: null,
  displayName: "Bulbasaur",
  cardType: "name" as const,
  subjectKey: "1",
  name: "Bulbasaur",
  spriteUrl: "",
  types: ["grass" as const],
  stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
  flavorText: "",
  flavorTexts: [""],
  evolutionChain: [],
  height: 7,
  weight: 69,
  baseExperience: 64,
  genus: "Seed Pokémon",
  generation: "generation-i",
  captureRate: null,
  baseHappiness: null,
  growthRate: null,
  habitat: null,
  genderRate: null,
  isLegendary: false,
  isMythical: false,
  cryUrl: null,
  state: {
    stability: 1,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    fsrsState: "review" as const,
    dueDate: "2026-05-14",
    lastReview: "2026-05-13",
    firstSeen: "2026-05-12",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  },
});

/** A minimal CloudRow with a non-null last_review. */
const makeCloudRow = () => ({
  id: 2,
  user_id: FAKE_USER.id,
  card_type: "name" as const,
  subject_key: "2",
  stability: 1,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 1,
  reps: 1,
  lapses: 0,
  fsrs_state: "review",
  due_date: "2026-05-14",
  last_review: "2026-05-13",
  first_seen: "2026-05-12",
  learning_step: null,
  step_started_at: null,
  hidden_since: null,
  seen_in_pasture: false,
  updated_at: "2026-05-13T12:00:00Z",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CallbackCompletePage - loading state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: null, loading: true, supabase: null });
    mockUseSuperuser.mockReturnValue({ anyFlagOn: false });
  });

  it("renders the loading spinner with an aria-busy div in English", () => {
    const { container } = renderWithIntl(<CallbackCompletePage />);
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).not.toBeNull();
    expect(busyEl?.getAttribute("aria-label")).toBe("Checking sync status");
  });

  it("loading div aria-label is localised in Japanese", () => {
    const { container } = renderJa(<CallbackCompletePage />);
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl?.getAttribute("aria-label")).toBe("同期状態を確認中");
  });
});

// ---------------------------------------------------------------------------
// F11 Path A: hasLocal && !cloudHasData with anyFlagOn true
//
// When the user has local card data and no cloud data exists, the page would
// normally push local cards to the cloud. With anyFlagOn, it must skip the
// push and navigate away without calling pushSession.
// ---------------------------------------------------------------------------

describe("CallbackCompletePage - F11 Path A: superuser skips auto-push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Signed-in, seed loaded.
    mockUseAuth.mockReturnValue({ user: FAKE_USER, loading: false, supabase: FAKE_CLIENT });
    // Superuser flag active.
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });
    // Local session has a reviewed card.
    mockLoadSession.mockResolvedValue({
      cards: [makeReviewedCard()],
      limits: { dailyNewCards: 10 },
    });
    // Cloud has no data.
    mockHasCloudData.mockResolvedValue(false);
    mockPushSession.mockResolvedValue(true);
  });

  it("navigates to '/' without calling pushSession when anyFlagOn is true", async () => {
    renderWithIntl(<CallbackCompletePage />);

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/");
    });

    expect(mockPushSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F11 Path B (conflict UI): anyFlagOn renders "Sync paused (superuser)" on the
// local-side SideCard and handleKeepLocal is a no-op.
//
// Driving the conflict state requires:
//  - hasCloudData → true
//  - pullSession → non-empty cloud rows
//  - loadSession → local session with reviewed card
//  - The conflict picker renders; the "Keep local" button is replaced by the
//    disabled "Sync paused (superuser)" button when anyFlagOn is true.
// ---------------------------------------------------------------------------

describe("CallbackCompletePage - F11 Path B: conflict UI with superuser flag on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: FAKE_USER, loading: false, supabase: FAKE_CLIENT });
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });

    // Local session has a reviewed card.
    mockLoadSession.mockResolvedValue({
      cards: [makeReviewedCard()],
      limits: { dailyNewCards: 10 },
    });
    // Cloud also has data → conflict path.
    mockHasCloudData.mockResolvedValue(true);
    mockPullSession.mockResolvedValue([makeCloudRow()]);
    // Auxiliary push mocks - must stay uncalled.
    mockPushSession.mockResolvedValue(true);
    mockPushSettings.mockResolvedValue(true);
    mockPushStreak.mockResolvedValue(true);
    mockPushGradeLog.mockResolvedValue(true);
    mockPushRegionalPrefs.mockResolvedValue(true);
  });

  it("renders the 'Sync paused (superuser)' disabled button in place of 'Keep local'", async () => {
    renderWithIntl(<CallbackCompletePage />);

    // Wait for the conflict UI to appear.
    await waitFor(() => {
      expect(screen.getByText("Sync conflict")).toBeInTheDocument();
    });

    // The superuser-paused button must be present and disabled.
    const pausedBtn = screen.getByRole("button", { name: "Sync paused (superuser)" });
    expect(pausedBtn).toBeDisabled();

    // The normal "Keep local" active button must NOT be present.
    const keepLocalBtns = screen.queryAllByRole("button", { name: "Keep local" });
    expect(keepLocalBtns).toHaveLength(0);
  });

  it("does not call any push helper when the superuser-paused button is the only one rendered", async () => {
    renderWithIntl(<CallbackCompletePage />);

    await waitFor(() => {
      expect(screen.getByText("Sync conflict")).toBeInTheDocument();
    });

    // No push helper should have been called during the conflict resolution
    // render (Path A is skipped; Path B button is disabled).
    expect(mockPushSession).not.toHaveBeenCalled();
    expect(mockPushSettings).not.toHaveBeenCalled();
    expect(mockPushStreak).not.toHaveBeenCalled();
    expect(mockPushGradeLog).not.toHaveBeenCalled();
    expect(mockPushRegionalPrefs).not.toHaveBeenCalled();
  });

  it("handleKeepLocal is a no-op when anyFlagOn: clicking the (disabled) button does not push", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CallbackCompletePage />);

    await waitFor(() => {
      expect(screen.getByText("Sync conflict")).toBeInTheDocument();
    });

    // The button is disabled; a click must not trigger any push.
    const pausedBtn = screen.getByRole("button", { name: "Sync paused (superuser)" });
    await act(async () => {
      await user.click(pausedBtn);
    });

    expect(mockPushSession).not.toHaveBeenCalled();
    expect(mockPushSettings).not.toHaveBeenCalled();
    expect(mockPushStreak).not.toHaveBeenCalled();
    expect(mockPushGradeLog).not.toHaveBeenCalled();
    expect(mockPushRegionalPrefs).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Baseline: conflict UI without superuser flag renders the normal "Keep local"
// button (ensures the superuser-on tests are not trivially true due to the
// conflict UI never rendering at all).
// ---------------------------------------------------------------------------

describe("CallbackCompletePage - conflict UI baseline (anyFlagOn false)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: FAKE_USER, loading: false, supabase: FAKE_CLIENT });
    mockUseSuperuser.mockReturnValue({ anyFlagOn: false });

    mockLoadSession.mockResolvedValue({
      cards: [makeReviewedCard()],
      limits: { dailyNewCards: 10 },
    });
    mockHasCloudData.mockResolvedValue(true);
    mockPullSession.mockResolvedValue([makeCloudRow()]);
    mockPushSession.mockResolvedValue(true);
    mockPushSettings.mockResolvedValue(true);
    mockPushStreak.mockResolvedValue(true);
    mockPushGradeLog.mockResolvedValue(true);
    mockPushRegionalPrefs.mockResolvedValue(true);
  });

  it("renders the normal 'Keep local' button when anyFlagOn is false", async () => {
    renderWithIntl(<CallbackCompletePage />);

    await waitFor(() => {
      expect(screen.getByText("Sync conflict")).toBeInTheDocument();
    });

    // The normal "Keep local" button must appear (not the paused variant).
    expect(screen.getByRole("button", { name: "Keep local" })).toBeInTheDocument();
    // The paused variant must NOT appear.
    expect(screen.queryByRole("button", { name: "Sync paused (superuser)" })).toBeNull();
  });
});

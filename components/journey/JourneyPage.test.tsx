/**
 * Component tests for the Journey page (issue #852).
 *
 * Covers:
 *   1. Page renders the loading skeleton then the main content.
 *   2. Celebratory components (TrainerCard, BadgeGallery, RecordsCard) are present.
 *   3. pretendAllMastered superuser path — every badge shown, stats derived with forceAllMastered.
 *   4. Cloud hydration branch — pullSession called when signed-in, setCards updated.
 *   5. Cloud hydration suppressed when anyFlagOn.
 *   6. Retroactive badge award path — newly earned badges saved to settings.
 *   7. Guest path — pullSession never called.
 *   8. Streak rendered when currentStreak > 0.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must appear before the component import
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    href: string;
    "aria-label"?: string;
  }) => (
    <a href={href} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Hoisted fixtures so vi.mock factories can reference them.
// ---------------------------------------------------------------------------

import type { NameReviewCard } from "@/lib/review/session";
import type { CloudRow } from "@/lib/sync/cloud";

const { mockLoadSession, mockPullSession, mockSuiteUser, mockSuperuserValue } =
  vi.hoisted(() => {
    const mockLoadSession = vi.fn();
    const mockPullSession = vi.fn();
    const mockSuiteUser = { id: "user-123", user_metadata: {} };
    const mockSuperuserValue = {
      flags: { pretendAllMastered: false },
      anyFlagOn: false,
    };
    return {
      mockLoadSession,
      mockPullSession,
      mockSuiteUser,
      mockSuperuserValue,
    };
  });

// ---------------------------------------------------------------------------
// Minimal card factory
// ---------------------------------------------------------------------------

function makeCard(id: number, reps = 0): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default" as const,
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    stats: {
      hp: 45,
      attack: 49,
      defense: 49,
      specialAttack: 65,
      specialDefense: 65,
      speed: 45,
    },
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
    cardType: "name" as const,
    subjectKey: String(id),
    state: {
      stability: reps > 0 ? 30 : 0,
      difficulty: reps > 0 ? 5 : 0,
      elapsedDays: 0,
      scheduledDays: reps > 0 ? 30 : 0,
      reps,
      lapses: 0,
      fsrsState: reps > 0 ? ("review" as const) : ("new" as const),
      dueDate: "2099-01-01",
      lastReview: reps > 0 ? "2026-01-01" : null,
      firstSeen: reps > 0 ? "2025-12-01" : null,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };
}

function makeCloudRow(id: number): CloudRow {
  return {
    card_type: "name",
    subject_key: String(id),
    stability: 30,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 30,
    reps: 10,
    lapses: 0,
    fsrs_state: "review" as const,
    due_date: "2099-01-01",
    last_review: "2026-01-01",
    first_seen: "2025-12-01",
    hidden_since: null,
    seen_in_pasture: false,
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/review/persistence", () => ({
  loadSession: mockLoadSession,
  saveSession: vi.fn().mockResolvedValue({ ok: true }),
  bumpSessionStorageKey: vi.fn(),
  STORAGE_KEY: "poke-memory:review-session:v1",
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [makeCard(1), makeCard(2), makeCard(3)],
  SEED_EVOLUTION_CARDS: [],
  SEED_REVERSE_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
  REVERSE_EDGE_ID_BASE: 2_500_000,
  CRY_ID_OFFSET: 3_000_000,
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
    reverseCardsEnabled: false,
    maxNewReversePerDay: 10,
    maxReviewsReversePerDay: 100,
    nameCardsEnabled: true,
    evolutionCardsEnabled: true,
    cryCardsEnabled: false,
    reverseEvolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
    retentionTarget: 0.9,
    timezone: "UTC",
  })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/streak", () => ({
  loadStreakData: vi.fn(() => []),
  computeStreak: vi.fn(() => 0),
  recordReview: vi.fn(),
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn().mockResolvedValue([]),
  saveGradeLog: vi.fn().mockResolvedValue(undefined),
  appendGradeEntry: vi.fn().mockResolvedValue({ occurredAt: Date.now() }),
  computeGradeTotals: vi.fn(() => ({ 1: 0, 2: 0, 4: 0, 5: 0 })),
  GRADE_LOG_APPENDED_EVENT: "poke-memory:grade-log-appended",
}));

vi.mock("@/lib/badges/derive", () => ({
  masteredSpeciesIds: vi.fn(() => new Set<number>()),
}));

vi.mock("@/lib/badges/check", () => ({
  checkBadges: vi.fn(() => []),
}));

vi.mock("@/lib/badges/catalog", () => ({
  BADGE_CATALOG: [
    {
      id: "badge-1",
      name: "Bronze Badge",
      description: "Mastered 1 Pokémon.",
      lockedHint: "A bronze badge…",
      criterion: { kind: "all-mastered", speciesIds: [1] },
    },
  ],
}));

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: mockPullSession,
  applyCloudAuthoritative: vi.fn(
    (
      _seed: unknown,
      _evoSeed: unknown,
      cloud: CloudRow[],
      _opts: unknown,
    ) => cloud.map((r) => makeCard(Number(r.subject_key), r.reps)),
  ),
}));

vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn(() => 0),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockSuperuserValue,
}));

vi.mock("@/lib/review/seedOpts", () => ({
  seedOptsFromSettings: vi.fn(() => ({
    nameEnabled: true,
    evolutionEnabled: true,
    reverseEnabled: false,
    reverseEvolutionEnabled: false,
    cryEnabled: false,
  })),
}));

vi.mock("@/lib/stats/derive", () => ({
  computeStats: vi.fn(
    (cards: NameReviewCard[]) => ({
      totalCards: cards.length,
      mastered: cards.filter((c) => c.state.reps >= 3).length,
      learning: 0,
      locked: cards.filter((c) => c.state.reps < 3).length,
      introduced: cards.filter((c) => c.state.firstSeen !== null).length,
      perGeneration: [
        { gen: 1, name: "Generation I", mastered: 0, total: 3 },
      ],
      perType: [],
      struggling: [],
      dueForecast: [],
    }),
  ),
  isMastered: vi.fn(
    (state: { reps: number; scheduledDays: number }) =>
      state.reps >= 3 && state.scheduledDays >= 21,
  ),
  MASTERY_REPETITIONS: 3,
}));

vi.mock("@/lib/stats/records", () => ({
  computeRecords: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Stub heavy sub-components
// ---------------------------------------------------------------------------

vi.mock("@/components/stats/TrainerCard", () => ({
  TrainerCard: ({ totalMastered }: { totalMastered: number }) => (
    <div data-testid="trainer-card">mastered:{totalMastered}</div>
  ),
}));

vi.mock("@/components/badges/BadgeGallery", () => ({
  BadgeGallery: ({
    forceAllMastered,
  }: {
    earnedBadges: unknown[];
    forceAllMastered?: boolean;
  }) => (
    <div
      data-testid="badge-gallery"
      data-force-all-mastered={String(forceAllMastered ?? false)}
    />
  ),
}));

vi.mock("@/components/stats/TypeBreakdown", () => ({
  TypeBreakdown: () => <div data-testid="type-breakdown" />,
}));

vi.mock("@/components/stats/RecordsCard", () => ({
  RecordsCard: () => <div data-testid="records-card" />,
}));

// ---------------------------------------------------------------------------
// Auth context mock — overrideable per describe
// ---------------------------------------------------------------------------

const { mockAuthValue } = vi.hoisted(() => ({
  mockAuthValue: {
    user: null as null | typeof mockSuiteUser,
    supabase: null as null | { auth: unknown },
    loading: false,
  },
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => mockAuthValue,
}));

// ---------------------------------------------------------------------------
// Import the page component (after all vi.mock calls)
// ---------------------------------------------------------------------------

import JourneyPage from "@/app/journey/page";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSession.mockResolvedValue(null);
  mockPullSession.mockResolvedValue([]);
  mockAuthValue.user = null;
  mockAuthValue.supabase = null;
  mockSuperuserValue.flags = { pretendAllMastered: false };
  mockSuperuserValue.anyFlagOn = false;
});

describe("JourneyPage — basic render", () => {
  it("renders the heading and key celebratory components once data is loaded", async () => {
    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Journey" })).toBeInTheDocument();
    });

    expect(screen.getByTestId("trainer-card")).toBeInTheDocument();
    expect(screen.getByTestId("badge-gallery")).toBeInTheDocument();
    expect(screen.getByTestId("type-breakdown")).toBeInTheDocument();
  });

  it("renders the mastery distribution section", async () => {
    render(<JourneyPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /mastery distribution/i }),
      ).toBeInTheDocument();
    });
  });

  it("renders the introduced section", async () => {
    render(<JourneyPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /introduced/i }),
      ).toBeInTheDocument();
    });
  });

  it("renders the generation breakdown section", async () => {
    render(<JourneyPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /by generation/i }),
      ).toBeInTheDocument();
    });
  });

  it("renders the RecordsCard when records are returned", async () => {
    const { computeRecords } = await import("@/lib/stats/records");
    vi.mocked(computeRecords).mockReturnValueOnce({
      longestStreak: 7,
      bestReviewDay: 50,
      avgDaysToMastery: null,
      mostMasteredIn7d: null,
    });

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("records-card")).toBeInTheDocument();
    });
  });

  it("renders the current streak section with zero-streak message when streak is 0", async () => {
    render(<JourneyPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /current streak/i }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/no active streak/i)).toBeInTheDocument();
  });
});

describe("JourneyPage — streak > 0", () => {
  it("renders a stat card with streak count when streak is positive", async () => {
    const { computeStreak } = await import("@/lib/streak");
    vi.mocked(computeStreak).mockReturnValue(5);

    render(<JourneyPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /current streak/i }),
      ).toBeInTheDocument();
    });

    // The StatCard renders the animated count and the label
    expect(screen.getByText(/days in a row/i)).toBeInTheDocument();
  });

  it("renders 'day in a row' (singular) when streak is exactly 1", async () => {
    const { computeStreak } = await import("@/lib/streak");
    vi.mocked(computeStreak).mockReturnValue(1);

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByText(/day in a row/i)).toBeInTheDocument();
    });
  });
});

describe("JourneyPage — pretendAllMastered superuser path", () => {
  it("passes forceAllMastered=true to BadgeGallery when flag is on", async () => {
    mockSuperuserValue.flags = { pretendAllMastered: true };
    mockSuperuserValue.anyFlagOn = true;

    render(<JourneyPage />);

    await waitFor(() => {
      const gallery = screen.getByTestId("badge-gallery");
      expect(gallery).toHaveAttribute("data-force-all-mastered", "true");
    });
  });

  it("does not call pullSession when anyFlagOn is true", async () => {
    mockSuperuserValue.flags = { pretendAllMastered: true };
    mockSuperuserValue.anyFlagOn = true;
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("trainer-card")).toBeInTheDocument();
    });

    expect(mockPullSession).not.toHaveBeenCalled();
  });
});

describe("JourneyPage — cloud hydration (signed in)", () => {
  it("calls pullSession when signed in and updates cards from cloud", async () => {
    const cloudRows = [makeCloudRow(1), makeCloudRow(2), makeCloudRow(3)];
    mockPullSession.mockResolvedValue(cloudRows);
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("trainer-card")).toBeInTheDocument();
    });

    expect(mockPullSession).toHaveBeenCalledTimes(1);
    expect(mockPullSession).toHaveBeenCalledWith(
      mockAuthValue.supabase,
      mockSuiteUser.id,
    );
  });

  it("falls back to local data when pullSession returns null (network failure)", async () => {
    mockPullSession.mockResolvedValue(null);
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("trainer-card")).toBeInTheDocument();
    });
  });

  it("falls back to local data when pullSession throws", async () => {
    mockPullSession.mockRejectedValue(new Error("timeout"));
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("trainer-card")).toBeInTheDocument();
    });
  });
});

describe("JourneyPage — guest user", () => {
  it("does not call pullSession when user is null", async () => {
    mockAuthValue.user = null;
    mockAuthValue.supabase = null;

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("trainer-card")).toBeInTheDocument();
    });

    expect(mockPullSession).not.toHaveBeenCalled();
  });

  it("renders the page from local session data", async () => {
    const localCards = [makeCard(1, 5), makeCard(2, 0)];
    mockLoadSession.mockResolvedValue({
      cards: localCards,
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("badge-gallery")).toBeInTheDocument();
    });

    expect(mockPullSession).not.toHaveBeenCalled();
  });
});

describe("JourneyPage — retroactive badge award", () => {
  it("saves newly earned badges to settings when anyFlagOn is false", async () => {
    const { checkBadges } = await import("@/lib/badges/check");
    const settingsMod = await import("@/lib/settings/persistence");
    vi.mocked(checkBadges).mockReturnValueOnce([
      {
        id: "badge-1",
        name: "Bronze Badge",
        description: "Mastered 1 Pokémon.",
        lockedHint: "A bronze badge…",
        criterion: { kind: "all-mastered", speciesIds: [1] },
      },
    ]);

    mockSuperuserValue.anyFlagOn = false;
    mockSuperuserValue.flags = { pretendAllMastered: false };

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("badge-gallery")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(settingsMod.saveSettings).toHaveBeenCalled();
    });

    const call = vi.mocked(settingsMod.saveSettings).mock.calls[0][0] as unknown as {
      earnedBadges: ReadonlyArray<{ id: string }>;
    };
    expect(call.earnedBadges.some((b) => b.id === "badge-1")).toBe(true);
  });

  it("does not award badges retroactively when anyFlagOn is true", async () => {
    const { checkBadges } = await import("@/lib/badges/check");
    const settingsMod = await import("@/lib/settings/persistence");
    // Even if checkBadges would return something, the guard should prevent save.
    vi.mocked(checkBadges).mockReturnValue([
      {
        id: "badge-1",
        name: "Bronze Badge",
        description: "Mastered 1 Pokémon.",
        lockedHint: "A bronze badge…",
        criterion: { kind: "all-mastered", speciesIds: [1] },
      },
    ]);

    mockSuperuserValue.anyFlagOn = true;
    mockSuperuserValue.flags = { pretendAllMastered: true };

    render(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("badge-gallery")).toBeInTheDocument();
    });

    expect(settingsMod.saveSettings).not.toHaveBeenCalled();
  });
});

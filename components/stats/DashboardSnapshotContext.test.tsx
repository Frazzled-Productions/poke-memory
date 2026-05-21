/**
 * Tests for DashboardSnapshotContext.
 *
 * Verifies that the provider:
 *   1. Returns null before any input is provided.
 *   2. Computes the snapshot once input is provided.
 *   3. Reuses the memoised snapshot when the same input reference is set.
 *   4. Recomputes when input changes.
 *   5. Multiple consumers receive the same snapshot object.
 *   6. Clears the snapshot when the providing component unmounts.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import {
  DashboardSnapshotProvider,
  useDashboardSnapshot,
  useProvideDashboardSnapshotInput,
  type SnapshotInput,
} from "@/components/stats/DashboardSnapshotContext";
import type { DashboardSnapshot } from "@/lib/stats/dashboard-snapshot";
import type { NameReviewCard } from "@/lib/review/session";
import { EMPTY_SCOPE } from "@/lib/review/scope";
import { DEFAULT_LIMITS } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Mock computeDashboardSnapshot so tests focus on context behaviour, not
// the derivation logic (which has its own unit tests in lib/).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.fn with loose types for test mock
const mockCompute = vi.fn<(...args: any[]) => DashboardSnapshot>();

vi.mock("@/lib/stats/dashboard-snapshot", () => ({
  computeDashboardSnapshot: (...args: unknown[]) => mockCompute(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(id: number): NameReviewCard {
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
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed Pokemon",
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
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      fsrsState: "new" as const,
      dueDate: "2099-01-01",
      lastReview: null,
      firstSeen: null,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };
}

function makeSnapshot(seed = 1): DashboardSnapshot {
  return {
    today: "2026-05-21",
    forceAllMastered: false,
    queue: { newCount: seed, learningCount: 0, reviewCount: 0, totalCount: seed },
    dueForecast: null,
    mastery: null,
    struggling: null,
    projection: null,
    firstMasteryDays: null,
    difficulty: null,
  };
}

const defaultEligibility = {
  nameCardsEnabled: true,
  evolutionCardsEnabled: true,
  reverseCardsEnabled: false,
  reverseEvolutionCardsEnabled: false,
  cryCardsEnabled: false,
  alternateFormsEnabled: false,
  practiceScope: EMPTY_SCOPE,
};

function makeInput(cards: NameReviewCard[]): SnapshotInput {
  return {
    cards,
    settings: defaultEligibility,
    limits: DEFAULT_LIMITS,
    today: "2026-05-21",
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <DashboardSnapshotProvider>{children}</DashboardSnapshotProvider>;
}

// ---------------------------------------------------------------------------
// Helper: render a hook that provides input + reads the snapshot.
// ---------------------------------------------------------------------------

function renderWithProvide() {
  type Result = {
    snapshot: ReturnType<typeof useDashboardSnapshot>;
    setInput: (input: SnapshotInput | null) => void;
  };

  let _setInput: ((v: SnapshotInput | null) => void) | null = null;

  const { result } = renderHook<Result, object>(
    () => {
      const [input, setInput] = React.useState<SnapshotInput | null>(null);
      _setInput = setInput;
      useProvideDashboardSnapshotInput(input);
      return {
        snapshot: useDashboardSnapshot(),
        setInput,
      };
    },
    { wrapper },
  );

  return {
    result,
    setInput: (input: SnapshotInput | null) => act(() => { _setInput!(input); }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockCompute.mockReturnValue(makeSnapshot(1));
});

describe("DashboardSnapshotProvider — initial state", () => {
  it("returns null before any input is provided", () => {
    const { result } = renderHook(() => useDashboardSnapshot(), { wrapper });
    expect(result.current).toBeNull();
  });
});

describe("DashboardSnapshotProvider — computes on first input", () => {
  it("returns a snapshot after input is provided", async () => {
    const { result, setInput } = renderWithProvide();

    expect(result.current.snapshot).toBeNull();

    await setInput(makeInput([makeCard(1)]));

    expect(result.current.snapshot).not.toBeNull();
    expect(mockCompute).toHaveBeenCalledTimes(1);
  });
});

describe("DashboardSnapshotProvider — memoisation", () => {
  it("does not recompute when the same input reference is set twice", async () => {
    const { result, setInput } = renderWithProvide();

    const input = makeInput([makeCard(1)]);

    await setInput(input);
    const snapshotAfterFirst = result.current.snapshot;

    // Set the same reference again — useMemo should not re-run.
    await setInput(input);

    expect(mockCompute).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toBe(snapshotAfterFirst);
  });

  it("recomputes when a new input object is set", async () => {
    const snapshotA = makeSnapshot(1);
    const snapshotB = makeSnapshot(2);
    mockCompute
      .mockReturnValueOnce(snapshotA)
      .mockReturnValueOnce(snapshotB);

    const { result, setInput } = renderWithProvide();

    await setInput(makeInput([makeCard(1)]));
    expect(result.current.snapshot).toBe(snapshotA);

    await setInput(makeInput([makeCard(1), makeCard(2)]));
    expect(result.current.snapshot).toBe(snapshotB);
    expect(mockCompute).toHaveBeenCalledTimes(2);
  });
});

describe("DashboardSnapshotProvider — reset", () => {
  it("returns null after the input is cleared (set to null)", async () => {
    const { result, setInput } = renderWithProvide();

    await setInput(makeInput([makeCard(1)]));
    expect(result.current.snapshot).not.toBeNull();

    await setInput(null);
    expect(result.current.snapshot).toBeNull();
  });
});

describe("DashboardSnapshotProvider — multiple consumers", () => {
  it("two useDashboardSnapshot calls in the same tree see the same object", async () => {
    type Combined = {
      snapshot1: ReturnType<typeof useDashboardSnapshot>;
      snapshot2: ReturnType<typeof useDashboardSnapshot>;
    };
    let _setInput: ((v: SnapshotInput | null) => void) | null = null;

    const { result } = renderHook<Combined, object>(
      () => {
        const [input, setInput] = React.useState<SnapshotInput | null>(null);
        _setInput = setInput;
        useProvideDashboardSnapshotInput(input);
        return {
          snapshot1: useDashboardSnapshot(),
          snapshot2: useDashboardSnapshot(),
        };
      },
      { wrapper },
    );

    act(() => { _setInput!(makeInput([makeCard(1)])); });

    expect(result.current.snapshot1).not.toBeNull();
    expect(result.current.snapshot2).not.toBeNull();
    // Both consumers reference the same object.
    expect(result.current.snapshot1).toBe(result.current.snapshot2);
    // Only computed once.
    expect(mockCompute).toHaveBeenCalledTimes(1);
  });
});

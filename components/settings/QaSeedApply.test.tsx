/**
 * jsdom tests for lib/qa-seed/apply.ts.
 *
 * Lives under components/ (not lib/) because the test calls functions that
 * dispatch browser events and use IDB — both require the jsdom environment.
 * See AGENTS.md "Testing" section on test-file placement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applySeedScenario, clearSeedScenario } from "@/lib/qa-seed/apply";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIdbSet = vi.fn().mockResolvedValue(undefined);
const mockIdbDelete = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/idb/db", () => ({
  idbSet: (...args: unknown[]) => mockIdbSet(...args),
  idbDelete: (...args: unknown[]) => mockIdbDelete(...args),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({ pokemonNameLocale: "en" })),
  saveSettings: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  SESSION_CHANGED_EVENT: "poke-memory:session-changed",
}));

vi.mock("@/lib/storage/keys", () => ({
  KEY_REVIEW_SESSION: "poke-memory:review-session:v1",
  KEY_GRADE_LOG: "poke-memory:grade-log:v1",
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applySeedScenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls idbSet with the serialised session when payload.session is defined", async () => {
    const payload = {
      session: {
        cards: [{ cardType: "name" as const, id: 1, locale: "en", name: "Bulbasaur", spriteUrl: "/s/1.png", subjectKey: "species:1", state: { reps: 3, scheduledDays: 21, dueDate: "2026-06-01", fsrsState: "review" as const, stability: 50, difficulty: 4, elapsedDays: 21, lapses: 0, lastReview: "2026-05-10", firstSeen: "2026-04-01", learningStep: null, stepStartedAt: null, hiddenSince: null, seenInPasture: true } }],
        limits: {
          name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
          reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        },
      },
      pokemonNameLocale: null as null,
    };
    await applySeedScenario(payload);
    expect(mockIdbSet).toHaveBeenCalledWith(
      "poke-memory:review-session:v1",
      JSON.stringify(payload.session),
    );
  });

  it("does not call idbSet when payload.session is undefined", async () => {
    await applySeedScenario({ pokemonNameLocale: null });
    expect(mockIdbSet).not.toHaveBeenCalled();
  });

  it("calls saveSettings when pokemonNameLocale is non-null", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    await applySeedScenario({ pokemonNameLocale: "ja" });
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ pokemonNameLocale: "ja" }),
    );
  });

  it("does not call saveSettings when pokemonNameLocale is null", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    await applySeedScenario({ pokemonNameLocale: null });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("dispatches a StorageEvent after writing session", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const payload = {
      session: {
        cards: [],
        limits: {
          name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
          reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        },
      },
      pokemonNameLocale: null as null,
    };
    await applySeedScenario(payload);
    expect(dispatchSpy).toHaveBeenCalled();
  });
});

describe("clearSeedScenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the review session key from IDB", async () => {
    await clearSeedScenario();
    expect(mockIdbDelete).toHaveBeenCalledWith("poke-memory:review-session:v1");
  });

  it("deletes the grade log key from IDB", async () => {
    await clearSeedScenario();
    expect(mockIdbDelete).toHaveBeenCalledWith("poke-memory:grade-log:v1");
  });

  it("dispatches StorageEvents for both cleared keys", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    await clearSeedScenario();
    const storageEvents = dispatchSpy.mock.calls
      .map((args) => args[0])
      .filter((e) => e instanceof StorageEvent) as StorageEvent[];
    const keys = storageEvents.map((e) => e.key);
    expect(keys).toContain("poke-memory:review-session:v1");
    expect(keys).toContain("poke-memory:grade-log:v1");
  });
});

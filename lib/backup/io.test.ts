import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isBackupFile, BACKUP_VERSION } from "./schema";
import { exportProgress, validateBackup, applyBackup } from "./io";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import type { BackupFile } from "./schema";
import type { DailyLimits } from "@/lib/review/session";
import type { UserSettings } from "@/lib/settings/persistence";

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(),
  saveSession: vi.fn(),
}));
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  DEFAULT_SETTINGS: {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
  },
}));

import { loadSession, saveSession } from "@/lib/review/persistence";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_LIMITS: DailyLimits = {
  name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
};

const VALID_SETTINGS: UserSettings = {
  masteryRepetitions: 3,
  maxNewPerDay: 10,
  maxReviewsPerDay: 100,
  maxNewEvolutionPerDay: 5,
  maxReviewsEvolutionPerDay: 50,
};

function makeMinimalCard(id: number): Record<string, unknown> {
  return {
    id,
    name: "bulbasaur",
    spriteUrl: "",
    cardType: "name",
    state: {
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      dueDate: "2026-05-09",
      lastReview: null,
      firstSeen: null,
      learningStep: null,
      stepStartedAt: null,
    },
  };
}

function makeValidBackup(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    cards: [makeMinimalCard(SEED_POKEMON[0].id) as BackupFile["cards"][number]],
    limits: VALID_LIMITS,
    settings: VALID_SETTINGS,
    ...overrides,
  };
}

function makeBackupFile(data: unknown): File {
  const json = JSON.stringify(data);
  return new File([json], "backup.json", { type: "application/json" });
}

// ---------------------------------------------------------------------------
// isBackupFile
// ---------------------------------------------------------------------------

describe("isBackupFile", () => {
  it("accepts a valid BackupFile", () => {
    expect(isBackupFile(makeValidBackup())).toBe(true);
  });

  it("accepts a BackupFile with empty cards array", () => {
    expect(isBackupFile(makeValidBackup({ cards: [] }))).toBe(true);
  });

  it("rejects null", () => {
    expect(isBackupFile(null)).toBe(false);
  });

  it("rejects a primitive", () => {
    expect(isBackupFile("string")).toBe(false);
  });

  it("rejects when version is missing", () => {
    const { version: _v, ...rest } = makeValidBackup();
    expect(isBackupFile(rest)).toBe(false);
  });

  it("rejects when version is a wrong number", () => {
    expect(isBackupFile({ ...makeValidBackup(), version: 2 })).toBe(false);
  });

  it("rejects when version is a string", () => {
    expect(isBackupFile({ ...makeValidBackup(), version: "1" })).toBe(false);
  });

  it("rejects when cards is missing", () => {
    const { cards: _c, ...rest } = makeValidBackup();
    expect(isBackupFile(rest)).toBe(false);
  });

  it("rejects when a card is missing id", () => {
    const card = { ...makeMinimalCard(1) };
    delete (card as Record<string, unknown>).id;
    expect(isBackupFile(makeValidBackup({ cards: [card as BackupFile["cards"][number]] }))).toBe(false);
  });

  it("rejects when a card has an invalid cardType", () => {
    const card = { ...makeMinimalCard(1), cardType: "unknown" };
    expect(isBackupFile(makeValidBackup({ cards: [card as BackupFile["cards"][number]] }))).toBe(false);
  });

  it("rejects an evolution card with missing evolvesInto", () => {
    const card = { ...makeMinimalCard(1), cardType: "evolution" };
    expect(isBackupFile(makeValidBackup({ cards: [card as BackupFile["cards"][number]] }))).toBe(false);
  });

  it("accepts an evolution card with valid evolvesInto shape", () => {
    const card = {
      ...makeMinimalCard(1),
      cardType: "evolution",
      evolvesInto: [{ name: "ivysaur", spriteUrl: "" }],
    };
    expect(isBackupFile(makeValidBackup({ cards: [card as BackupFile["cards"][number]] }))).toBe(true);
  });

  it("accepts an evolution card with legacy evolvesIntoNames shape", () => {
    const card = {
      ...makeMinimalCard(1),
      cardType: "evolution",
      evolvesIntoNames: ["ivysaur"],
    };
    expect(isBackupFile(makeValidBackup({ cards: [card as unknown as BackupFile["cards"][number]] }))).toBe(true);
  });

  it("rejects when a card state is missing dueDate", () => {
    const card = {
      ...makeMinimalCard(1),
      state: { repetitions: 0, interval: 0 },
    };
    expect(isBackupFile(makeValidBackup({ cards: [card as BackupFile["cards"][number]] }))).toBe(false);
  });

  it("rejects when limits is missing", () => {
    const { limits: _l, ...rest } = makeValidBackup();
    expect(isBackupFile(rest)).toBe(false);
  });

  it("rejects when limits.name is malformed", () => {
    expect(
      isBackupFile({
        ...makeValidBackup(),
        limits: { name: { maxNewPerDay: "10" }, evolution: VALID_LIMITS.evolution },
      }),
    ).toBe(false);
  });

  it("rejects when limits.evolution is missing", () => {
    expect(
      isBackupFile({
        ...makeValidBackup(),
        limits: { name: VALID_LIMITS.name },
      }),
    ).toBe(false);
  });

  it("rejects when settings is missing", () => {
    const { settings: _s, ...rest } = makeValidBackup();
    expect(isBackupFile(rest)).toBe(false);
  });

  it("rejects when a settings field is missing", () => {
    const { masteryRepetitions: _m, ...badSettings } = VALID_SETTINGS;
    expect(isBackupFile(makeValidBackup({ settings: badSettings as UserSettings }))).toBe(false);
  });

  it("rejects when a settings field is not a number", () => {
    expect(
      isBackupFile(makeValidBackup({ settings: { ...VALID_SETTINGS, maxNewPerDay: "10" } as unknown as UserSettings })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exportProgress
// ---------------------------------------------------------------------------

describe("exportProgress", () => {
  let capturedBlob: Blob | undefined;
  let capturedFilename: string;

  const mockAnchor = {
    href: "",
    download: "",
    click: vi.fn(),
  };

  beforeEach(() => {
    capturedBlob = undefined;
    capturedFilename = "";
    mockAnchor.href = "";
    mockAnchor.download = "";
    mockAnchor.click.mockReset();

    vi.mocked(loadSession).mockReturnValue({
      cards: [makeMinimalCard(SEED_POKEMON[0].id) as BackupFile["cards"][number]],
      limits: VALID_LIMITS,
    });
    vi.mocked(loadSettings).mockReturnValue(VALID_SETTINGS);

    vi.stubGlobal("window", { localStorage: {} });
    vi.stubGlobal("document", {
      createElement: () => mockAnchor,
    });
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        capturedBlob = blob;
        return "blob:mock";
      },
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op when window is undefined (SSR guard)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => exportProgress()).not.toThrow();
    expect(capturedBlob).toBeUndefined();
  });

  it("produces a Blob that deserialises to a valid BackupFile", async () => {
    exportProgress();
    expect(capturedBlob).toBeDefined();
    const text = await capturedBlob!.text();
    const parsed = JSON.parse(text);
    expect(isBackupFile(parsed)).toBe(true);
  });

  it("uses an empty card array when loadSession returns null", async () => {
    vi.mocked(loadSession).mockReturnValue(null);
    exportProgress();
    const text = await capturedBlob!.text();
    const parsed = JSON.parse(text) as BackupFile;
    expect(parsed.cards).toEqual([]);
  });

  it("filename contains today's ISO date", () => {
    exportProgress();
    capturedFilename = mockAnchor.download;
    const today = new Date().toISOString().slice(0, 10);
    expect(capturedFilename).toContain(today);
    expect(capturedFilename).toMatch(/\.json$/);
  });

  it("calls URL.revokeObjectURL after creating the download", () => {
    vi.useFakeTimers();
    const mockRevoke = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        capturedBlob = blob;
        return "blob:mock";
      },
      revokeObjectURL: mockRevoke,
    });
    exportProgress();
    vi.runAllTimers();
    expect(mockRevoke).toHaveBeenCalledWith("blob:mock");
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// validateBackup + applyBackup
// ---------------------------------------------------------------------------

describe("validateBackup + applyBackup", () => {
  beforeEach(() => {
    vi.mocked(saveSession).mockReset();
    vi.mocked(saveSettings).mockReset();
    vi.stubGlobal("window", { localStorage: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns { ok: true } with sanitised data for a valid file", async () => {
    const validId = SEED_POKEMON[0].id;
    const card = {
      ...makeMinimalCard(validId),
      state: { ...makeMinimalCard(validId).state as Record<string, unknown>, stepStartedAt: 12345 },
    };
    const backup = makeValidBackup({ cards: [card as BackupFile["cards"][number]] });
    const result = await validateBackup(makeBackupFile(backup));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // stepStartedAt must be nulled out on every card
    expect(result.data.cards[0].state.stepStartedAt).toBeNull();
    expect(result.data.settings).toEqual(VALID_SETTINGS);
    // applyBackup commits the validated data
    applyBackup(result.data);
    expect(vi.mocked(saveSession)).toHaveBeenCalledOnce();
    const savedSession = vi.mocked(saveSession).mock.calls[0][0];
    expect(savedSession.cards[0].state.stepStartedAt).toBeNull();
    expect(vi.mocked(saveSettings)).toHaveBeenCalledWith(VALID_SETTINGS);
  });

  it("accepts a valid evolution card ID from SEED_EVOLUTION_CARDS", async () => {
    const evoCard = SEED_EVOLUTION_CARDS[0];
    const card = {
      ...makeMinimalCard(evoCard.id),
      cardType: "evolution",
      evolvesInto: [{ name: "ivysaur", spriteUrl: "" }],
    };
    const backup = makeValidBackup({ cards: [card as BackupFile["cards"][number]] });
    const result = await validateBackup(makeBackupFile(backup));
    expect(result.ok).toBe(true);
  });

  it("returns { ok: false } for invalid JSON", async () => {
    const file = new File(["{{not json"], "backup.json", { type: "application/json" });
    const result = await validateBackup(file);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe(
      "This file isn't a valid poke-memory backup.",
    );
  });

  it("returns { ok: false } with version-specific message for wrong version", async () => {
    const backup = { ...makeValidBackup(), version: 99 };
    const result = await validateBackup(makeBackupFile(backup));
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain("99");
    expect((result as { ok: false; error: string }).error).toContain("isn't supported");
  });

  it("returns { ok: false } for unknown card ID", async () => {
    const unknownId = 9999;
    const backup = makeValidBackup({
      cards: [makeMinimalCard(unknownId) as BackupFile["cards"][number]],
    });
    const result = await validateBackup(makeBackupFile(backup));
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe(
      "This file isn't a valid poke-memory backup.",
    );
  });

  it("returns { ok: false } for malformed backup shape (missing limits)", async () => {
    const { limits: _l, ...backup } = makeValidBackup();
    const result = await validateBackup(makeBackupFile(backup));
    expect(result.ok).toBe(false);
  });

  it("does not call saveSession or saveSettings when validation fails", async () => {
    const file = new File(["{}"], "backup.json", { type: "application/json" });
    await validateBackup(file);
    expect(vi.mocked(saveSession)).not.toHaveBeenCalled();
    expect(vi.mocked(saveSettings)).not.toHaveBeenCalled();
  });

  it("preserves other state fields when nulling stepStartedAt", async () => {
    const validId = SEED_POKEMON[0].id;
    const state = {
      ...(makeMinimalCard(validId).state as Record<string, unknown>),
      repetitions: 5,
      interval: 10,
      easeFactor: 2.3,
      stepStartedAt: 99999,
    };
    const card = { ...makeMinimalCard(validId), state };
    const backup = makeValidBackup({ cards: [card as BackupFile["cards"][number]] });
    const result = await validateBackup(makeBackupFile(backup));
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.cards[0].state.stepStartedAt).toBeNull();
    expect(result.data.cards[0].state.repetitions).toBe(5);
    expect(result.data.cards[0].state.interval).toBe(10);
    expect(result.data.cards[0].state.easeFactor).toBe(2.3);
  });
});

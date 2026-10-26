import { describe, it, expect, vi, beforeEach } from "vitest";
import { pullAndMerge } from "./pullAndMerge";
import { pullUserSettingsRow } from "@/lib/sync/settings";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/settings/persistence";
import { diffSettings, loadLastPushedSettings } from "@/lib/settings/lastPushedSnapshot";

// Favourite keys on a cloud pull (#2187), against the real settings
// persistence and last-pushed snapshot (pullAndMerge.test.ts mocks both).

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn(async () => []),
  mergeCloudIntoLocalSilent: vi.fn(() => []),
  maxCloudUpdatedAt: vi.fn(() => null),
}));
vi.mock("@/lib/sync/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync/settings")>("@/lib/sync/settings");
  return {
    ...actual,
    pullUserSettingsRow: vi.fn(),
    pullRegionalPrefs: vi.fn(async () => null),
    pushSettings: vi.fn(async () => true),
  };
});
vi.mock("@/lib/storage/reset", () => ({ clearLocalProgress: vi.fn(async () => {}) }));
vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({ lastPullAt: null, lastSettingsPullAt: null, lastSeenResetAt: null })),
  saveSyncStatus: vi.fn(),
}));
vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(async () => null),
  saveSession: vi.fn(async () => ({ ok: true })),
  bumpSessionStorageKey: vi.fn(),
}));
vi.mock("@/lib/review/session", () => ({
  buildSession: vi.fn(() => []),
  DEFAULT_LIMITS: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  },
}));
vi.mock("@/lib/sync/streak", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync/streak")>("@/lib/sync/streak");
  return { ...actual, pullStreak: vi.fn(async () => null) };
});
vi.mock("@/lib/streak/persistence", () => ({
  loadStreakData: vi.fn(() => []),
  saveStreakData: vi.fn(),
  STREAK_UPDATED_EVENT: "poke-memory:streak-updated",
}));
vi.mock("@/lib/sync/gradeLog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync/gradeLog")>("@/lib/sync/gradeLog");
  return { ...actual, pullGradeLog: vi.fn(async () => null), pushGradeLogDetailed: vi.fn(async () => "ok") };
});
vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn(async () => []),
  saveGradeLog: vi.fn(async () => {}),
  isCloudPushHeld: vi.fn(() => false),
}));

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
};
vi.stubGlobal("window", { localStorage: localStorageMock, dispatchEvent: vi.fn() });
vi.stubGlobal("localStorage", localStorageMock);

const PIKACHU_THEME = {
  id: 25,
  name: "Pikachu",
  colors: { primary: "#F8D030", secondary: "#C8A020", accent: "#E03030", fgOnPrimary: "#000000" },
  spriteUrl: null,
};

// A cloud row written before the favourite keys existed: it has a theme but
// none of the five new keys.
function pullPreFeatureCloudRow() {
  vi.mocked(pullUserSettingsRow).mockResolvedValue({
    settings: { masteryRepetitions: 3, favouriteTheme: PIKACHU_THEME } as never,
    updatedAt: "2026-10-01T00:00:00.000Z",
    lastResetAt: null,
  });
}

const client = {} as Parameters<typeof pullAndMerge>[0];

beforeEach(() => {
  store.clear();
});

describe("pullAndMerge: favourite keys absent from the cloud (#2187)", () => {
  it("carries the cloud theme over as the favourite on a device with no settings, and pushes it", async () => {
    pullPreFeatureCloudRow();

    await pullAndMerge(client, "user-1");

    const settings = loadSettings();
    expect(settings.favouriteTheme?.id).toBe(25);
    expect(settings.favouritePokemonId).toBe(25);
    expect(settings.heartedSpeciesIds).toEqual([25]);
    const patch = diffSettings(loadLastPushedSettings(), settings);
    expect(patch.favouritePokemonId).toBe(25);
    expect(patch.heartedSpeciesIds).toEqual([25]);
    // Keys still at their defaults are not pushed: an explicit [] or null in
    // the cloud would make the cloud win over another device's unsynced values.
    expect(patch).not.toHaveProperty("priorityNewSpeciesIds");
    expect(patch).not.toHaveProperty("favouriteThemeOfferedForId");
    expect(patch).not.toHaveProperty("learnFirstAskedSpeciesIds");
  });

  it("pushes none of the favourite keys when the device holds only defaults and the cloud has no theme", async () => {
    vi.mocked(pullUserSettingsRow).mockResolvedValue({
      settings: { masteryRepetitions: 3 } as never,
      updatedAt: "2026-10-01T00:00:00.000Z",
      lastResetAt: null,
    });

    await pullAndMerge(client, "user-1");

    const patch = diffSettings(loadLastPushedSettings(), loadSettings());
    for (const key of ["favouritePokemonId", "heartedSpeciesIds", "priorityNewSpeciesIds", "favouriteThemeOfferedForId", "learnFirstAskedSpeciesIds"]) {
      expect(patch).not.toHaveProperty(key);
    }
  });

  it("keeps the device's favourite keys when the cloud lacks them, and pushes them up", async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      favouritePokemonId: 94,
      heartedSpeciesIds: [94, 143],
      priorityNewSpeciesIds: [92],
      favouriteThemeOfferedForId: 94,
      learnFirstAskedSpeciesIds: [93],
    });
    pullPreFeatureCloudRow();

    await pullAndMerge(client, "user-1");

    const settings = loadSettings();
    expect(settings.favouriteTheme?.id).toBe(25);
    expect(settings.masteryRepetitions).toBe(3);
    expect(settings.favouritePokemonId).toBe(94);
    expect(settings.heartedSpeciesIds).toEqual([94, 143]);
    expect(settings.priorityNewSpeciesIds).toEqual([92]);
    expect(settings.favouriteThemeOfferedForId).toBe(94);
    expect(settings.learnFirstAskedSpeciesIds).toEqual([93]);
    const patch = diffSettings(loadLastPushedSettings(), settings);
    expect(patch).toMatchObject({
      favouritePokemonId: 94,
      heartedSpeciesIds: [94, 143],
      priorityNewSpeciesIds: [92],
      favouriteThemeOfferedForId: 94,
      learnFirstAskedSpeciesIds: [93],
    });
  });

  it("applies the cloud's favourite keys when the cloud has them", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, favouritePokemonId: 94, heartedSpeciesIds: [94] });
    vi.mocked(pullUserSettingsRow).mockResolvedValue({
      settings: { favouriteTheme: PIKACHU_THEME, favouritePokemonId: null, heartedSpeciesIds: [7] } as never,
      updatedAt: "2026-10-01T00:00:00.000Z",
      lastResetAt: null,
    });

    await pullAndMerge(client, "user-1");

    const settings = loadSettings();
    expect(settings.favouritePokemonId).toBeNull();
    expect(settings.heartedSpeciesIds).toEqual([7]);
    expect(diffSettings(loadLastPushedSettings(), settings).heartedSpeciesIds).toBeUndefined();
  });
});

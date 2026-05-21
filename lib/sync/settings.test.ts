import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSettings, pullSettingsWithTimestamp, pushSettings, pushRegionalPrefs, pullRegionalPrefs } from "./settings";
import type { UserSettings } from "@/lib/settings/persistence";
import type { MergeUserSettingsArgs } from "@/lib/supabase/rpc-types";

function makeClientWithRpc(error: null | object = null) {
  const rpc = vi.fn().mockResolvedValue({ error });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function makeClientWithUpdate(error: null | object = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { client: { from } as unknown as SupabaseClient, update, eq };
}

function makeClientWithMaybeSingle(data: unknown, error: null | object = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, maybeSingle };
}

const SAMPLE: UserSettings = {
  masteryRepetitions: 3,
  maxNewPerDay: 10,
  maxReviewsPerDay: 100,
  maxNewEvolutionPerDay: 5,
  maxReviewsEvolutionPerDay: 50,
  nameCardsEnabled: true,
  evolutionCardsEnabled: true,
  reverseEvolutionCardsEnabled: false,
  reverseCardsEnabled: false,
  alternateFormsEnabled: false,
  maxNewReversePerDay: 10,
  maxReviewsReversePerDay: 100,
  playCryOnReveal: false,
  speakNameOnReveal: false,
  cryCardsEnabled: false,
  maxNewCryPerDay: 10,
  maxReviewsCryPerDay: 100,
  favouriteTheme: null,
  themeIntensity: "accents",
  retentionTarget: 0.9,
  practiceScope: { gens: [], types: [], presets: [] },
  miniGameBestScore: 0,
  seenStreakMilestones: [],
  earnedBadges: [],
  onboarding: {
    firstVisitOnboardingDismissed: false,
    welcomeDismissed: false,
    practiceHintDismissed: false,
    statsHintDismissed: false,
    settingsHintDismissed: false,
    installNudgeDismissed: false,
    audioHintDismissed: false,
    cardTypesHintDismissed: false,
    guestStorageNoticeDismissed: false,
  },
  appVisitCount: 0,
  ttsVoice: null,
  ttsRate: 1,
  ttsVolume: 1,
  timezone: null,
  dateFormat: null,
  mobileNav: "bottom" as const,
};

describe("pushSettings", () => {
  it("calls merge_user_settings RPC with p_user_id and p_patch", async () => {
    const { client, rpc } = makeClientWithRpc();
    const ok = await pushSettings(client, "user-1", SAMPLE);
    expect(ok).toBe(true);
    const [name, args] = rpc.mock.calls[0] as [string, MergeUserSettingsArgs];
    expect(name).toBe("merge_user_settings");
    expect(args.p_user_id).toBe("user-1");
    expect(args.p_patch).toEqual(SAMPLE);
  });

  it("returns false on supabase error", async () => {
    const { client } = makeClientWithRpc({ message: "boom" });
    expect(await pushSettings(client, "user-1", SAMPLE)).toBe(false);
  });

  it("includes practiceScope in the patch when provided (#1159)", async () => {
    const { client, rpc } = makeClientWithRpc();
    const settingsWithScope: Partial<UserSettings> = {
      practiceScope: {
        gens: [1, 2],
        types: ["fire"],
        presets: ["starters"],
        formCategories: { mode: "all" },
        games: ["red-blue"],
      },
    };
    await pushSettings(client, "user-1", settingsWithScope);
    const [, args] = rpc.mock.calls[0] as [string, MergeUserSettingsArgs];
    expect(args.p_patch.practiceScope).toEqual(settingsWithScope.practiceScope);
  });
});

describe("pullSettings", () => {
  it("returns the settings object when present", async () => {
    const { client } = makeClientWithMaybeSingle({ settings: SAMPLE });
    expect(await pullSettings(client, "user-1")).toEqual(SAMPLE);
  });

  it("round-trips practiceScope through push → pull (#1159)", async () => {
    // The push side sends practiceScope as part of the JSONB patch via
    // merge_user_settings; the pull side reads it back from the settings column.
    // This test verifies the pull correctly preserves the scope structure.
    const scope = {
      gens: [1, 3],
      types: ["water"],
      presets: ["legendaries"] as const,
      formCategories: { mode: "all" as const },
      games: ["sword-shield"],
    };
    const settingsWithScope = { ...SAMPLE, practiceScope: scope };
    const { client } = makeClientWithMaybeSingle({ settings: settingsWithScope });
    const pulled = await pullSettings(client, "user-1");
    expect(pulled).not.toBeNull();
    expect(pulled!.practiceScope).toEqual(scope);
  });

  it("returns null when no row exists", async () => {
    const { client } = makeClientWithMaybeSingle(null);
    expect(await pullSettings(client, "user-1")).toBeNull();
  });

  it("returns null when the settings column is null (sparse row from pushRegionalPrefs)", async () => {
    // A row created by pushRegionalPrefs has settings = NULL; treat as "no real
    // cloud settings" so it cannot overlay real local choices.
    const { client } = makeClientWithMaybeSingle({ settings: null });
    expect(await pullSettings(client, "user-1")).toBeNull();
  });

  it("returns null when the settings column is the default empty object", async () => {
    // Default row written by the migration has settings = '{}'; we treat that
    // as "no real cloud settings" so it cannot overlay real local choices.
    const { client } = makeClientWithMaybeSingle({ settings: {} });
    expect(await pullSettings(client, "user-1")).toBeNull();
  });

  it("returns null on supabase error", async () => {
    const { client } = makeClientWithMaybeSingle(null, { message: "boom" });
    expect(await pullSettings(client, "user-1")).toBeNull();
  });
});

describe("pullSettingsWithTimestamp", () => {
  it("returns settings and updatedAt when the row has a timestamp", async () => {
    const { client } = makeClientWithMaybeSingle({
      settings: SAMPLE,
      updated_at: "2026-05-13T12:00:00.000Z",
    });
    const result = await pullSettingsWithTimestamp(client, "user-1");
    expect(result).not.toBeNull();
    expect(result!.settings).toEqual(SAMPLE);
    expect(result!.updatedAt).toBe("2026-05-13T12:00:00.000Z");
  });

  it("returns updatedAt: null for a legacy row with no updated_at column value", async () => {
    // Legacy rows pre-date updated_at population; the column is null in the DB.
    // The response key is present but null — and any undefined (omitted key) is
    // coerced to null so the null-comparison in pullAndMerge stays correct.
    const { client } = makeClientWithMaybeSingle({ settings: SAMPLE, updated_at: null });
    const result = await pullSettingsWithTimestamp(client, "user-1");
    expect(result).not.toBeNull();
    expect(result!.updatedAt).toBeNull();
  });

  it("coerces a missing updated_at key to null rather than propagating undefined", async () => {
    // If Supabase ever omits the key (e.g. schema drift), undefined must not
    // leak into pullAndMerge where `undefined !== null` would be mistaken for
    // a real newer timestamp, causing the cursor to stall and re-apply forever.
    const { client } = makeClientWithMaybeSingle({ settings: SAMPLE });
    const result = await pullSettingsWithTimestamp(client, "user-1");
    expect(result).not.toBeNull();
    expect(result!.updatedAt).toBeNull();
  });

  it("returns null when settings column is empty object", async () => {
    const { client } = makeClientWithMaybeSingle({ settings: {}, updated_at: "2026-05-13T12:00:00.000Z" });
    expect(await pullSettingsWithTimestamp(client, "user-1")).toBeNull();
  });
});

describe("pushRegionalPrefs", () => {
  it("calls update with timezone and date_format only — no updated_at — filtered by user_id", async () => {
    const { client, update, eq } = makeClientWithUpdate();
    const ok = await pushRegionalPrefs(client, "user-1", {
      timezone: "America/New_York",
      dateFormat: "mdy",
    });
    expect(ok).toBe(true);
    const [row] = update.mock.calls[0] as [Record<string, unknown>];
    expect(row.timezone).toBe("America/New_York");
    expect(row.date_format).toBe("mdy");
    // Must NOT include updated_at — bumping it would cause other devices to
    // think the settings JSONB blob changed, triggering a spurious overwrite.
    expect(row).not.toHaveProperty("updated_at");
    // UPDATE must not include user_id or settings — those belong to other columns/writes.
    expect(row).not.toHaveProperty("user_id");
    expect(row).not.toHaveProperty("settings");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns false on supabase error", async () => {
    const { client } = makeClientWithUpdate({ message: "boom" });
    expect(await pushRegionalPrefs(client, "user-1", { timezone: null, dateFormat: null })).toBe(false);
  });
});

describe("pullRegionalPrefs", () => {
  it("returns timezone and dateFormat when both columns are set", async () => {
    const { client } = makeClientWithMaybeSingle({
      timezone: "Australia/Sydney",
      date_format: "dmy",
    });
    expect(await pullRegionalPrefs(client, "user-1")).toEqual({
      timezone: "Australia/Sydney",
      dateFormat: "dmy",
    });
  });

  it("returns timezone-only when date_format is null", async () => {
    const { client } = makeClientWithMaybeSingle({ timezone: "Europe/London", date_format: null });
    expect(await pullRegionalPrefs(client, "user-1")).toEqual({
      timezone: "Europe/London",
      dateFormat: null,
    });
  });

  it("returns null when both columns are null (nothing to overlay)", async () => {
    const { client } = makeClientWithMaybeSingle({ timezone: null, date_format: null });
    expect(await pullRegionalPrefs(client, "user-1")).toBeNull();
  });

  it("returns null when no row exists", async () => {
    const { client } = makeClientWithMaybeSingle(null);
    expect(await pullRegionalPrefs(client, "user-1")).toBeNull();
  });

  it("rejects unknown date_format values", async () => {
    const { client } = makeClientWithMaybeSingle({
      timezone: "UTC",
      date_format: "invalid",
    });
    expect(await pullRegionalPrefs(client, "user-1")).toEqual({
      timezone: "UTC",
      dateFormat: null,
    });
  });

  it("returns null when timezone is also null and date_format is invalid", async () => {
    const { client } = makeClientWithMaybeSingle({
      timezone: null,
      date_format: "bad-value",
    });
    expect(await pullRegionalPrefs(client, "user-1")).toBeNull();
  });

  it("returns null on supabase error", async () => {
    const { client } = makeClientWithMaybeSingle(null, { message: "boom" });
    expect(await pullRegionalPrefs(client, "user-1")).toBeNull();
  });
});

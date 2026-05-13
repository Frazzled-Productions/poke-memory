import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSettings, pushSettings } from "./settings";
import type { UserSettings } from "@/lib/settings/persistence";

function makeClientWithUpsert(error: null | object = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ upsert });
  return { client: { from } as unknown as SupabaseClient, upsert };
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
};

describe("pushSettings", () => {
  it("upserts the user_id row with the settings object and a fresh updated_at", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const ok = await pushSettings(client, "user-1", SAMPLE);
    expect(ok).toBe(true);
    const [row, options] = upsert.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(row.user_id).toBe("user-1");
    expect(row.settings).toEqual(SAMPLE);
    expect(typeof row.updated_at).toBe("string");
    expect(options).toEqual({ onConflict: "user_id" });
  });

  it("returns false on supabase error", async () => {
    const { client } = makeClientWithUpsert({ message: "boom" });
    expect(await pushSettings(client, "user-1", SAMPLE)).toBe(false);
  });
});

describe("pullSettings", () => {
  it("returns the settings object when present", async () => {
    const { client } = makeClientWithMaybeSingle({ settings: SAMPLE });
    expect(await pullSettings(client, "user-1")).toEqual(SAMPLE);
  });

  it("returns null when no row exists", async () => {
    const { client } = makeClientWithMaybeSingle(null);
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

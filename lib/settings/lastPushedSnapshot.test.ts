import { describe, it, expect } from "vitest";
import { diffSettings, preserveDeviceLocalKeys, DEVICE_LOCAL_KEYS } from "./lastPushedSnapshot";
import { DEFAULT_SETTINGS, type UserSettings } from "./persistence";

function s(overrides: Partial<UserSettings>): UserSettings {
  return {
    masteryRepetitions: 3,
    themeIntensity: "accents",
    maxNewPerDay: 10,
    practiceScope: { gens: [], types: [], presets: [] },
    onboarding: { welcomeDismissed: false } as never,
    ...overrides,
  } as unknown as UserSettings;
}

describe("diffSettings", () => {
  it("returns only non-default keys when the snapshot is null (first push default-prune)", () => {
    // themeIntensity "tinted" is non-default (DEFAULT is "accents"); it must appear.
    // masteryRepetitions 3 equals DEFAULT_SETTINGS.masteryRepetitions; it must be pruned.
    const next = s({ themeIntensity: "tinted" });
    const patch = diffSettings(null, next);
    expect(patch).toHaveProperty("themeIntensity", "tinted");
    expect(patch).not.toHaveProperty("masteryRepetitions");
    expect(patch).not.toHaveProperty("maxNewPerDay");
  });

  it("sends the full non-default blob when prev is null and all fields are customised", () => {
    const next = s({ themeIntensity: "tinted", masteryRepetitions: 5 });
    const patch = diffSettings(null, next);
    expect(patch).toHaveProperty("themeIntensity", "tinted");
    expect(patch).toHaveProperty("masteryRepetitions", 5);
  });

  it("returns only the changed top-level keys", () => {
    const prev = s({ masteryRepetitions: 3, themeIntensity: "accents" });
    const next = s({ masteryRepetitions: 3, themeIntensity: "tinted" });
    expect(diffSettings(prev, next)).toEqual({ themeIntensity: "tinted" });
  });

  it("returns an empty object when nothing changed", () => {
    const prev = s({});
    const next = s({});
    expect(diffSettings(prev, next)).toEqual({});
  });

  it("includes nested-object changes by replacing the whole sub-object", () => {
    const prev = s({
      practiceScope: { gens: [1], types: [], presets: [] } as never,
    });
    const next = s({
      practiceScope: { gens: [1, 2], types: [], presets: [] } as never,
    });
    expect(diffSettings(prev, next)).toEqual({
      practiceScope: { gens: [1, 2], types: [], presets: [] },
    });
  });

  it("treats deep-equal nested objects as unchanged via JSON stringification", () => {
    const prev = s({
      onboarding: { welcomeDismissed: true } as never,
    });
    const next = s({
      onboarding: { welcomeDismissed: true } as never,
    });
    expect(diffSettings(prev, next)).toEqual({});
  });

  it("excludes device-local appVisitCount from the first push", () => {
    const next = s({ appVisitCount: 9 });
    expect(diffSettings(null, next)).not.toHaveProperty("appVisitCount");
  });

  it("excludes device-local appVisitCount from the incremental diff", () => {
    const prev = s({ appVisitCount: 1 });
    const next = s({ appVisitCount: 99 });
    expect(diffSettings(prev, next)).toEqual({});
  });

  // ─── Forcing-function: first-push default-prune (#1682) ────────────────────

  it("default-prune: a fully-default first-push produces an empty patch (no cloud clobber)", () => {
    // A stale/fresh device with all defaults must send nothing to cloud.
    const patch = diffSettings(null, { ...DEFAULT_SETTINGS });
    // Device-local keys are already excluded; all remaining keys are default-valued
    // and should be pruned. The result must be empty.
    for (const key of Object.keys(patch)) {
      expect(patch).not.toHaveProperty(key);
    }
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it("default-prune: does NOT prune non-default values on first push", () => {
    const next: UserSettings = {
      ...DEFAULT_SETTINGS,
      masteryRepetitions: 5,      // non-default
      onboarding: {
        ...DEFAULT_SETTINGS.onboarding,
        firstVisitOnboardingDismissed: true,  // non-default
      },
    };
    const patch = diffSettings(null, next);
    expect(patch).toHaveProperty("masteryRepetitions", 5);
    expect(patch).toHaveProperty("onboarding");
    expect((patch.onboarding as typeof next.onboarding)?.firstVisitOnboardingDismissed).toBe(true);
  });

  it("default-prune: once a snapshot exists, sending a value back to default IS included in the diff", () => {
    // After the first push, if the user resets a setting to its default, that is a
    // deliberate action and must be sent (snapshot → next diff, not default-pruned).
    const prev: UserSettings = { ...DEFAULT_SETTINGS, masteryRepetitions: 5 };
    const next: UserSettings = { ...DEFAULT_SETTINGS, masteryRepetitions: 3 }; // reset to default
    const patch = diffSettings(prev, next);
    expect(patch).toHaveProperty("masteryRepetitions", 3);
  });

  it("default-prune: does not allow a default-bearing first push to shrink the key set cloud holds", () => {
    // Simulate a cloud that already has earnedBadges (a non-default richer value).
    // A fresh device with default earnedBadges=[] must NOT include earnedBadges in
    // its first push, because the `||` JSONB overlay would replace the cloud value.
    const freshDevice: UserSettings = { ...DEFAULT_SETTINGS }; // earnedBadges: []
    const patch = diffSettings(null, freshDevice);
    // earnedBadges default is []; after pruning it must be absent from the patch.
    expect(patch).not.toHaveProperty("earnedBadges");
    // onboarding default matches DEFAULT_ONBOARDING; after pruning it must be absent.
    expect(patch).not.toHaveProperty("onboarding");
    // streakProtection default matches DEFAULT_STREAK_PROTECTION; must be absent.
    expect(patch).not.toHaveProperty("streakProtection");
  });

  // ─── Fix 2 / Fix 3: order-insensitive default-prune (#1684) ─────────────────
  //
  // These tests are executable documentation for the switch from JSON.stringify
  // to deepEqual. JSON.stringify is key-order-sensitive: a validator that
  // rebuilds a sub-object via Object.entries spread can produce the same value
  // with a different key order, causing stringify to report a false
  // "differs from default" and re-opening the cloud clobber. deepEqual is
  // key-order-insensitive and must still prune these cases.

  it("default-prune (order-insensitive): still prunes streakProtection with reversed key order", () => {
    // Use streakProtection as the canary: DEFAULT_STREAK_PROTECTION has 6 keys;
    // reversing the entry order produces a structurally-identical object with
    // a different JSON.stringify representation.
    const reversedStreakProtection = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS.streakProtection).reverse(),
    ) as typeof DEFAULT_SETTINGS.streakProtection;

    const next: UserSettings = {
      ...DEFAULT_SETTINGS,
      streakProtection: reversedStreakProtection,
    };

    const patch = diffSettings(null, next);

    // The reversed-key default must be recognised as default-valued and pruned.
    expect(patch).not.toHaveProperty("streakProtection");
  });

  it("default-prune (order-insensitive): still prunes onboarding with reversed key order", () => {
    const reversedOnboarding = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS.onboarding).reverse(),
    ) as typeof DEFAULT_SETTINGS.onboarding;

    const next: UserSettings = {
      ...DEFAULT_SETTINGS,
      onboarding: reversedOnboarding,
    };

    const patch = diffSettings(null, next);
    expect(patch).not.toHaveProperty("onboarding");
  });
});

describe("preserveDeviceLocalKeys", () => {
  it("keeps the local appVisitCount over the cloud value", () => {
    const cloud = s({ appVisitCount: 100, themeIntensity: "tinted" });
    const local = s({ appVisitCount: 4 });
    const result = preserveDeviceLocalKeys(cloud, local);
    expect(result.appVisitCount).toBe(4);
    expect(result.themeIntensity).toBe("tinted");
  });
});

// ─── DEVICE_LOCAL_KEYS includes activePokemonNameLocale (#1568) ──────────────

describe("DEVICE_LOCAL_KEYS (#1568)", () => {
  it("includes activePokemonNameLocale so the per-device active selection is never synced", () => {
    expect(DEVICE_LOCAL_KEYS.has("activePokemonNameLocale")).toBe(true);
  });

  it("includes appVisitCount (existing device-local key)", () => {
    expect(DEVICE_LOCAL_KEYS.has("appVisitCount")).toBe(true);
  });
});

describe("diffSettings excludes activePokemonNameLocale (#1568)", () => {
  it("does not include activePokemonNameLocale in the first-push diff", () => {
    const next = s({ activePokemonNameLocale: "ja" as UserSettings["activePokemonNameLocale"] });
    expect(diffSettings(null, next)).not.toHaveProperty("activePokemonNameLocale");
  });

  it("does not include activePokemonNameLocale in the incremental diff even when it changes", () => {
    const prev = s({ activePokemonNameLocale: "en" as UserSettings["activePokemonNameLocale"] });
    const next = s({ activePokemonNameLocale: "ja" as UserSettings["activePokemonNameLocale"] });
    expect(diffSettings(prev, next)).not.toHaveProperty("activePokemonNameLocale");
  });
});

describe("preserveDeviceLocalKeys: activePokemonNameLocale (#1568)", () => {
  it("keeps the local activePokemonNameLocale over the cloud value", () => {
    const cloud = s({ activePokemonNameLocale: "zh-Hans" as UserSettings["activePokemonNameLocale"], themeIntensity: "tinted" });
    const local = s({ activePokemonNameLocale: "ja" as UserSettings["activePokemonNameLocale"] });
    const result = preserveDeviceLocalKeys(cloud, local);
    expect(result.activePokemonNameLocale).toBe("ja");
    expect(result.themeIntensity).toBe("tinted");
  });
});

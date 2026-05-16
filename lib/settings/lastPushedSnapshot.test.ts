import { describe, it, expect } from "vitest";
import { diffSettings, preserveDeviceLocalKeys } from "./lastPushedSnapshot";
import type { UserSettings } from "./persistence";

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
  it("returns the full object when the snapshot is null (first push)", () => {
    const next = s({ themeIntensity: "tinted" });
    expect(diffSettings(null, next)).toEqual(next);
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

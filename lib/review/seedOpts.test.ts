import { describe, it, expect } from "vitest";
import { seedOptsFromSettings } from "./seedOpts";
import { DEFAULT_SETTINGS } from "@/lib/settings/persistence";

describe("seedOptsFromSettings", () => {
  it("name and reverse are always on regardless of other settings (#1234)", () => {
    // Name and reverse are now always-on directions — no per-direction toggle.
    const opts = seedOptsFromSettings({
      ...DEFAULT_SETTINGS,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: false,
    });

    expect(opts.nameEnabled).toBe(true);
    expect(opts.reverseEnabled).toBe(true);
    expect(opts.evolutionEnabled).toBe(false);
    expect(opts.reverseEvolutionEnabled).toBe(false);
    expect(opts.cryEnabled).toBe(false);
  });

  it("maps opt-in enrichment toggles to the matching buildSession opts", () => {
    const opts = seedOptsFromSettings({
      ...DEFAULT_SETTINGS,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: true,
    });

    expect(opts).toEqual({
      nameEnabled: true,
      evolutionEnabled: true,
      reverseEnabled: true,
      reverseEvolutionEnabled: false,
      cryEnabled: true,
      locale: "en", // DEFAULT_SETTINGS.pokemonNameLocale = "en" (#1259)
    });
  });

  // The defaults exist so that a brand-new install (no stored settings) still
  // builds a usable session. Name and reverse are always on; evolution/cry
  // default to whatever is in DEFAULT_SETTINGS.
  it("returns the correct default for unconfigured settings", () => {
    expect(seedOptsFromSettings(DEFAULT_SETTINGS)).toMatchObject({
      nameEnabled: true,
      reverseEnabled: true,
    });
  });

  it("threads pokemonNameLocale through as locale (#1259)", () => {
    const opts = seedOptsFromSettings({
      ...DEFAULT_SETTINGS,
      pokemonNameLocale: "ja",
    });
    expect(opts.locale).toBe("ja");
  });

  it("defaults locale to en when pokemonNameLocale is not set (#1259)", () => {
    // DEFAULT_SETTINGS should have pokemonNameLocale set to "en"
    const opts = seedOptsFromSettings(DEFAULT_SETTINGS);
    expect(opts.locale).toBe("en");
  });
});

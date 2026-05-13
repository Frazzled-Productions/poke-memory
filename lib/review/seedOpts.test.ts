import { describe, it, expect } from "vitest";
import { seedOptsFromSettings } from "./seedOpts";
import { DEFAULT_SETTINGS } from "@/lib/settings/persistence";

describe("seedOptsFromSettings", () => {
  it("maps each *CardsEnabled toggle to the matching buildSession opt", () => {
    const opts = seedOptsFromSettings({
      ...DEFAULT_SETTINGS,
      nameCardsEnabled: true,
      evolutionCardsEnabled: false,
      reverseCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: true,
    });

    expect(opts).toEqual({
      nameEnabled: true,
      evolutionEnabled: false,
      reverseEnabled: true,
      reverseEvolutionEnabled: false,
      cryEnabled: true,
    });
  });

  // The defaults exist so that a brand-new install (no stored settings) still
  // builds a usable session. Reverse/cry default OFF, name/evolution default
  // ON — exactly what the toggles in Settings display before any user input.
  it("returns the conservative default for unconfigured settings", () => {
    expect(seedOptsFromSettings(DEFAULT_SETTINGS)).toEqual({
      nameEnabled: true,
      evolutionEnabled: true,
      reverseEnabled: false,
      reverseEvolutionEnabled: false,
      cryEnabled: false,
    });
  });
});

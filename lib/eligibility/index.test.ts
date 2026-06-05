/**
 * Unit tests for the shared card-eligibility predicate (#1160).
 *
 * These tests pin the behaviour of `isCardEligible` for every card type,
 * both alt-forms toggle states, and the edge-type `>>>` split so regressions
 * are caught at the shared source rather than in each caller independently.
 */

import { describe, it, expect } from "vitest";
import { isCardEligible, ALT_FORM_ID_THRESHOLD } from "./index";
import type { CardEligibilitySettings, EligibilityInput } from "./index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** All card types enabled, alt-forms on. Maximally permissive baseline. */
const ALL_ON: CardEligibilitySettings = {
  evolutionCardsEnabled: true,
  reverseEvolutionCardsEnabled: true,
  cryCardsEnabled: true,
  alternateFormsEnabled: true,
};

/** All enrichment types disabled; name and reverse are always on (#1234). */
const ALL_OFF: CardEligibilitySettings = {
  evolutionCardsEnabled: false,
  reverseEvolutionCardsEnabled: false,
  cryCardsEnabled: false,
  alternateFormsEnabled: false,
};

function input(cardType: string, subjectKey: string): EligibilityInput {
  return { cardType, subjectKey };
}

// ---------------------------------------------------------------------------
// Card-type gate
// ---------------------------------------------------------------------------

describe("isCardEligible - card-type gate", () => {
  // Name and reverse are always on since #1234.
  it("passes name cards unconditionally", () => {
    expect(isCardEligible(input("name", "25"), ALL_ON)).toBe(true);
    expect(isCardEligible(input("name", "25"), ALL_OFF)).toBe(true);
  });

  it("passes reverse cards unconditionally", () => {
    expect(isCardEligible(input("reverse", "25"), ALL_ON)).toBe(true);
    expect(isCardEligible(input("reverse", "25"), ALL_OFF)).toBe(true);
  });

  // Enrichment card types remain opt-in.
  const enrichmentTypes: Array<[string, string, keyof CardEligibilitySettings]> = [
    ["evolution-edge",         "25>>>26", "evolutionCardsEnabled"],
    ["reverse-evolution-edge", "25>>>26", "reverseEvolutionCardsEnabled"],
    ["cry",                    "25",      "cryCardsEnabled"],
  ];

  for (const [cardType, subjectKey, flag] of enrichmentTypes) {
    it(`passes when ${flag} is true`, () => {
      expect(isCardEligible(input(cardType, subjectKey), ALL_ON)).toBe(true);
    });

    it(`rejects when ${flag} is false`, () => {
      const settings = { ...ALL_ON, [flag]: false };
      expect(isCardEligible(input(cardType, subjectKey), settings)).toBe(false);
    });
  }

  it("passes unknown card types through (forward-compatible)", () => {
    // A future card type should not be silently dropped while callers await
    // an update. Unknown types pass both gates.
    expect(isCardEligible(input("future-type", "42"), ALL_ON)).toBe(true);
    expect(isCardEligible(input("future-type", "42"), ALL_OFF)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Alt-forms gate - name / reverse / cry (integer subjectKey)
// ---------------------------------------------------------------------------

describe("isCardEligible - alt-forms gate for name/reverse/cry cards", () => {
  const BELOW = String(ALT_FORM_ID_THRESHOLD - 1); // "9999"
  const AT    = String(ALT_FORM_ID_THRESHOLD);      // "10000"
  const ABOVE = String(ALT_FORM_ID_THRESHOLD + 99); // "10099"

  const settingsAltOff: CardEligibilitySettings = {
    ...ALL_ON,
    alternateFormsEnabled: false,
  };

  for (const cardType of ["name", "reverse", "cry"] as const) {
    describe(`card type: ${cardType}`, () => {
      it("passes a default-form species (id < 10000) when alt-forms are off", () => {
        expect(isCardEligible(input(cardType, "25"), settingsAltOff)).toBe(true);   // Pikachu
        expect(isCardEligible(input(cardType, BELOW), settingsAltOff)).toBe(true);
      });

      it(`rejects a species at the threshold (id = ${ALT_FORM_ID_THRESHOLD}) when alt-forms are off`, () => {
        expect(isCardEligible(input(cardType, AT), settingsAltOff)).toBe(false);
      });

      it("rejects an alt-form species (id >= 10000) when alt-forms are off", () => {
        expect(isCardEligible(input(cardType, "10100"), settingsAltOff)).toBe(false); // Alolan Raichu
        expect(isCardEligible(input(cardType, ABOVE), settingsAltOff)).toBe(false);
      });

      it("passes an alt-form species when alt-forms are on", () => {
        expect(isCardEligible(input(cardType, "10100"), ALL_ON)).toBe(true);
        expect(isCardEligible(input(cardType, ABOVE), ALL_ON)).toBe(true);
      });

      it(`${cardType === "cry" ? "rejects the cry card when cryCardsEnabled is off" : "passes the card even when alt-forms are off (name/reverse always on)"}`, () => {
        if (cardType === "cry") {
          // Cry is opt-in; turning off cryCardsEnabled gates it even for default-form species.
          const settings: CardEligibilitySettings = {
            ...settingsAltOff,
            cryCardsEnabled: false,
          };
          expect(isCardEligible(input(cardType, "25"), settings)).toBe(false);
        } else {
          // Name and reverse are always on (#1234) - no gate to turn off.
          // The alt-forms gate still applies, but a default-form species (id=25) passes.
          expect(isCardEligible(input(cardType, "25"), settingsAltOff)).toBe(true);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Alt-forms gate - evolution-edge / reverse-evolution-edge (>>> subjectKey)
// ---------------------------------------------------------------------------

describe("isCardEligible - alt-forms gate for edge cards", () => {
  const settingsAltOff: CardEligibilitySettings = {
    ...ALL_ON,
    alternateFormsEnabled: false,
  };

  for (const cardType of ["evolution-edge", "reverse-evolution-edge"] as const) {
    describe(`card type: ${cardType}`, () => {
      it("passes when both endpoints are default-form species (< 10000)", () => {
        expect(isCardEligible(input(cardType, "133>>>134"), settingsAltOff)).toBe(true); // Eevee→Vaporeon
        expect(isCardEligible(input(cardType, "25>>>26"),   settingsAltOff)).toBe(true); // Pikachu→Raichu
      });

      it("rejects when the fromId endpoint is an alt-form (>= 10000)", () => {
        expect(isCardEligible(input(cardType, "10027>>>10028"), settingsAltOff)).toBe(false);
      });

      it("rejects when the toId endpoint is an alt-form (>= 10000)", () => {
        expect(isCardEligible(input(cardType, "26>>>10023"), settingsAltOff)).toBe(false);
      });

      it("rejects when both endpoints are alt-forms", () => {
        expect(isCardEligible(input(cardType, "10100>>>10200"), settingsAltOff)).toBe(false);
      });

      it("passes all edges when alt-forms are on, regardless of endpoint ids", () => {
        expect(isCardEligible(input(cardType, "10027>>>10028"), ALL_ON)).toBe(true);
        expect(isCardEligible(input(cardType, "26>>>10023"),    ALL_ON)).toBe(true);
      });

      it("does not crash on a malformed subjectKey (no >>> separator)", () => {
        // Malformed key: the split yields only one part, so the alt-form check
        // is skipped and the card passes gate 2. Gate 1 already passed.
        expect(isCardEligible(input(cardType, "25-26"), settingsAltOff)).toBe(true);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Consistency: client adapter == server adapter
// ---------------------------------------------------------------------------

describe("isCardEligible - representative client/server parity inputs", () => {
  /**
   * Verify that the same logical card produces the same eligibility result
   * when addressed via the server row shape (DB card_type + subjectKey) and
   * the equivalent client shape (also mapped to DB card_type + subjectKey by
   * the adapter in lib/review/scope.ts).
   *
   * Both callers now route through isCardEligible with identical inputs, so
   * this test mostly documents the contract rather than catching divergence.
   */

  const settingsAltOff: CardEligibilitySettings = {
    evolutionCardsEnabled: true,
    reverseEvolutionCardsEnabled: false,
    cryCardsEnabled: false,
    alternateFormsEnabled: false,
  };

  it("name card for Pikachu (id=25) passes with alt-forms off", () => {
    expect(isCardEligible({ cardType: "name", subjectKey: "25" }, settingsAltOff)).toBe(true);
  });

  it("name card for Alolan Raichu (id=10100) is excluded with alt-forms off", () => {
    expect(isCardEligible({ cardType: "name", subjectKey: "10100" }, settingsAltOff)).toBe(false);
  });

  it("evolution-edge for Eevee→Vaporeon (133>>>134) passes with alt-forms off", () => {
    expect(isCardEligible({ cardType: "evolution-edge", subjectKey: "133>>>134" }, settingsAltOff)).toBe(true);
  });

  it("reverse card for Pikachu passes (reverse is always on since #1234)", () => {
    // Reverse is always on - no toggle to disable it.
    expect(isCardEligible({ cardType: "reverse", subjectKey: "25" }, settingsAltOff)).toBe(true);
  });

  it("reverse card for Alolan Raichu (id=10100) is excluded with alt-forms off", () => {
    expect(isCardEligible({ cardType: "reverse", subjectKey: "10100" }, settingsAltOff)).toBe(false);
  });
});

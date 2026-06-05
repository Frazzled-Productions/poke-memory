import { describe, it, expect } from "vitest";
import {
  isNonNullObject,
  isKnownCardType,
  isEvolutionCardShaped,
  isBaseCardShaped,
} from "./card-shape";

// ---------------------------------------------------------------------------
// isNonNullObject
// ---------------------------------------------------------------------------

describe("isNonNullObject", () => {
  it("returns true for a plain object", () => {
    expect(isNonNullObject({})).toBe(true);
  });

  it("returns true for an array (arrays are objects)", () => {
    expect(isNonNullObject([])).toBe(true);
  });

  it("returns false for null", () => {
    expect(isNonNullObject(null)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isNonNullObject("hello")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isNonNullObject(42)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isNonNullObject(undefined)).toBe(false);
  });

  it("returns false for a boolean", () => {
    expect(isNonNullObject(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isKnownCardType
// ---------------------------------------------------------------------------

describe("isKnownCardType", () => {
  it("returns true for undefined (legacy default)", () => {
    expect(isKnownCardType(undefined)).toBe(true);
  });

  it("returns true for 'name'", () => {
    expect(isKnownCardType("name")).toBe(true);
  });

  it("returns true for 'evolution'", () => {
    expect(isKnownCardType("evolution")).toBe(true);
  });

  it("returns true for 'reverse-evolution'", () => {
    expect(isKnownCardType("reverse-evolution")).toBe(true);
  });

  it("returns true for 'reverse'", () => {
    expect(isKnownCardType("reverse")).toBe(true);
  });

  it("returns true for 'cry'", () => {
    expect(isKnownCardType("cry")).toBe(true);
  });

  it("returns false for an unknown string", () => {
    expect(isKnownCardType("unknown-type")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isKnownCardType(null)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isKnownCardType(1)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isKnownCardType("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEvolutionCardShaped
// ---------------------------------------------------------------------------

describe("isEvolutionCardShaped", () => {
  it("returns true for the new edge shape (postEvoId number)", () => {
    expect(isEvolutionCardShaped({ postEvoId: 2 })).toBe(true);
  });

  it("returns true for the legacy evolvesInto shape with valid entries", () => {
    expect(
      isEvolutionCardShaped({
        evolvesInto: [{ name: "Charmeleon", spriteUrl: "/sprites/5.png" }],
      }),
    ).toBe(true);
  });

  it("returns true for an empty evolvesInto array", () => {
    // An empty array passes every() vacuously - the file still validates.
    expect(isEvolutionCardShaped({ evolvesInto: [] })).toBe(true);
  });

  it("returns false for evolvesInto with missing spriteUrl", () => {
    expect(
      isEvolutionCardShaped({ evolvesInto: [{ name: "Charmeleon" }] }),
    ).toBe(false);
  });

  it("returns false for evolvesInto with missing name", () => {
    expect(
      isEvolutionCardShaped({
        evolvesInto: [{ spriteUrl: "/sprites/5.png" }],
      }),
    ).toBe(false);
  });

  it("returns false for evolvesInto entries that are not objects", () => {
    expect(isEvolutionCardShaped({ evolvesInto: ["Charmeleon"] })).toBe(false);
  });

  it("returns false for evolvesInto entries that are null", () => {
    expect(isEvolutionCardShaped({ evolvesInto: [null] })).toBe(false);
  });

  it("returns true for the legacy evolvesIntoNames shape with all strings", () => {
    expect(
      isEvolutionCardShaped({ evolvesIntoNames: ["Charmeleon"] }),
    ).toBe(true);
  });

  it("returns true for an empty evolvesIntoNames array", () => {
    expect(isEvolutionCardShaped({ evolvesIntoNames: [] })).toBe(true);
  });

  it("returns false for evolvesIntoNames containing a non-string", () => {
    expect(isEvolutionCardShaped({ evolvesIntoNames: [42] })).toBe(false);
  });

  it("returns false when none of the three shapes are present", () => {
    expect(isEvolutionCardShaped({ id: 1 })).toBe(false);
  });

  it("prefers postEvoId over other fields (short-circuits on first truthy shape)", () => {
    // postEvoId takes priority - the presence of both is still valid.
    expect(
      isEvolutionCardShaped({
        postEvoId: 2,
        evolvesIntoNames: [42], // would fail on its own
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isBaseCardShaped
// ---------------------------------------------------------------------------

describe("isBaseCardShaped - basic invariants", () => {
  function validBase(): Record<string, unknown> {
    return { id: 1, state: { dueDate: "2026-05-02" } };
  }

  it("accepts a minimal valid card (no cardType)", () => {
    expect(isBaseCardShaped(validBase())).toBe(true);
  });

  it("accepts cardType 'name'", () => {
    expect(isBaseCardShaped({ ...validBase(), cardType: "name" })).toBe(true);
  });

  it("accepts cardType 'reverse'", () => {
    expect(isBaseCardShaped({ ...validBase(), cardType: "reverse" })).toBe(true);
  });

  it("accepts cardType 'cry'", () => {
    expect(isBaseCardShaped({ ...validBase(), cardType: "cry" })).toBe(true);
  });

  it("accepts cardType 'reverse-evolution' (no extra fields required at base level)", () => {
    expect(
      isBaseCardShaped({ ...validBase(), cardType: "reverse-evolution" }),
    ).toBe(true);
  });

  it("rejects null", () => {
    expect(isBaseCardShaped(null)).toBe(false);
  });

  it("rejects a string", () => {
    expect(isBaseCardShaped("{}")).toBe(false);
  });

  it("rejects a number", () => {
    expect(isBaseCardShaped(42)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isBaseCardShaped(undefined)).toBe(false);
  });

  it("rejects when id is a string", () => {
    expect(isBaseCardShaped({ ...validBase(), id: "1" })).toBe(false);
  });

  it("rejects when id is missing", () => {
    const c = validBase();
    delete c["id"];
    expect(isBaseCardShaped(c)).toBe(false);
  });

  it("rejects when state is missing", () => {
    const c = validBase();
    delete c["state"];
    expect(isBaseCardShaped(c)).toBe(false);
  });

  it("rejects when state is null", () => {
    expect(isBaseCardShaped({ ...validBase(), state: null })).toBe(false);
  });

  it("rejects when state is not an object", () => {
    expect(isBaseCardShaped({ ...validBase(), state: "bad" })).toBe(false);
  });

  it("rejects when state.dueDate is missing", () => {
    expect(isBaseCardShaped({ id: 1, state: {} })).toBe(false);
  });

  it("rejects when state.dueDate is not a string", () => {
    expect(isBaseCardShaped({ id: 1, state: { dueDate: 12345 } })).toBe(false);
  });

  it("rejects an unknown cardType", () => {
    expect(
      isBaseCardShaped({ ...validBase(), cardType: "totally-unknown" }),
    ).toBe(false);
  });
});

describe("isBaseCardShaped - evolution card validation", () => {
  function validBase(): Record<string, unknown> {
    return { id: 1, state: { dueDate: "2026-05-02" }, cardType: "evolution" };
  }

  it("accepts the new edge shape (postEvoId)", () => {
    expect(isBaseCardShaped({ ...validBase(), postEvoId: 2 })).toBe(true);
  });

  it("accepts the legacy evolvesInto shape", () => {
    expect(
      isBaseCardShaped({
        ...validBase(),
        evolvesInto: [{ name: "Charmeleon", spriteUrl: "/sprites/5.png" }],
      }),
    ).toBe(true);
  });

  it("accepts the legacy evolvesIntoNames shape", () => {
    expect(
      isBaseCardShaped({ ...validBase(), evolvesIntoNames: ["Charmeleon"] }),
    ).toBe(true);
  });

  it("rejects an evolution card with no recognised shape", () => {
    expect(isBaseCardShaped(validBase())).toBe(false);
  });

  it("rejects an evolution card where evolvesInto entries are missing spriteUrl", () => {
    expect(
      isBaseCardShaped({
        ...validBase(),
        evolvesInto: [{ name: "Charmeleon" }],
      }),
    ).toBe(false);
  });

  it("rejects an evolution card where evolvesIntoNames contains a non-string", () => {
    expect(
      isBaseCardShaped({ ...validBase(), evolvesIntoNames: [42] }),
    ).toBe(false);
  });
});

describe("isBaseCardShaped - reverse-evolution does NOT require preEvoId/postEvoId", () => {
  // isBaseCardShaped is lenient on reverse-evolution; only isReviewCardShaped
  // in persistence.ts layers that extra strictness on top.
  it("accepts a reverse-evolution card without preEvoId or postEvoId", () => {
    expect(
      isBaseCardShaped({
        id: 1,
        cardType: "reverse-evolution",
        state: { dueDate: "2026-05-02" },
      }),
    ).toBe(true);
  });
});

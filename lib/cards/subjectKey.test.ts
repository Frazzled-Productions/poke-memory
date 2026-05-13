import { describe, it, expect } from "vitest";
import {
  Subject,
  isValidCardType,
  CARD_TYPES,
  legacyCardId,
  appTypeToDbType,
  dbTypeToAppType,
  type CardType,
} from "./subjectKey";

// ─── isValidCardType ──────────────────────────────────────────────────────────

describe("isValidCardType", () => {
  it("returns true for all members of CARD_TYPES", () => {
    for (const t of CARD_TYPES) {
      expect(isValidCardType(t)).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isValidCardType("evolution")).toBe(false);
    expect(isValidCardType("reverse-evolution")).toBe(false);
    expect(isValidCardType("")).toBe(false);
    expect(isValidCardType("Name")).toBe(false);
  });

  it("covers all five expected DB card types", () => {
    expect(CARD_TYPES).toContain("name");
    expect(CARD_TYPES).toContain("reverse");
    expect(CARD_TYPES).toContain("cry");
    expect(CARD_TYPES).toContain("evolution-edge");
    expect(CARD_TYPES).toContain("reverse-evolution-edge");
    expect(CARD_TYPES).toHaveLength(5);
  });
});

// ─── Subject.forSpecies ───────────────────────────────────────────────────────

describe("Subject.forSpecies", () => {
  it("encodes species ID 1", () => {
    expect(Subject.forSpecies(1)).toBe("1");
  });

  it("encodes species ID 25 (Pikachu)", () => {
    expect(Subject.forSpecies(25)).toBe("25");
  });

  it("encodes species ID 1025 (max known)", () => {
    expect(Subject.forSpecies(1025)).toBe("1025");
  });

  it("throws on zero", () => {
    expect(() => Subject.forSpecies(0)).toThrow();
  });

  it("throws on negative numbers", () => {
    expect(() => Subject.forSpecies(-1)).toThrow();
  });

  it("throws on non-integer", () => {
    expect(() => Subject.forSpecies(1.5)).toThrow();
  });
});

// ─── Subject.parseSpecies ─────────────────────────────────────────────────────

describe("Subject.parseSpecies", () => {
  it("round-trips forSpecies → parseSpecies", () => {
    for (const id of [1, 25, 133, 1000, 1025]) {
      expect(Subject.parseSpecies(Subject.forSpecies(id))).toBe(id);
    }
  });

  it("throws on non-integer string", () => {
    expect(() => Subject.parseSpecies("1.5")).toThrow();
  });

  it("throws on zero", () => {
    expect(() => Subject.parseSpecies("0")).toThrow();
  });

  it("throws on negative", () => {
    expect(() => Subject.parseSpecies("-1")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => Subject.parseSpecies("")).toThrow();
  });

  it("throws on strings that look like edge keys", () => {
    expect(() => Subject.parseSpecies("1>>>2")).toThrow();
  });

  it("throws on NaN-producing strings", () => {
    expect(() => Subject.parseSpecies("abc")).toThrow();
  });
});

// ─── Subject.forEdge / parseEdge ─────────────────────────────────────────────

describe("Subject.forEdge + parseEdge (round-trip)", () => {
  it("encodes and decodes Bulbasaur → Ivysaur (1 → 2)", () => {
    const key = Subject.forEdge(1, 2);
    expect(key).toBe("1>>>2");
    expect(Subject.parseEdge(key)).toEqual({ fromId: 1, toId: 2 });
  });

  it("encodes and decodes Eevee → Vaporeon (133 → 134)", () => {
    const key = Subject.forEdge(133, 134);
    expect(Subject.parseEdge(key)).toEqual({ fromId: 133, toId: 134 });
  });

  it("encodes and decodes an edge with large IDs", () => {
    const key = Subject.forEdge(1000, 1025);
    expect(Subject.parseEdge(key)).toEqual({ fromId: 1000, toId: 1025 });
  });

  it("keys with different (from, to) pairs are distinct — no collision", () => {
    expect(Subject.forEdge(1, 25)).not.toBe(Subject.forEdge(1, 26));
    expect(Subject.forEdge(1, 25)).not.toBe(Subject.forEdge(2, 5));
    expect(Subject.forEdge(1, 25)).not.toBe(Subject.forEdge(125, 1));
  });

  it("the >>> separator does not appear in plain species keys", () => {
    for (const id of [1, 25, 133, 1025]) {
      expect(Subject.forSpecies(id)).not.toContain(">>>");
    }
  });
});

describe("Subject.forEdge (error cases)", () => {
  it("throws on fromId = 0", () => {
    expect(() => Subject.forEdge(0, 2)).toThrow();
  });

  it("throws on negative fromId", () => {
    expect(() => Subject.forEdge(-1, 2)).toThrow();
  });

  it("throws on toId = 0", () => {
    expect(() => Subject.forEdge(1, 0)).toThrow();
  });

  it("throws on negative toId", () => {
    expect(() => Subject.forEdge(1, -5)).toThrow();
  });

  it("throws on non-integer fromId", () => {
    expect(() => Subject.forEdge(1.5, 2)).toThrow();
  });

  it("throws on non-integer toId", () => {
    expect(() => Subject.forEdge(1, 2.5)).toThrow();
  });
});

describe("Subject.parseEdge (error cases)", () => {
  it("throws when separator is missing", () => {
    expect(() => Subject.parseEdge("125")).toThrow();
    expect(() => Subject.parseEdge("")).toThrow();
  });

  it("throws when fromId part is not a positive integer", () => {
    expect(() => Subject.parseEdge("0>>>2")).toThrow();
    expect(() => Subject.parseEdge("-1>>>2")).toThrow();
    expect(() => Subject.parseEdge("abc>>>2")).toThrow();
  });

  it("throws when toId part is not a positive integer", () => {
    expect(() => Subject.parseEdge("1>>>0")).toThrow();
    expect(() => Subject.parseEdge("1>>>-5")).toThrow();
    expect(() => Subject.parseEdge("1>>>xyz")).toThrow();
  });

  it("does not allow float parts", () => {
    expect(() => Subject.parseEdge("1.5>>>2")).toThrow();
    expect(() => Subject.parseEdge("1>>>2.5")).toThrow();
  });
});

// ─── appTypeToDbType / dbTypeToAppType ───────────────────────────────────────

describe("appTypeToDbType", () => {
  it('maps "evolution" to "evolution-edge"', () => {
    expect(appTypeToDbType("evolution")).toBe("evolution-edge");
  });

  it('maps "reverse-evolution" to "reverse-evolution-edge"', () => {
    expect(appTypeToDbType("reverse-evolution")).toBe("reverse-evolution-edge");
  });

  it("passes through name, reverse, cry unchanged", () => {
    expect(appTypeToDbType("name")).toBe("name");
    expect(appTypeToDbType("reverse")).toBe("reverse");
    expect(appTypeToDbType("cry")).toBe("cry");
  });

  it("result is always a valid CardType", () => {
    const appTypes = ["name", "reverse", "cry", "evolution", "reverse-evolution"] as const;
    for (const t of appTypes) {
      expect(isValidCardType(appTypeToDbType(t))).toBe(true);
    }
  });
});

describe("dbTypeToAppType", () => {
  it('maps "evolution-edge" to "evolution"', () => {
    expect(dbTypeToAppType("evolution-edge")).toBe("evolution");
  });

  it('maps "reverse-evolution-edge" to "reverse-evolution"', () => {
    expect(dbTypeToAppType("reverse-evolution-edge")).toBe("reverse-evolution");
  });

  it("passes through name, reverse, cry unchanged", () => {
    expect(dbTypeToAppType("name")).toBe("name");
    expect(dbTypeToAppType("reverse")).toBe("reverse");
    expect(dbTypeToAppType("cry")).toBe("cry");
  });

  it("returns null for unknown DB types", () => {
    expect(dbTypeToAppType("future-type")).toBeNull();
    expect(dbTypeToAppType("")).toBeNull();
    expect(dbTypeToAppType("EVOLUTION-EDGE")).toBeNull();
  });

  it("round-trips through appTypeToDbType for all known types", () => {
    const appTypes = ["name", "reverse", "cry", "evolution", "reverse-evolution"] as const;
    for (const t of appTypes) {
      expect(dbTypeToAppType(appTypeToDbType(t))).toBe(t);
    }
  });
});

// ─── legacyCardId ─────────────────────────────────────────────────────────────

describe("legacyCardId (deprecated)", () => {
  it("returns the species ID for a name card", () => {
    expect(legacyCardId("name", "1")).toBe(1);
    expect(legacyCardId("name", "25")).toBe(25);
    expect(legacyCardId("name", "1025")).toBe(1025);
  });

  it("returns REVERSE_ID_OFFSET + speciesId for a reverse card", () => {
    // REVERSE_ID_OFFSET = 2_000_000
    expect(legacyCardId("reverse", "1")).toBe(2_000_001);
    expect(legacyCardId("reverse", "25")).toBe(2_000_025);
  });

  it("returns CRY_ID_OFFSET + speciesId for a cry card", () => {
    // CRY_ID_OFFSET = 3_000_000
    expect(legacyCardId("cry", "1")).toBe(3_000_001);
    expect(legacyCardId("cry", "25")).toBe(3_000_025);
  });
});

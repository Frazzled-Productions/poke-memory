import { describe, it, expect } from "vitest";
import {
  normaliseInput,
  levenshtein,
  distanceToGrade,
  gradeTypedAnswer,
} from "./typedEntryGrade";

// ── normaliseInput ────────────────────────────────────────────────────────────

describe("normaliseInput", () => {
  it("trims leading/trailing whitespace", () => {
    expect(normaliseInput("  pikachu  ")).toBe("pikachu");
  });

  it("lowercases the input", () => {
    expect(normaliseInput("Pikachu")).toBe("pikachu");
    expect(normaliseInput("MR. MIME")).toBe("mrmime");
  });

  it("strips ASCII punctuation and spaces", () => {
    expect(normaliseInput("mr. mime")).toBe("mrmime");
    expect(normaliseInput("mr mime")).toBe("mrmime");
    expect(normaliseInput("nidoran-f")).toBe("nidoranf");
    expect(normaliseInput("farfetch'd")).toBe("farfetchd");
    expect(normaliseInput("flabébé")).toBe("flabébé");
  });

  it("collapses separator variants to the same form", () => {
    // "Porygon-Z" typed as "porygon-z", "porygon z", or "porygonz" all normalise
    // identically, so the user is not penalised for using a space vs a hyphen.
    expect(normaliseInput("Porygon-Z")).toBe("porygonz");
    expect(normaliseInput("porygon-z")).toBe("porygonz");
    expect(normaliseInput("porygon z")).toBe("porygonz");
    expect(normaliseInput("porygonz")).toBe("porygonz");
    // Same for "Jangmo-o" and "Chi-Yu"
    expect(normaliseInput("Jangmo-o")).toBe("jangmoo");
    expect(normaliseInput("jangmo o")).toBe("jangmoo");
    expect(normaliseInput("Chi-Yu")).toBe("chiyu");
    expect(normaliseInput("chi yu")).toBe("chiyu");
    // "Ho-Oh"
    expect(normaliseInput("Ho-Oh")).toBe("hooh");
    expect(normaliseInput("ho oh")).toBe("hooh");
  });

  it("handles empty string", () => {
    expect(normaliseInput("")).toBe("");
    expect(normaliseInput("   ")).toBe("");
  });

  it("preserves accented characters", () => {
    expect(normaliseInput("Flabébé")).toBe("flabébé");
  });
});

// ── levenshtein ───────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("pikachu", "pikachu")).toBe(0);
    expect(levenshtein("", "")).toBe(0);
  });

  it("returns the length of the non-empty string for an empty string", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("counts a single substitution as distance 1", () => {
    // 'pikachv' → substitute v→u
    expect(levenshtein("pikachv", "pikachu")).toBe(1);
  });

  it("counts two substitutions as distance 2", () => {
    // 'pikacha' = a, 'pikachv' = substitute two chars
    expect(levenshtein("pikachav", "pikachu")).toBe(2);
  });

  it("counts insertions and deletions", () => {
    expect(levenshtein("pikahu", "pikachu")).toBe(1);   // missing 'c'
    expect(levenshtein("pikachuu", "pikachu")).toBe(1); // extra 'u'
  });

  it("is symmetric", () => {
    expect(levenshtein("bulbasaur", "bulbsaur")).toBe(levenshtein("bulbsaur", "bulbasaur"));
  });
});

// ── distanceToGrade ───────────────────────────────────────────────────────────

describe("distanceToGrade", () => {
  it("returns Good (4) for exact match (distance 0)", () => {
    expect(distanceToGrade(0)).toBe(4);
  });

  it("returns Hard (2) for distance 1", () => {
    expect(distanceToGrade(1)).toBe(2);
  });

  it("returns Hard (2) for distance 2", () => {
    expect(distanceToGrade(2)).toBe(2);
  });

  it("returns Again (1) for distance 3", () => {
    expect(distanceToGrade(3)).toBe(1);
  });

  it("returns Again (1) for large distances", () => {
    expect(distanceToGrade(10)).toBe(1);
    expect(distanceToGrade(99)).toBe(1);
  });
});

// ── gradeTypedAnswer ──────────────────────────────────────────────────────────

describe("gradeTypedAnswer", () => {
  it("grades an exact match as Good (4)", () => {
    const { grade, distance } = gradeTypedAnswer("Pikachu", "Pikachu");
    expect(grade).toBe(4);
    expect(distance).toBe(0);
  });

  it("grades a case-insensitive exact match as Good (4)", () => {
    const { grade } = gradeTypedAnswer("pikachu", "Pikachu");
    expect(grade).toBe(4);
  });

  it("grades a one-character typo as Hard (2)", () => {
    const { grade, distance } = gradeTypedAnswer("Pikachv", "Pikachu");
    expect(grade).toBe(2);
    expect(distance).toBe(1);
  });

  it("grades a two-character typo as Hard (2)", () => {
    const { grade, distance } = gradeTypedAnswer("Pikacho", "Pikachu");
    expect(grade).toBe(2);
    expect(distance).toBeLessThanOrEqual(2);
  });

  it("grades a very wrong answer as Again (1)", () => {
    const { grade } = gradeTypedAnswer("Squirtle", "Pikachu");
    expect(grade).toBe(1);
  });

  it("grades an empty string as Again (1)", () => {
    const { grade } = gradeTypedAnswer("", "Pikachu");
    expect(grade).toBe(1);
  });

  it("grades a whitespace-only input as Again (1)", () => {
    const { grade } = gradeTypedAnswer("   ", "Pikachu");
    expect(grade).toBe(1);
  });

  it("strips punctuation before comparing - mr. mime matches Mr. Mime", () => {
    const { grade } = gradeTypedAnswer("mr. mime", "Mr. Mime");
    expect(grade).toBe(4);
  });

  it("strips punctuation before comparing - farfetchd matches Farfetch'd", () => {
    const { grade } = gradeTypedAnswer("farfetchd", "Farfetch'd");
    expect(grade).toBe(4);
  });

  // Hyphenated / separator-variant fairness (#1251 code-reviewer concern 2)
  it("grades 'porygon z' as Good against canonical 'Porygon-Z'", () => {
    const { grade } = gradeTypedAnswer("porygon z", "Porygon-Z");
    expect(grade).toBe(4);
  });

  it("grades 'porygonz' as Good against canonical 'Porygon-Z'", () => {
    const { grade } = gradeTypedAnswer("porygonz", "Porygon-Z");
    expect(grade).toBe(4);
  });

  it("grades 'porygon-z' as Good against canonical 'Porygon-Z'", () => {
    const { grade } = gradeTypedAnswer("porygon-z", "Porygon-Z");
    expect(grade).toBe(4);
  });

  it("grades 'jangmo o' as Good against canonical 'Jangmo-o'", () => {
    const { grade } = gradeTypedAnswer("jangmo o", "Jangmo-o");
    expect(grade).toBe(4);
  });

  it("grades 'chi yu' as Good against canonical 'Chi-Yu'", () => {
    const { grade } = gradeTypedAnswer("chi yu", "Chi-Yu");
    expect(grade).toBe(4);
  });

  it("grades 'ho oh' as Good against canonical 'Ho-Oh'", () => {
    const { grade } = gradeTypedAnswer("ho oh", "Ho-Oh");
    expect(grade).toBe(4);
  });

  it("grades 'mr mime' as Good against canonical 'Mr. Mime'", () => {
    const { grade } = gradeTypedAnswer("mr mime", "Mr. Mime");
    expect(grade).toBe(4);
  });
});

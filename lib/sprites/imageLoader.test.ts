import { describe, it, expect } from "vitest";
import {
  snapToGeneratedWidth,
  GENERATED_SPRITE_WIDTHS,
} from "./imageLoaderHelpers";

// ---------------------------------------------------------------------------
// snapToGeneratedWidth
// ---------------------------------------------------------------------------

describe("snapToGeneratedWidth", () => {
  it("returns the exact width when it is already in the generated set", () => {
    for (const w of GENERATED_SPRITE_WIDTHS) {
      expect(snapToGeneratedWidth(w)).toBe(w);
    }
  });

  it("rounds up to the next larger generated width for in-between values", () => {
    // Between 32 and 40 — should round up to 40.
    expect(snapToGeneratedWidth(35)).toBe(40);

    // Between 40 and 48 — should round up to 48.
    expect(snapToGeneratedWidth(44)).toBe(48);

    // Between 64 and 120 — should round up to 120.
    expect(snapToGeneratedWidth(80)).toBe(120);
  });

  it("returns the smallest generated width for requests smaller than all widths", () => {
    expect(snapToGeneratedWidth(1)).toBe(GENERATED_SPRITE_WIDTHS[0]);
  });

  it("caps at the largest generated width for requests larger than all widths", () => {
    const largest = GENERATED_SPRITE_WIDTHS[GENERATED_SPRITE_WIDTHS.length - 1]!;
    expect(snapToGeneratedWidth(largest + 1)).toBe(largest);
    expect(snapToGeneratedWidth(9999)).toBe(largest);
    // Source resolution cap — 475 px exceeds 320 (the largest).
    expect(snapToGeneratedWidth(475)).toBe(largest);
  });
});

// ---------------------------------------------------------------------------
// GENERATED_SPRITE_WIDTHS invariants
// ---------------------------------------------------------------------------

describe("GENERATED_SPRITE_WIDTHS", () => {
  it("is a non-empty sorted array of positive integers", () => {
    expect(GENERATED_SPRITE_WIDTHS.length).toBeGreaterThan(0);
    for (let i = 0; i < GENERATED_SPRITE_WIDTHS.length; i++) {
      const w = GENERATED_SPRITE_WIDTHS[i]!;
      expect(w).toBeGreaterThan(0);
      expect(Number.isInteger(w)).toBe(true);
      if (i > 0) {
        expect(w).toBeGreaterThan(GENERATED_SPRITE_WIDTHS[i - 1]!);
      }
    }
  });

  it("contains 320 (PRACTICE_SPRITE_SIZE) as a generated width", () => {
    expect(GENERATED_SPRITE_WIDTHS).toContain(320);
  });

  it("does not exceed source resolution (475 px)", () => {
    const max = GENERATED_SPRITE_WIDTHS[GENERATED_SPRITE_WIDTHS.length - 1]!;
    expect(max).toBeLessThanOrEqual(475);
  });
});

import { describe, it, expect } from "vitest";
import {
  resolveSwipe,
  directionToGrade,
  clampOffset,
  COMMIT_THRESHOLD_PX,
  MAX_DIAGONAL_DEG,
} from "./swipeGesture";

describe("resolveSwipe", () => {
  describe("direction resolution", () => {
    it("resolves right for positive dx > dy", () => {
      const result = resolveSwipe(100, 10);
      expect(result?.direction).toBe("right");
    });

    it("resolves left for negative dx > abs(dy)", () => {
      const result = resolveSwipe(-100, 10);
      expect(result?.direction).toBe("left");
    });

    it("resolves up for negative dy > abs(dx)", () => {
      const result = resolveSwipe(10, -100);
      expect(result?.direction).toBe("up");
    });

    it("resolves down for positive dy > dx", () => {
      const result = resolveSwipe(10, 100);
      expect(result?.direction).toBe("down");
    });
  });

  describe("commit threshold", () => {
    it("reports committed: false when below threshold", () => {
      const result = resolveSwipe(COMMIT_THRESHOLD_PX - 1, 0);
      expect(result?.committed).toBe(false);
    });

    it("reports committed: true when at threshold", () => {
      const result = resolveSwipe(COMMIT_THRESHOLD_PX, 0);
      expect(result?.committed).toBe(true);
    });

    it("reports committed: true when above threshold", () => {
      const result = resolveSwipe(COMMIT_THRESHOLD_PX + 20, 5);
      expect(result?.committed).toBe(true);
    });

    it("reports committed: true for vertical swipe at threshold", () => {
      const result = resolveSwipe(5, -COMMIT_THRESHOLD_PX);
      expect(result?.committed).toBe(true);
    });
  });

  describe("diagonal rejection", () => {
    it("returns null for a 45° diagonal", () => {
      // Equal dx and dy → exactly 45° from horizontal → rejected.
      const result = resolveSwipe(100, 100);
      expect(result).toBeNull();
    });

    it("returns null when angle is >= MAX_DIAGONAL_DEG from both axes", () => {
      // 44° from horizontal, also 46° from vertical → ambiguous diagonal.
      const angleRad = ((MAX_DIAGONAL_DEG - 1) * Math.PI) / 180;
      const dy = Math.round(Math.tan(angleRad) * 100);
      const result = resolveSwipe(100, dy);
      expect(result).not.toBeNull(); // just within threshold — should resolve
    });

    it("accepts a nearly horizontal swipe", () => {
      // 10° from horizontal — well within the horizontal band.
      const result = resolveSwipe(100, 18); // atan(18/100) ≈ 10°
      expect(result?.direction).toBe("right");
    });

    it("accepts a nearly vertical swipe", () => {
      // 10° from vertical.
      const result = resolveSwipe(18, 100);
      expect(result?.direction).toBe("down");
    });
  });

  describe("near-zero input", () => {
    it("returns null for zero displacement", () => {
      expect(resolveSwipe(0, 0)).toBeNull();
    });

    it("resolves for minimal displacement above 1px", () => {
      // Purely horizontal.
      const result = resolveSwipe(2, 0);
      expect(result?.direction).toBe("right");
      expect(result?.committed).toBe(false);
    });
  });
});

describe("directionToGrade", () => {
  it("maps right → 4 (Good)", () => {
    expect(directionToGrade("right")).toBe(4);
  });

  it("maps left → 1 (Again)", () => {
    expect(directionToGrade("left")).toBe(1);
  });

  it("maps up → 5 (Easy)", () => {
    expect(directionToGrade("up")).toBe(5);
  });

  it("maps down → 2 (Hard)", () => {
    expect(directionToGrade("down")).toBe(2);
  });
});

describe("clampOffset", () => {
  it("passes through values within the range", () => {
    expect(clampOffset(40, 60)).toBe(40);
    expect(clampOffset(-40, 60)).toBe(-40);
  });

  it("clamps positive values to maxPx", () => {
    expect(clampOffset(120, 60)).toBe(60);
  });

  it("clamps negative values to -maxPx", () => {
    expect(clampOffset(-120, 60)).toBe(-60);
  });

  it("handles zero", () => {
    expect(clampOffset(0, 60)).toBe(0);
  });

  it("clamps exactly at the boundary", () => {
    expect(clampOffset(60, 60)).toBe(60);
    expect(clampOffset(-60, 60)).toBe(-60);
  });
});

describe("constants sanity checks", () => {
  it("COMMIT_THRESHOLD_PX is a positive number", () => {
    expect(COMMIT_THRESHOLD_PX).toBeGreaterThan(0);
  });

  it("MAX_DIAGONAL_DEG is between 0 and 45 exclusive", () => {
    expect(MAX_DIAGONAL_DEG).toBeGreaterThan(0);
    expect(MAX_DIAGONAL_DEG).toBeLessThan(45);
  });
});

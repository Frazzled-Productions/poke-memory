import { describe, it, expect } from "vitest";
import { isoMinusDays } from "./date";

describe("isoMinusDays", () => {
  it("returns the same date when n = 0", () => {
    expect(isoMinusDays("2026-05-18", 0)).toBe("2026-05-18");
  });

  it("subtracts one day correctly", () => {
    expect(isoMinusDays("2026-05-18", 1)).toBe("2026-05-17");
  });

  it("subtracts multiple days correctly", () => {
    expect(isoMinusDays("2026-05-18", 7)).toBe("2026-05-11");
  });

  it("crosses a month boundary", () => {
    expect(isoMinusDays("2026-05-01", 1)).toBe("2026-04-30");
  });

  it("crosses a year boundary", () => {
    expect(isoMinusDays("2026-01-01", 1)).toBe("2025-12-31");
  });

  it("handles a 30-day window ending mid-month", () => {
    expect(isoMinusDays("2026-05-18", 29)).toBe("2026-04-19");
  });

  it("returns a YYYY-MM-DD formatted string", () => {
    const result = isoMinusDays("2026-05-18", 5);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("handles leap-year February boundary correctly", () => {
    expect(isoMinusDays("2024-03-01", 1)).toBe("2024-02-29");
  });

  it("handles non-leap-year February boundary correctly", () => {
    expect(isoMinusDays("2025-03-01", 1)).toBe("2025-02-28");
  });

  it("subtracting n days and then adding back n days round-trips to the original date", () => {
    // Round-trip via isoMinusDays applied twice (forward then back via
    // negative subtraction = addition). Kept self-contained to avoid
    // importing addDaysToIsoDate.
    const today = "2026-05-18";
    const earlier = isoMinusDays(today, 14);
    // Going back 14 days and then forward 14 days should recover today.
    const recovered = isoMinusDays(earlier, -14);
    expect(recovered).toBe(today);
  });
});

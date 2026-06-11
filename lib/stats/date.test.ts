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

// ---------------------------------------------------------------------------
// DST safety (#1853 / F25)
//
// The previous implementation parsed the ISO string as UTC midnight but did
// the day arithmetic with local-time setDate/getDate, so whenever the local
// zone's UTC offset changed inside the window (any DST transition) the result
// went one day early and one calendar date was skipped entirely. The fixture
// dates below straddle the 2026 European and US transitions; pure UTC
// arithmetic must walk through them date by date in any host timezone.
// ---------------------------------------------------------------------------

describe("isoMinusDays DST seams", () => {
  it("walks through the autumn European transition without skipping a date", () => {
    // Europe/London leaves BST on 2026-10-25.
    expect(isoMinusDays("2026-10-26", 1)).toBe("2026-10-25");
    expect(isoMinusDays("2026-10-26", 2)).toBe("2026-10-24");
  });

  it("walks through the spring European transition without skipping a date", () => {
    // Europe/London enters BST on 2026-03-29.
    expect(isoMinusDays("2026-03-30", 1)).toBe("2026-03-29");
    expect(isoMinusDays("2026-03-30", 2)).toBe("2026-03-28");
  });

  it("walks through the US autumn transition without skipping a date", () => {
    // America/New_York leaves EDT on 2026-11-01.
    expect(isoMinusDays("2026-11-02", 1)).toBe("2026-11-01");
    expect(isoMinusDays("2026-11-02", 2)).toBe("2026-10-31");
  });

  it("produces 366 distinct consecutive dates over a full-year sweep", () => {
    // A 365-day window spans at least one DST boundary in every DST zone;
    // the skipped-date failure mode would produce a duplicate in this set.
    const seen = new Set<string>();
    for (let n = 0; n <= 365; n++) {
      seen.add(isoMinusDays("2026-12-31", n));
    }
    expect(seen.size).toBe(366);
  });
});

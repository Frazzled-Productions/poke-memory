import { describe, it, expect } from "vitest";
import { daysBetweenIsoDates, addDaysToIsoDate } from "./dates";

// ---------------------------------------------------------------------------
// daysBetweenIsoDates
// ---------------------------------------------------------------------------

describe("daysBetweenIsoDates", () => {
  it("returns 0 for the same date", () => {
    expect(daysBetweenIsoDates("2026-05-01", "2026-05-01")).toBe(0);
  });

  it("returns 1 when to is one day after from", () => {
    expect(daysBetweenIsoDates("2026-05-01", "2026-05-02")).toBe(1);
  });

  it("returns -1 when to is one day before from (negative direction)", () => {
    expect(daysBetweenIsoDates("2026-05-02", "2026-05-01")).toBe(-1);
  });

  it("returns the correct count across a month boundary", () => {
    expect(daysBetweenIsoDates("2026-04-30", "2026-05-01")).toBe(1);
  });

  it("returns the correct count across a year boundary", () => {
    expect(daysBetweenIsoDates("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("returns 365 for a non-leap year span", () => {
    expect(daysBetweenIsoDates("2025-01-01", "2026-01-01")).toBe(365);
  });

  it("returns 366 for a leap-year span", () => {
    expect(daysBetweenIsoDates("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("is robust across a DST transition (UTC math, no TZ ambiguity)", () => {
    // European DST transitions happen in March/October.
    // Using UTC means the result is always exactly 1 day.
    expect(daysBetweenIsoDates("2026-03-29", "2026-03-30")).toBe(1);
  });

  it("handles a large positive span", () => {
    expect(daysBetweenIsoDates("2020-01-01", "2030-01-01")).toBe(3653);
  });

  it("handles a large negative span", () => {
    expect(daysBetweenIsoDates("2030-01-01", "2020-01-01")).toBe(-3653);
  });
});

// ---------------------------------------------------------------------------
// addDaysToIsoDate
// ---------------------------------------------------------------------------

describe("addDaysToIsoDate", () => {
  it("returns the same date when adding 0 days", () => {
    expect(addDaysToIsoDate("2026-05-01", 0)).toBe("2026-05-01");
  });

  it("adds positive days correctly", () => {
    expect(addDaysToIsoDate("2026-05-01", 1)).toBe("2026-05-02");
  });

  it("subtracts days correctly with a negative argument", () => {
    expect(addDaysToIsoDate("2026-05-02", -1)).toBe("2026-05-01");
  });

  it("rolls over a month boundary correctly", () => {
    expect(addDaysToIsoDate("2026-04-30", 1)).toBe("2026-05-01");
  });

  it("rolls back a month boundary correctly", () => {
    expect(addDaysToIsoDate("2026-05-01", -1)).toBe("2026-04-30");
  });

  it("rolls over a year boundary correctly", () => {
    expect(addDaysToIsoDate("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("handles leap-year February correctly", () => {
    expect(addDaysToIsoDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysToIsoDate("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("handles non-leap-year February correctly", () => {
    expect(addDaysToIsoDate("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("adds 30 days across a month boundary", () => {
    expect(addDaysToIsoDate("2026-05-01", 30)).toBe("2026-05-31");
    expect(addDaysToIsoDate("2026-05-01", 31)).toBe("2026-06-01");
  });

  it("result round-trips through daysBetweenIsoDates", () => {
    const from = "2026-05-10";
    const shifted = addDaysToIsoDate(from, 21);
    expect(daysBetweenIsoDates(from, shifted)).toBe(21);
  });

  it("returns a YYYY-MM-DD formatted string", () => {
    const result = addDaysToIsoDate("2026-05-01", 5);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

import { describe, it, expect } from "vitest";
import {
  isoDate,
  todayInTimezone,
  formatDate,
  formatShortDate,
  detectDateFormat,
  detectTimezone,
  type DateFormat,
} from "./format-date";

// ---------------------------------------------------------------------------
// isoDate
// ---------------------------------------------------------------------------

describe("isoDate", () => {
  it("formats a UTC Date as YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-05-14T00:00:00Z"))).toBe("2026-05-14");
  });

  it("uses UTC, not local time — midnight UTC stays on the same day", () => {
    // A Date at exactly midnight UTC is 2026-01-01 in UTC.
    expect(isoDate(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });

  it("truncates the time component correctly at noon UTC", () => {
    expect(isoDate(new Date("2026-05-14T12:34:56Z"))).toBe("2026-05-14");
  });

  it("returns a string matching YYYY-MM-DD format", () => {
    const result = isoDate(new Date("2024-02-29T06:00:00Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe("2024-02-29");
  });
});

// ---------------------------------------------------------------------------
// todayInTimezone
// ---------------------------------------------------------------------------

describe("todayInTimezone", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    // 2026-05-14T10:00:00Z should be 2026-05-14 in UTC.
    const now = new Date("2026-05-14T10:00:00Z");
    expect(todayInTimezone("UTC", now)).toBe("2026-05-14");
  });

  it("rolls the day forward in UTC+9 (Tokyo)", () => {
    // 2026-05-14T20:00:00Z → 2026-05-15 in Asia/Tokyo (UTC+9 = 05:00 next day)
    const now = new Date("2026-05-14T20:00:00Z");
    expect(todayInTimezone("Asia/Tokyo", now)).toBe("2026-05-15");
  });

  it("rolls the day backward in UTC-8 (Los Angeles, late at night UTC)", () => {
    // 2026-05-14T04:00:00Z is 2026-05-13T20:00:00 in America/Los_Angeles (UTC-8 in May).
    const now = new Date("2026-05-14T04:00:00Z");
    expect(todayInTimezone("America/Los_Angeles", now)).toBe("2026-05-13");
  });

  it("falls back gracefully on an invalid timezone string", () => {
    const now = new Date("2026-05-14T12:00:00Z");
    // Should not throw; should return a YYYY-MM-DD string.
    const result = todayInTimezone("Not/A/Real_Zone", now);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

const ISO_DATE = "2026-05-14";

describe("formatDate", () => {
  it("iso format includes the ISO string", () => {
    const result = formatDate(ISO_DATE, "iso", "UTC");
    expect(result).toContain(ISO_DATE);
    // Should also include a weekday abbreviation.
    expect(result).toMatch(/[A-Za-z]{3}/);
  });

  it("dmy format (en-GB) shows day before month abbreviation", () => {
    const result = formatDate(ISO_DATE, "dmy", "UTC");
    // 2026-05-14 is a Thursday. en-GB: "Thu, 14 May"
    expect(result).toMatch(/Thu/);
    expect(result).toMatch(/14/);
    expect(result).toMatch(/May/);
    // "14" should appear before "May"
    const dayPos = result.indexOf("14");
    const monPos = result.indexOf("May");
    expect(dayPos).toBeLessThan(monPos);
  });

  it("mdy format shows month abbreviation before day", () => {
    const result = formatDate(ISO_DATE, "mdy", "UTC");
    // 2026-05-14: month=May, day=14
    expect(result).toMatch(/May/);
    expect(result).toMatch(/14/);
    // "May" should appear before "14"
    const monPos = result.indexOf("May");
    const dayPos = result.indexOf("14");
    expect(monPos).toBeLessThan(dayPos);
  });

  it("uses English month names regardless of format", () => {
    // If locale were French, "May" would be "mai". We always use English.
    const dmy = formatDate(ISO_DATE, "dmy", "UTC");
    const mdy = formatDate(ISO_DATE, "mdy", "UTC");
    expect(dmy).toMatch(/May/);
    expect(mdy).toMatch(/May/);
  });

  it("dmy-year format shows day + month abbreviation + year, no weekday", () => {
    const result = formatDate(ISO_DATE, "dmy-year", "UTC");
    // 2026-05-14: en-GB gives "14 May 2026"
    expect(result).toMatch(/14/);
    expect(result).toMatch(/May/);
    expect(result).toMatch(/2026/);
    // Day before month.
    const dayPos = result.indexOf("14");
    const monPos = result.indexOf("May");
    expect(dayPos).toBeLessThan(monPos);
    // No weekday abbreviation.
    expect(result).not.toMatch(/Thu/);
  });

  it("mdy-year format shows month abbreviation + day + year, no weekday", () => {
    const result = formatDate(ISO_DATE, "mdy-year", "UTC");
    // 2026-05-14: en-US gives "May 14, 2026"
    expect(result).toMatch(/May/);
    expect(result).toMatch(/14/);
    expect(result).toMatch(/2026/);
    // Month before day.
    const monPos = result.indexOf("May");
    const dayPos = result.indexOf("14");
    expect(monPos).toBeLessThan(dayPos);
    // No weekday abbreviation.
    expect(result).not.toMatch(/Thu/);
  });

  it("does not throw on an ISO date from a different month", () => {
    // January — en-GB: "Thu, 1 Jan" (or similar)
    const jan = formatDate("2026-01-01", "dmy", "UTC");
    expect(jan).toMatch(/Jan/);
  });
});

// ---------------------------------------------------------------------------
// formatShortDate
// ---------------------------------------------------------------------------

describe("formatShortDate", () => {
  it("iso returns the input unchanged", () => {
    expect(formatShortDate("2026-05-14", "iso")).toBe("2026-05-14");
  });

  it("dmy returns DD/MM/YYYY", () => {
    expect(formatShortDate("2026-05-14", "dmy")).toBe("14/05/2026");
  });

  it("mdy returns MM/DD/YYYY", () => {
    expect(formatShortDate("2026-05-14", "mdy")).toBe("05/14/2026");
  });

  it("handles single-digit day and month correctly", () => {
    expect(formatShortDate("2026-01-07", "dmy")).toBe("07/01/2026");
    expect(formatShortDate("2026-01-07", "mdy")).toBe("01/07/2026");
  });

  it("does not throw on malformed input", () => {
    // The function splits on "-" and re-orders. A 3-part string that happens
    // not to be a valid date will produce re-ordered parts rather than throwing.
    expect(() => formatShortDate("not-a-date", "dmy")).not.toThrow();
    // ISO passthrough is always the original string unchanged.
    expect(formatShortDate("not-a-date", "iso")).toBe("not-a-date");
  });
});

// ---------------------------------------------------------------------------
// detectDateFormat
// ---------------------------------------------------------------------------

describe("detectDateFormat", () => {
  it("returns a valid DateFormat value", () => {
    const result = detectDateFormat();
    const valid: DateFormat[] = ["iso", "dmy", "mdy"];
    expect(valid).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// detectTimezone
// ---------------------------------------------------------------------------

describe("detectTimezone", () => {
  it("returns a non-empty string", () => {
    const tz = detectTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });
});

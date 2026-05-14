/**
 * Timezone-aware date formatting helpers.
 *
 * All date display for the user passes through here so locale-leaking calls
 * (toLocaleDateString(undefined, …)) are replaced with stable en-GB / en-CA
 * renderings, and "today" is computed against the user's clock timezone rather
 * than UTC.
 */

export type DateFormat = "iso" | "dmy" | "mdy";

/**
 * Returns the current date in the given IANA timezone as a "YYYY-MM-DD" string.
 * en-CA locale natively formats as YYYY-MM-DD with dashes, giving us ISO order
 * for free without any string surgery.
 *
 * @param tz   IANA timezone name e.g. "America/New_York". Falls back to UTC on
 *             any Intl error.
 * @param now  Optional Date (useful in tests to fix the clock).
 */
export function todayInTimezone(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  } catch {
    // Unknown / invalid timezone — fall back to UTC.
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

/**
 * Long-form date — weekday + day + month, always English (en-GB locale).
 * Example outputs:
 *   dmy → "Tue, 14 May"   (day-first)
 *   mdy → "Tue, May 14"   (month-first)
 *   iso → "Tue, 2026-05-14" (ISO order — year included for clarity)
 *
 * `tz` is accepted so the rendered date can be aligned to the user's timezone
 * when the ISO string was produced by todayInTimezone / other UTC-safe paths.
 * For already-stored YYYY-MM-DD values (card dueDates, etc.) callers typically
 * pass "UTC" to avoid any DST shift on parsing.
 */
export function formatDate(iso: string, fmt: DateFormat, tz: string): string {
  try {
    const d = new Date(iso + "T12:00:00Z");
    if (fmt === "iso") {
      // Weekday + ISO string is the clearest representation for this format.
      const weekday = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        weekday: "short",
      }).format(d);
      return `${weekday}, ${iso}`;
    }
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
    };
    if (fmt === "dmy") {
      // en-GB naturally orders day before month.
      return new Intl.DateTimeFormat("en-GB", opts).format(d);
    }
    // mdy — en-US orders month before day.
    return new Intl.DateTimeFormat("en-US", { ...opts, month: "short" }).format(d);
  } catch {
    return iso;
  }
}

/**
 * Short numeric date, ordered by fmt. Examples for 2026-05-14:
 *   dmy → "14/05/2026"
 *   mdy → "05/14/2026"
 *   iso → "2026-05-14"
 */
export function formatShortDate(iso: string, fmt: DateFormat): string {
  if (fmt === "iso") return iso;
  // Parse fields from the ISO string directly — no Date constructor needed
  // and no timezone ambiguity.
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  if (fmt === "dmy") return `${day}/${month}/${year}`;
  // mdy
  return `${month}/${day}/${year}`;
}

/**
 * Inspect the user's locale to infer a sensible default DateFormat.
 * Heuristic:
 *   - If the locale formats a known date with year first → 'iso'
 *   - If month comes before day → 'mdy'
 *   - Otherwise → 'dmy'
 *
 * Safe to call on the server — falls back to 'dmy' when Intl or navigator
 * is unavailable.
 */
export function detectDateFormat(): DateFormat {
  try {
    // Use a fixed unambiguous date: 2001-02-03 (month=2, day=3 — unambiguous
    // because 3 cannot be a month, so the first number in DD/MM vs MM/DD output
    // tells us the order).
    const probe = new Date("2001-02-03T12:00:00Z");
    const locale =
      typeof navigator !== "undefined" ? navigator.language : "en-GB";
    const parts = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(probe);

    // Extract the numeric values in left-to-right order, ignoring literals.
    const numericParts = parts
      .filter((p) => p.type === "year" || p.type === "month" || p.type === "day")
      .map((p) => p.type);

    if (numericParts[0] === "year") return "iso";
    if (numericParts[0] === "month") return "mdy";
    return "dmy";
  } catch {
    return "dmy";
  }
}

/**
 * Returns the browser's IANA timezone string.
 * Falls back to "UTC" when Intl is unavailable (SSR, old browsers).
 */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

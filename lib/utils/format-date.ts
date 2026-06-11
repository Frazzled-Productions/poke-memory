/**
 * Timezone-aware date formatting helpers.
 *
 * All date display for the user passes through here so locale-leaking calls
 * (toLocaleDateString(undefined, …)) are replaced with stable en-GB / en-CA
 * renderings, and "today" is computed against the user's clock timezone rather
 * than UTC.
 */

export type DateFormat = "iso" | "dmy" | "mdy" | "dmy-year" | "mdy-year";

/**
 * Format a `Date` as a UTC `YYYY-MM-DD` string.
 *
 * Canonical single implementation of the `.toISOString().slice(0, 10)` idiom
 * so callers don't hand-roll it. UTC-based - no local-timezone drift.
 */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Constructing an `Intl.DateTimeFormat` is expensive (it loads ICU locale +
// timezone data on every `new`). The cold-launch session build calls
// `todayInTimezone` once per card via the SRS scheduler's `isoDate` /
// `initialReviewState` / `addDays`, so a returning user re-hydrating a full
// saved deck triggers thousands of constructions on boot - the ~6s
// main-thread block behind the PWA black screen (#1803). The format options
// only depend on the timezone, so cache one formatter per timezone and reuse
// it; `Intl.DateTimeFormat.prototype.format` is itself cheap (#1803).
const _isoDateFormatters = new Map<string, Intl.DateTimeFormat>();

function isoDateFormatterFor(tz: string): Intl.DateTimeFormat {
  let fmt = _isoDateFormatters.get(tz);
  if (fmt === undefined) {
    // en-CA natively formats as YYYY-MM-DD with dashes (ISO order for free).
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    _isoDateFormatters.set(tz, fmt);
  }
  return fmt;
}

/**
 * Returns the current date in the given IANA timezone as a "YYYY-MM-DD" string.
 * en-CA locale natively formats as YYYY-MM-DD with dashes, giving us ISO order
 * for free without any string surgery.
 *
 * The per-timezone `Intl.DateTimeFormat` is cached (see `_isoDateFormatters`)
 * because this is on the per-card cold-launch session-build hot path (#1803).
 *
 * @param tz   IANA timezone name e.g. "America/New_York". Falls back to UTC on
 *             any Intl error.
 * @param now  Optional Date (useful in tests to fix the clock).
 */
export function todayInTimezone(tz: string, now: Date = new Date()): string {
  try {
    return isoDateFormatterFor(tz).format(now);
  } catch {
    // Unknown / invalid timezone - fall back to UTC.
    return isoDateFormatterFor("UTC").format(now);
  }
}

/**
 * Long-form date - weekday + day + month, always English (en-GB locale).
 * Example outputs:
 *   dmy → "Tue, 14 May"   (day-first)
 *   mdy → "Tue, May 14"   (month-first)
 *   iso → "Tue, 2026-05-14" (ISO order - year included for clarity)
 *
 * The `iso` argument already names the calendar day to render, so it is
 * always formatted at UTC. Re-projecting a noon-UTC anchor into a real
 * timezone shifted every rendered date one day late for UTC+13/+14 users
 * (Auckland in DST, Tonga, Kiritimati - #1853 / F37): converting a calendar
 * date between timezones is meaningless without a time of day, so no
 * projection belongs here.
 *
 * @deprecated-param `tz` is retained for call-site compatibility but is
 * intentionally ignored - whichever zone produced the ISO string, the string
 * itself is the day to display.
 */
export function formatDate(iso: string, fmt: DateFormat, tz?: string): string {
  void tz;
  try {
    const d = new Date(iso + "T12:00:00Z");
    if (fmt === "iso") {
      // Weekday + ISO string is the clearest representation for this format.
      const weekday = new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        weekday: "short",
      }).format(d);
      return `${weekday}, ${iso}`;
    }
    // dmy-year / mdy-year: short-month + year, no weekday.
    // Matches the output of toLocaleDateString("en-GB", { day, month: "short", year }),
    // which existing call sites produced - centralised here to remove raw Intl calls
    // from components (#1456).
    if (fmt === "dmy-year") {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(d);
    }
    if (fmt === "mdy-year") {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(d);
    }
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    };
    if (fmt === "dmy") {
      // en-GB naturally orders day before month.
      return new Intl.DateTimeFormat("en-GB", opts).format(d);
    }
    // mdy - en-US orders month before day.
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
  // Parse fields from the ISO string directly - no Date constructor needed
  // and no timezone ambiguity.
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  if (fmt === "dmy") return `${day}/${month}/${year}`;
  // mdy
  return `${month}/${day}/${year}`;
}

/**
 * Format a YYYY-MM-DD date as a compact month/day label for chart axes and
 * tooltips - no year, strips leading zeros, respects the user's date format.
 *
 * Examples (date = "2026-09-03"):
 *   dmy  → "3/9"
 *   mdy  → "9/3"
 *   iso  → "09-03"
 *
 * This is the single-source replacement for the local `formatXTick` helper
 * that was duplicated across `MasteryOverTimeChart` and `ActivityHistoryChart`
 * (F40 / #1860).
 */
export function formatChartDate(iso: string, fmt: DateFormat): string {
  const [, m, d] = iso.split("-");
  if (!m || !d) return iso;
  if (fmt === "mdy") return `${parseInt(m)}/${parseInt(d)}`;
  if (fmt === "iso") return `${m}-${d}`;
  // dmy (default, en-GB)
  return `${parseInt(d)}/${parseInt(m)}`;
}

/**
 * Inspect the user's locale to infer a sensible default DateFormat.
 * Heuristic:
 *   - If the locale formats a known date with year first → 'iso'
 *   - If month comes before day → 'mdy'
 *   - Otherwise → 'dmy'
 *
 * Safe to call on the server - falls back to 'dmy' when Intl or navigator
 * is unavailable.
 */
export function detectDateFormat(): DateFormat {
  try {
    // Use a fixed unambiguous date: 2001-02-03 (month=2, day=3 - unambiguous
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

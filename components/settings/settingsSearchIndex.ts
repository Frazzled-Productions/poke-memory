/**
 * Static search index for the Settings page.
 *
 * Each entry describes one top-level CollapsibleSection. The `terms` array
 * is the set of strings that a query is matched against - it includes the
 * section heading, the labels and helper text of every control inside it,
 * and a handful of keyword aliases so common synonyms resolve correctly
 * (e.g. "dark mode" → Appearance, "spaced repetition" → Practice schedule).
 *
 * Matching is case-insensitive substring - if any term contains the query
 * the section is considered a match.
 *
 * Updated in #1720 to reflect the new 10-section IA:
 *   practice-heading      → practice-schedule-heading + card-types-heading
 *   account-data-heading  → about-heading + regional-reminders-heading + data-backup-heading
 *   labs-heading          → language-heading (language is now GA, always-on)
 */
export type SectionSearchEntry = {
  /** The sectionId prop passed to CollapsibleSection. */
  sectionId: string;
  /** Terms searched against. Lower-case is fine - matching is .toLowerCase(). */
  terms: string[];
};

export const SETTINGS_SEARCH_INDEX: SectionSearchEntry[] = [
  {
    // Not a CollapsibleSection - maps to the id="feedback-row" element at the
    // top of Settings so searches for feedback terms reveal and scroll to it.
    sectionId: "feedback-row",
    terms: [
      "feedback",
      "send feedback",
      "bug",
      "bug report",
      "report a bug",
      "report",
      "report a problem",
      "contact",
      "support",
      "suggestion",
      "feature request",
      "improve",
    ],
  },
  {
    sectionId: "practice-schedule-heading",
    terms: [
      "practice",
      "practice schedule",
      "scheduler",
      "recall target",
      "retention",
      "mastery",
      "personalise schedule",
      "personalize schedule",
      "fsrs",
      "optimize",
      "optimise",
      "weights",
      "spaced repetition",
      "quickstart",
      "mark pokemon i already know",
      "mark pokémon i already know",
      "i already know",
      "known pokemon",
      "fast-track",
      "skip new cards",
      "daily limit",
      "daily cap",
    ],
  },
  {
    sectionId: "card-types-heading",
    terms: [
      "card types",
      "name cards",
      "enable name cards",
      "new cards per day",
      "reviews per day",
      "evolution cards",
      "enable evolution cards",
      "reverse-evolution cards",
      "reverse evolution",
      "alternate forms",
      "include alternate forms",
      "regional forms",
      "megas",
      "reverse cards",
      "enable reverse cards",
      "cry cards",
      "enable cry cards",
      "cry enable",
      "card type",
      "deck",
    ],
  },
  {
    sectionId: "audio-heading",
    terms: [
      "audio",
      "cry",
      "play cry on reveal",
      "sound",
      "speak name",
      "text to speech",
      "tts",
      "voice",
      "speech",
      "volume",
      "rate",
      "speed",
      "wait for audio",
      "audio wait",
      "lag",
      "swap speed",
      "reverse card feedback delay",
      "feedback delay",
      "sprite picker delay",
      "advance speed",
      "picker timing",
    ],
  },
  {
    sectionId: "language-heading",
    terms: [
      "language",
      "languages",
      "locale",
      "japanese",
      "chinese",
      "translation",
      "pokémon names",
      "pokemon names",
      "app language",
      "app interface language",
      "enrolment",
      "learning languages",
      "practice language",
      // Endonyms - single source from LOCALE_ENDONYMS in i18n/locales.ts (#1726).
      "日本語",
      "中文",
      "繁體中文",
      "简体中文",
    ],
  },
  {
    sectionId: "appearance-heading",
    terms: [
      "appearance",
      "theme",
      "colour",
      "color",
      "dark mode",
      "light mode",
      "mascot",
      "app theme",
      "intensity",
      "accent",
      "mobile navigation",
      "bottom tab bar",
      "hamburger menu",
      "hamburger",
      "tab bar",
      "nav style",
    ],
  },
  {
    sectionId: "offline-heading",
    terms: [
      "offline",
      "download",
      "download for offline use",
      "precache",
      "pre-fetch",
      "no connection",
      "without connection",
      "wi-fi",
      "wifi",
      "storage",
      "sprites",
      "cries",
      "cache",
    ],
  },
  {
    sectionId: "regional-reminders-heading",
    terms: [
      "regional",
      "timezone",
      "time zone",
      "date format",
      "daily reminder",
      "notification hour",
      "push notification",
      "reminder time",
      "reminders",
      "notifications",
    ],
  },
  {
    sectionId: "data-backup-heading",
    terms: [
      "data",
      "backup",
      "export",
      "download",
      "download review history",
      "review history",
      "csv",
      "data portability",
      "gdpr",
      "import",
      "restore",
      "progress",
      "how this works",
      "onboarding",
      "tips",
      "show tips again",
    ],
  },
  {
    sectionId: "about-heading",
    terms: [
      "about",
      "version",
      "changelog",
      "what's new",
      "privacy",
      "terms",
      "company",
      "frazzled",
      "fan project",
      "legal",
      "disclosure",
    ],
  },
  {
    sectionId: "advanced-heading",
    terms: [
      "advanced",
      "developer",
      "superuser",
      "debug",
      "pretend mastered",
      "streak milestone",
      "badges",
      "danger zone",
      "reset all progress",
      "delete",
      "delete account",
    ],
  },
];

/**
 * Returns true when the given section has at least one term that
 * contains the normalised query as a substring.
 */
export function sectionMatchesQuery(
  entry: SectionSearchEntry,
  normalisedQuery: string,
): boolean {
  if (normalisedQuery === "") return true;
  return entry.terms.some((term) => term.toLowerCase().includes(normalisedQuery));
}

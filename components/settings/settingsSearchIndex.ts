/**
 * Static search index for the Settings page.
 *
 * Each entry describes one top-level CollapsibleSection. The `terms` array
 * is the set of strings that a query is matched against — it includes the
 * section heading, the labels and helper text of every control inside it,
 * and a handful of keyword aliases so common synonyms resolve correctly
 * (e.g. "dark mode" → Appearance, "spaced repetition" → Practice).
 *
 * Matching is case-insensitive substring — if any term contains the query
 * the section is considered a match.
 */
export type SectionSearchEntry = {
  /** The sectionId prop passed to CollapsibleSection. */
  sectionId: string;
  /** Terms searched against. Lower-case is fine — matching is .toLowerCase(). */
  terms: string[];
};

export const SETTINGS_SEARCH_INDEX: SectionSearchEntry[] = [
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
    sectionId: "practice-heading",
    terms: [
      "practice",
      "scheduler",
      "recall target",
      "retention",
      "mastery",
      "mastery threshold",
      "repetitions",
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
      "daily limit",
      "daily cap",
    ],
  },
  {
    sectionId: "audio-heading",
    terms: [
      "audio",
      "cry",
      "cry cards",
      "enable cry cards",
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
    sectionId: "account-data-heading",
    terms: [
      "account",
      "data",
      "how this works",
      "onboarding",
      "tips",
      "show tips again",
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
      "regional",
      "timezone",
      "time zone",
      "date format",
      "daily reminder",
      "notification hour",
      "push notification",
      "reminder time",
      "about",
      "version",
      "changelog",
      "what's new",
      "sync",
      "sign-in methods",
      "sign in methods",
      "connect",
      "link",
      "provider",
      "github",
      "google",
      "identity",
    ],
  },
  {
    sectionId: "labs-heading",
    terms: [
      "labs",
      "preview",
      "experimental",
      "beta",
      "languages",
      "locale",
      "language",
      "japanese",
      "chinese",
      "translation",
      "pokémon names",
      "pokemon names",
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

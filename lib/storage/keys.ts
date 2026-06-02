/**
 * Central registry of every localStorage key string used by poke-memory.
 *
 * Rules:
 *   - Key strings must be byte-identical to their original values —
 *     real users' browsers already hold data under these strings; changing
 *     one would silently orphan their saved state.
 *   - All keys follow the pattern `poke-memory:<domain>[:<variant>][:v<n>]`.
 *   - Add a new constant here before using it in any persistence module.
 *   - Legacy / superseded keys are kept (annotated) so migrations can still
 *     read and clear them.
 */

// ─── Review session ───────────────────────────────────────────────────────────

/** Primary store for the in-progress review session (IDB-backed, LS fallback). */
export const KEY_REVIEW_SESSION = "poke-memory:review-session:v1";

// ─── Grade log ────────────────────────────────────────────────────────────────

/** Append-only grade-log store (IDB-backed, LS fallback). */
export const KEY_GRADE_LOG = "poke-memory:grade-log:v1";

// ─── Daily summary ────────────────────────────────────────────────────────────

/** Per-day review-summary record. */
export const KEY_DAILY_SUMMARY = "poke-memory:daily-summary:v1";

// ─── Settings ─────────────────────────────────────────────────────────────────

/** All user-configurable settings (JSONB blob). */
export const KEY_SETTINGS = "poke-memory:settings:v1";

/** Snapshot of the settings last successfully pushed to cloud (diff guard). */
export const KEY_SETTINGS_LAST_PUSHED = "poke-memory:settings:last-pushed:v1";

// ─── Sync status ──────────────────────────────────────────────────────────────

/** Sync-status record (timestamps, error flags). */
export const KEY_SYNC_STATUS = "poke-memory:sync-status:v1";

/** Persisted pending-grade queue for resilient per-grade sync (#893). */
export const KEY_PENDING_GRADE_QUEUE = "poke-memory:pending-grade-queue:v1";

// ─── Streak ───────────────────────────────────────────────────────────────────

/** Sorted list of ISO date strings on which the streak condition was met. */
export const KEY_STREAK = "poke-memory:streak:v1";

// ─── Superuser / developer mode ───────────────────────────────────────────────

/**
 * Presence flag: localStorage.getItem === "true" means the developer panel
 * is unlocked. Intentionally has no `:v1` suffix — changing the key would
 * require a migration of existing QA sessions.
 */
export const KEY_SUPERUSER_UNLOCKED = "poke-memory:superuser";

/** Per-behaviour developer-mode toggle flags. */
export const KEY_SUPERUSER_FLAGS = "poke-memory:superuser:flags:v1";

// ─── Version tracking ─────────────────────────────────────────────────────────

/** Last app version the user was shown a "what's new" notice for. */
export const KEY_LAST_SEEN_VERSION = "poke-memory:last-seen-version:v1";

// ─── Legacy / superseded keys (kept for migration reads + clears only) ────────

/**
 * @deprecated Superseded in #307. The favourite theme now lives inside
 * KEY_SETTINGS. This key is read once on first load and then removed.
 */
export const KEY_LEGACY_FAVOURITE_THEME = "poke-memory:favourite:v1";

/**
 * @deprecated Superseded when practiceScope was folded into UserSettings.
 * Read once on first load for migration, then removed.
 */
export const KEY_LEGACY_PRACTICE_SCOPE = "poke-memory:practice-scope:v1";

// ─── Storage-persistence request ──────────────────────────────────────────────

/**
 * Flag written after `navigator.storage.persist()` has been called at least
 * once in this browser. Used to avoid calling it on every page load — one
 * successful request is sufficient to lock the permission in.
 */
export const KEY_PERSIST_REQUESTED = "poke-memory:storage-persist-requested:v1";

// ─── Review session activity flag ─────────────────────────────────────────────

/**
 * Presence flag set while a `ReviewSession` is mounted. Read by visibility-
 * triggered cloud pulls and the silent SW update flow so they can skip safe
 * moments where activating mid-card would lose user state.
 *
 * Intentionally has no `:v1` suffix — the value lifecycle is bounded by the
 * session mount, never read across versions, and there is nothing to migrate.
 */
export const KEY_REVIEW_SESSION_ACTIVE = "poke-memory:session-active";

// ─── Offline download ─────────────────────────────────────────────────────────

/**
 * Records the ISO timestamp of the last completed offline asset download
 * (sprites + cries). Written by the offline precache orchestrator
 * (`lib/pwa/precache.ts`) after a successful `precacheAll` run and read by
 * `OfflineSection` to show the last-downloaded date.
 */
export const KEY_OFFLINE_DOWNLOADED_AT = "poke-memory:offline-downloaded-at";

// ─── Pasture tab visibility shortcut ─────────────────────────────────────────

/**
 * Boolean flag written to localStorage by `ReviewSession` the moment a name
 * card first crosses the mastery threshold. Read by `NavLinks` and `BottomTabBar`
 * so they can show/hide the Pasture tab without re-parsing the full session
 * blob from IDB on every `SESSION_CHANGED_EVENT` (Class A item 3 of #1191).
 *
 * Value is `"true"` when at least one species name card is mastered, absent or
 * `"false"` otherwise. A missing key falls back to a one-shot
 * `loadSession`+`filterMastered` check on mount so existing users see the tab
 * immediately after upgrading.
 *
 * v1 → v2 bump (#1219): v1 was written on any card type reaching mastery, not
 * just name cards. Bumping the key orphans any stuck-true v1 values so the nav
 * components fall through to the full check on next load.
 */
export const KEY_HAS_MASTERED = "poke-memory:has-mastered:v2";

// ─── QA seed active scenario ──────────────────────────────────────────────────

/**
 * Stores the slug of the currently active QA seed scenario.
 * Written by applySeedScenario, cleared by clearSeedScenario.
 * Read by QaSeedSection on mount to restore the active-seed indicator.
 *
 * Absence means no seed is active. Value is a raw slug string, e.g.
 * "mastery-gaps" or "pasture-progression".
 */
export const KEY_QA_SEED_ACTIVE = "poke-memory:qa-seed-active";

// ─── Mastered-count cache (per locale) ───────────────────────────────────────

/**
 * Lightweight per-locale mastered-species count cache. Holds a single JSON
 * object `{ en: number, ja: number, "zh-Hans": number, "zh-Hant": number }`
 * written by `ReviewSession` after each grade that changes mastery state.
 *
 * One key (one getItem) for all locales — cheaper than one key per locale
 * and forward-compatible via the `v1` version suffix (a future format change
 * is a key bump, not a migration). Mirrors the `has-mastered:v2` pattern.
 *
 * This is local-only derived state, re-computable from the card array.
 * No migration, no sync leg required.
 */
export const KEY_MASTERED_COUNT_BY_LOCALE =
  "poke-memory:mastered-count-by-locale:v1";

/**
 * Lightweight per-locale due-today count (#1484), written by ReviewSession and
 * read by the LanguageSwitcher to show per-language due badges without a full
 * card-array parse on every render. Local-only derived state; no sync leg.
 */
export const KEY_DUE_COUNT_BY_LOCALE =
  "poke-memory:due-count-by-locale:v1";

// ─── Card-revealed flag (#1562) ───────────────────────────────────────────────

/**
 * Transient flag set to `"1"` while a card is mid-reveal (awaiting a grade),
 * and cleared when the card is graded, the session advances, or the component
 * unmounts. Read by the LanguageSwitcher to block locale switches mid-card.
 *
 * Mirrors the `KEY_REVIEW_SESSION_ACTIVE` pattern — stored in localStorage so
 * it is readable outside the React tree without prop drilling.
 */
export const KEY_CARD_REVEALED = "poke-memory:card-revealed";

// ─── Pokédex sort preference ──────────────────────────────────────────────────

/**
 * The user's last-chosen Pokédex sort option
 * ("national" | "alphabetical" | "closest-to-mastery").
 * Persisted so the sort survives back-navigation and page reloads.
 */
export const KEY_POKEDEX_SORT = "poke-memory:pokedex-sort:v1";

// ─── Per-device shuffle salt ──────────────────────────────────────────────────

/**
 * Stable per-device UUID used as a salt for `stableShuffleForDay`.
 * Generated once on first session build via `crypto.randomUUID()` and
 * persisted here so the shuffle order is consistent across page loads on the
 * same device but differs from other users/devices.
 *
 * Authenticated users use their Supabase `user.id` instead; this key is only
 * read/written for the guest path.
 */
export const KEY_CLIENT_SALT = "poke-memory:client-salt:v1";

// ─── Machine-translation banner dismissal ────────────────────────────────────

/**
 * Key prefix for per-locale MT-banner dismissal flags.
 * Each locale gets its own key so reads are fast and synchronous — the banner
 * component reads the key for the active locale in a `useEffect` after hydration.
 *
 * Full key format: `poke-memory:mt-banner-dismissed:<locale>`
 * (e.g. `poke-memory:mt-banner-dismissed:ja`)
 *
 * Dismissal is also persisted in `user_settings.dismissedMtBannerLocales` for
 * cross-device sync; `pullAndMerge` writes these keys as a write-through on
 * every pull so the banner's read path never needs to consult settings (#1387).
 */
const MT_BANNER_DISMISSED_PREFIX = "poke-memory:mt-banner-dismissed";

/** Returns the localStorage key for the given locale's MT-banner dismissal flag. */
export function mtBannerDismissedKey(locale: string): string {
  return `${MT_BANNER_DISMISSED_PREFIX}:${locale}`;
}

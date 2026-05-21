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

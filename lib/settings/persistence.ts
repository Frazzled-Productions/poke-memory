import type { ThemeColors } from "@/lib/theme/curated-pokemon";
import {
  EMPTY_SCOPE,
  type PracticeScope,
  type PracticeScopePreset,
  isScopeEmpty,
  readLegacyScope,
  clearLegacyScope,
  parseFormCategoryFilter,
} from "@/lib/review/scope";
import type { DateFormat } from "@/lib/utils/format-date";
import { KEY_SETTINGS } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";
import {
  DEFAULT_STREAK_PROTECTION,
  validateStreakProtection,
  type StreakProtection,
} from "@/lib/streak/tokens";
import {
  DEFAULT_LABS_FLAGS,
  parseLabsFlags,
  type LabsFlags,
} from "@/lib/labs/flags";
import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";
import type { TypedEntryStrictness } from "@/lib/srs/typedEntryGradeLocale";

// localStorage key for all user-configurable settings
export const STORAGE_KEY = KEY_SETTINGS;

// Mirror of the structure stored under `favouriteTheme`. Validation of the
// values (HEX_COLOR / known Pokémon id) happens in lib/theme/persistence.ts
// - here we treat the field as an opaque container.
export type StoredFavouriteTheme = {
  id: number;
  name: string;
  colors: ThemeColors;
  spriteUrl: string | null;
};

/** Controls how broadly the chosen Pokémon palette is applied to the UI. */
export type ThemeIntensity = "accents" | "tinted" | "full";

/**
 * Per-surface dismissal flags for the first-run onboarding hints (#433).
 * `false` = hint still shows; `true` = user dismissed it.
 *
 * IMPORTANT: the boolean dismissal flags listed here are mirrored in the
 * `user_settings_reject_regression` trigger (migration 038). When adding a
 * new boolean dismissal flag, add it to the ARRAY[] list in that trigger
 * function as well, so the DB enforces the one-shot invariant at the data layer.
 * Numeric counters (practiceSessionsCount, slowSpriteLoadCount) are also
 * mirrored in a separate section of that trigger (monotonic counter guard).
 */
export type OnboardingFlags = {
  /**
   * One-time first-visit onboarding modal (#1103). Shown on the first
   * Practice-page load; covers grading mechanics, audio features, and guest
   * storage. `true` = user dismissed it and it will not re-open automatically.
   */
  firstVisitOnboardingDismissed: boolean;
  /** @deprecated Replaced by firstVisitOnboardingDismissed (#1103). The banner is removed; flag retained to avoid migration noise. */
  welcomeDismissed: boolean;
  /** @deprecated Replaced by firstVisitOnboardingDismissed (#1103). The banner is removed; flag retained to avoid migration noise. */
  practiceHintDismissed: boolean;
  statsHintDismissed: boolean;
  settingsHintDismissed: boolean;
  /** PWA install nudge (#701). `true` = user dismissed it; resets with the onboarding reset button. */
  installNudgeDismissed: boolean;
  /**
   * @deprecated Replaced by firstVisitOnboardingDismissed (#1103). The banner is removed; flag retained to avoid migration noise.
   * Audio-features nudge (#702). Shown at card reveal when the user has no
   * audio behaviour switched on, pointing them to Settings → Audio (cry
   * playback and spoken names). `true` = user dismissed it.
   */
  audioHintDismissed: boolean;
  /**
   * Card-types nudge (#702). Shown on the session-complete screen when at
   * least one off-by-default card type (reverse, reverse-evolution, alternate
   * forms) is still disabled. `true` = user dismissed it.
   */
  cardTypesHintDismissed: boolean;
  /**
   * @deprecated Replaced by firstVisitOnboardingDismissed (#1103). The banner is removed; flag retained to avoid migration noise.
   * Guest storage-persistence notice (#1057). Shown to signed-out users to
   * explain that progress is device-local and how to protect it. `true` = user
   * dismissed it.
   */
  guestStorageNoticeDismissed: boolean;
  /**
   * Journey mastery-explainer hint (#1441). Shown near the mastery rings on
   * the Journey page to explain Locked / Learning / Mastered. `true` = user
   * dismissed it and it will not re-show automatically.
   */
  journeyMasteryExplainerDismissed: boolean;
  /**
   * "Mark Pokémon I already know" nudge (#1443). Shown near the Quickstart
   * section on the Settings Practice tab, pointing users at the quiz that
   * lets them fast-track species they already know. `true` = user dismissed
   * it and it will not re-show automatically.
   */
  markWhatIKnowNudgeDismissed: boolean;
  /**
   * Practice scope nudge (#1443). Shown on the practice screen (above
   * ScopeControl) for users who have completed the first-visit onboarding
   * but have never opened the scope control. `true` = user dismissed it.
   */
  practiceScopeNudgeDismissed: boolean;
  /**
   * Whether the user has ever opened the practice scope control (#1482).
   * Set to `true` inside `handleScopeChange` the first time the user
   * interacts with ScopeControl. Used to suppress the scope nudge
   * permanently for users who already know about the feature.
   * `false` (default) = user has never opened scope; absent in pre-#1482
   * blobs resolves to `false` via `=== true` coercion.
   */
  scopeEverOpened: boolean;
  /**
   * Count of completed practice sessions (#1482). Incremented once per
   * browser session (sessionStorage-guarded) on the first grade. Used to
   * gate the scope nudge: shown only after N sessions. Default `0` - 
   * absent in pre-#1482 blobs resolves to `0` (below threshold) via
   * integer coercion.
   */
  // NOTE: this counts completed practice sessions since the field shipped
  // (#1505 / 2026-06-01), NOT lifetime sessions. A low value on an older
  // account is expected and is NOT a sign that progress was wiped.
  practiceSessionsCount: number;
  /**
   * One-time dismissal flag for the offline-download discovery nudge (#1538).
   * Shown on the Practice screen when the user is experiencing slow sprite
   * loads or has completed N sessions without downloading. `true` = user
   * dismissed it and it will not re-show.
   *
   * `=== true` coercion: absent key in pre-#1538 blobs resolves to `false`
   * → every existing user is immediately eligible; the live-signal gate
   * determines whether the nudge actually shows.
   */
  offlineDownloadNudgeDismissed: boolean;
  /**
   * Running count of slow sprite-load events observed on the grade critical
   * path (#1538). Incremented each time the 150 ms `DECODE_GRADE_TIMEOUT_MS`
   * race in `decodeSpriteUrls` times out. Used to gate the offline-download
   * nudge: shown after reaching `OFFLINE_NUDGE_SLOW_LOAD_THRESHOLD` (3).
   *
   * Integer coercion: absent key in pre-#1538 blobs resolves to `0` (below
   * threshold; nudge does not show on slow-load signal alone until 3 events
   * have been counted).
   */
  slowSpriteLoadCount: number;
  /**
   * One-time dismissal flag for the Pasture long-press popover discovery hint
   * (#1572). Shown on first Pasture visit (both populated and empty states) to
   * signal that pressing and holding any Pokémon sprite reveals its name,
   * mastery date, and review interval. `true` = user dismissed it.
   *
   * `=== true` coercion: absent key in pre-#1572 blobs resolves to `false`
   * → every existing user sees the hint once on their next Pasture visit.
   */
  pastureLongPressHintDismissed: boolean;
  /**
   * One-shot hint for the Higher-or-Lower mini-game (#1573). Shown on the
   * active-card practice screen (above ScopeControl) once the user has seen
   * at least one Pokémon in the current session and the first-visit onboarding
   * is complete. Teases the post-session bonus mini-game. `true` = user
   * dismissed it.
   *
   * `=== true` coercion: absent key in pre-#1573 blobs resolves to `false`
   * → every existing user sees the hint once on their next practice session.
   */
  higherOrLowerNudgeDismissed: boolean;
  /**
   * One-shot value-prop nudge for guest sign-up (#1668). Shown on Stats and
   * Journey pages for guests who have reached a meaningful progress threshold
   * (`masteredSpecies >= 10` OR `practiceSessionsCount >= 3`). Uses
   * loss-aversion copy to surface the risk of losing local-only progress.
   * `true` = user dismissed it.
   *
   * `=== true` coercion: absent key in pre-#1668 blobs resolves to `false`
   * → every existing guest who meets the threshold sees it once on their next
   * Stats or Journey visit.
   */
  guestSignUpNudgeDismissed: boolean;
  /**
   * One-shot flag recording that the user has actively collapsed the "Card
   * types" section at least once (#1726). Until this flag is `true` the
   * section defaults open on every visit; once `true` normal persisted-state
   * logic applies (the section remembers whatever state the user left it in).
   *
   * `=== true` coercion: absent key in pre-#1726 blobs resolves to `false`
   * → every existing user sees the section open once on their next Settings
   * visit, which is exactly the desired first-visit orientation behaviour.
   */
  cardTypesDefaultOpenDismissed: boolean;
  /**
   * One-shot hint for the "Almost mastered" scope preset (#1767). Shown on
   * the active-card practice screen (near ScopeControl) for users who have
   * completed the first-visit onboarding and have at least one blocked species
   * (i.e. one leg mastered, the other not). Teases the mastery-blockers preset.
   * `true` = user dismissed it.
   *
   * `=== true` coercion: absent key in pre-#1767 blobs resolves to `false`
   * → every existing user who meets the threshold sees the hint once on their
   * next practice session.
   */
  masteryBlockersNudgeDismissed: boolean;
};

export const DEFAULT_ONBOARDING: OnboardingFlags = {
  firstVisitOnboardingDismissed: false,
  welcomeDismissed: false,
  practiceHintDismissed: false,
  statsHintDismissed: false,
  settingsHintDismissed: false,
  installNudgeDismissed: false,
  audioHintDismissed: false,
  cardTypesHintDismissed: false,
  guestStorageNoticeDismissed: false,
  journeyMasteryExplainerDismissed: false,
  // Default false: absent in pre-#1443 blobs resolves to not-seen (nudge shows).
  markWhatIKnowNudgeDismissed: false,
  // Default false: absent in pre-#1443 blobs resolves to not-seen (nudge shows).
  practiceScopeNudgeDismissed: false,
  // Default false: absent in pre-#1482 blobs resolves to false (user has not yet
  // opened scope; nudge may still show subject to session-count gate).
  scopeEverOpened: false,
  // Default 0: absent in pre-#1482 blobs resolves to 0 (below threshold; nudge
  // does not show until N sessions have been completed).
  practiceSessionsCount: 0,
  // Default false: absent in pre-#1538 blobs resolves to false (not dismissed;
  // nudge may show subject to the live-signal gate).
  offlineDownloadNudgeDismissed: false,
  // Default 0: absent in pre-#1538 blobs resolves to 0 (below threshold; nudge
  // does not show on slow-load signal alone until 3 events have been counted).
  slowSpriteLoadCount: 0,
  // Default false: absent in pre-#1572 blobs resolves to false (not dismissed;
  // hint shows on next Pasture visit for every existing user).
  pastureLongPressHintDismissed: false,
  // Default false: absent in pre-#1573 blobs resolves to false (not dismissed;
  // hint shows on next active-practice session for every existing user).
  higherOrLowerNudgeDismissed: false,
  // Default false: absent in pre-#1668 blobs resolves to false (not dismissed;
  // nudge shows on next Stats or Journey visit for existing guests who meet the
  // progress threshold).
  guestSignUpNudgeDismissed: false,
  // Default false: absent in pre-#1726 blobs resolves to false (not dismissed;
  // Card types section opens once on first Settings visit, then respects
  // whatever state the user last left it in after their first collapse).
  cardTypesDefaultOpenDismissed: false,
  // Default false: absent in pre-#1767 blobs resolves to false (not dismissed;
  // hint shows on next practice session for existing users with blocked species).
  masteryBlockersNudgeDismissed: false,
};

/**
 * Mobile navigation style (#661). Controls which mobile nav surface is shown
 * below the `md` breakpoint.
 * - `'bottom'` - fixed bottom tab bar (new default for new users).
 * - `'hamburger'` - slide-in drawer triggered by a hamburger button in the header
 *   (the classic style; kept as the default for existing users who already have
 *   a settings record without this field).
 */
export type MobileNav = "bottom" | "hamburger";

export type UserSettings = {
  masteryRepetitions: number;        // cards with this many consecutive correct reviews = mastered
  maxNewPerDay: number;              // hard daily cap for new name cards
  maxReviewsPerDay: number;          // soft daily cap for name reviews
  maxNewEvolutionPerDay: number;     // hard daily cap for new evolution cards
  maxReviewsEvolutionPerDay: number; // soft daily cap for evolution reviews
  evolutionCardsEnabled: boolean;    // show sprite; identify evolution chain
  reverseEvolutionCardsEnabled: boolean; // reverse-direction evolution edge cards (#343)
  maxNewReversePerDay: number;       // hard daily cap for new reverse cards
  maxReviewsReversePerDay: number;   // soft daily cap for reverse reviews
  playCryOnReveal: boolean;          // play Pokémon cry audio on card reveal
  speakNameOnReveal: boolean;        // speak Pokémon name aloud (TTS) on card reveal
  cryCardsEnabled: boolean;          // enable third-direction cards: audio prompt → name
  maxNewCryPerDay: number;
  maxReviewsCryPerDay: number;
  /**
   * Master gate for alternate-form cards (#658). When false, form cards
   * (regional variants, Megas, formes, etc.) are excluded from practice
   * entirely and the "Alternate forms" section of ScopeControl is hidden.
   * When true, form cards are eligible and the per-category filter in
   * `practiceScope.formCategories` applies as normal.
   *
   * Defaults to false - the base Pokédex is already a large deck and forms
   * are opt-in. Missing/non-boolean values in persisted JSON default to
   * false (existing users lose forms from practice until they re-enable).
   */
  alternateFormsEnabled: boolean;
  favouriteTheme: StoredFavouriteTheme | null; // chosen mastery accent Pokémon
  /** How broadly the chosen palette is painted across the UI (#411). */
  themeIntensity: ThemeIntensity;
  /**
   * FSRS desired-retention target. Range 0.80..0.97; default 0.90 matches
   * `ts-fsrs` and Anki defaults. Lower = fewer reviews, more forgetting.
   * Higher = more reviews, better retention.
   */
  retentionTarget: number;
  /**
   * Practice scope (#333). Persisted from `components/review/ScopeControl`.
   * `EMPTY_SCOPE` ({ gens: [], types: [], presets: [] }) means "no
   * restriction". Carried into Supabase by the existing settings JSONB
   * sync (LWW), so scope follows the user across devices for free.
   *
   * Schema lives in `lib/review/scope.ts` next to the scope helpers.
   */
  practiceScope: PracticeScope;
  /** Highest streak reached in the Higher-or-Lower mini-game (#349). */
  miniGameBestScore: number;
  /**
   * First-run onboarding dismissal flags (#433). Each surface tracks its own
   * one-shot hint; once dismissed it stays dismissed. The "Reset onboarding"
   * button in Settings restores all four to `false` at once. Lives in the
   * settings JSONB so dismissals follow the user across devices via the
   * existing settings sync (LWW).
   */
  onboarding: OnboardingFlags;
  /**
   * Streak milestones (in days) the user has already seen celebrated (#419).
   * Persists in the JSONB settings blob so a milestone fires exactly once
   * across reloads on a device. Cross-device deduplication is eventually
   * consistent - settings sync is LWW so a second device will only learn
   * about a celebration after the next manual sync cycle.
   */
  seenStreakMilestones: number[];
  /**
   * Gym badges the user has earned (#420). Append-only on award. The
   * id matches a `BadgeDefinition.id` from `lib/badges/catalog.ts`;
   * `earnedAt` is an ISO timestamp. The list is the source of truth for
   * which badges to render on the Trainer card. Unearned badges have no
   * entry - there is no progress hint anywhere in the UI.
   */
  earnedBadges: readonly { id: string; earnedAt: string }[];
  /**
   * Per-user optimized FSRS weight vector (#268). When present, the scheduler
   * uses these weights instead of the ts-fsrs defaults. Set by the
   * /api/srs/optimize route after a successful `computeParameters` call.
   * Undefined means the user hasn't run the optimizer yet (defaults apply).
   */
  fsrsWeights?: number[];
  /** ISO timestamp of the last successful weight optimization run (#268). */
  fsrsWeightsOptimizedAt?: string;
  /**
   * Number of distinct browser sessions in which the app has been visited.
   * Used to gate the PWA install nudge (#701) - shown only after 3 visits.
   * Incremented once per session (guarded by sessionStorage). Missing in
   * pre-#701 records; parses to 0 so existing users are not forced through the
   * threshold immediately (they will still see the nudge after 3 more visits).
   */
  appVisitCount: number;
  /**
   * Mobile navigation style (#661). `'bottom'` = fixed tab bar (new-user
   * default); `'hamburger'` = slide-in drawer (existing-user default for
   * records that pre-date this field). See `MobileNav` type.
   */
  mobileNav: MobileNav;
  /**
   * TTS voice URI (#429). When non-null, `speakName` looks up the voice by
   * `SpeechSynthesisVoice.voiceURI` and pins the utterance to it. Falls back
   * to the auto-picked preferred voice if the URI is not found (voice list
   * changes with OS installs). null = auto-pick (current behaviour).
   */
  ttsVoice: string | null;
  /**
   * TTS speech rate (#429). Maps to `SpeechSynthesisUtterance.rate`.
   * Valid range 0.5–2.0; default 1.0 preserves current behaviour.
   */
  ttsRate: number;
  /**
   * TTS volume (#429). Maps to `SpeechSynthesisUtterance.volume`.
   * Valid range 0–1; default 1.0 preserves current behaviour.
   */
  ttsVolume: number;
  /**
   * When true (default), `handleGrade` waits for any in-progress cry and/or
   * TTS to finish before swapping to the next card (#1191). When false, the
   * visible swap fires immediately and audio continues playing under the next
   * card - cry/TTS are global and are not cut off, only overlapped. Turning
   * this off removes the ~1-3 s audio-wait lag from the grading critical path.
   */
  waitForAudioOnGrade: boolean;
  /**
   * Controls how long the sprite-picker lingers on the correct/incorrect
   * feedback colouring before auto-advancing (#1200).
   * - `"off"` - 0 ms / 0 ms (no pause; advances immediately).
   * - `"fast"` - 250 ms correct / 500 ms incorrect.
   * - `"default"` - 600 ms correct / 1200 ms incorrect (original hardcoded values).
   * Defaults to `"default"` so existing users keep the behaviour they know.
   */
  reverseFeedbackDelay: "off" | "fast" | "default";
  /**
   * User's IANA timezone (#508). Null means "not yet detected" - the
   * Settings page auto-detects via Intl on first load and writes it back.
   * Stored as a scalar column in user_settings (NOT inside the JSONB blob)
   * so it doesn't get clobbered by the LWW JSONB sync. See lib/sync/settings.ts.
   */
  timezone: string | null;
  /**
   * User's preferred date format (#509). Null means "not yet detected".
   * Same storage rationale as `timezone` above.
   */
  dateFormat: DateFormat | null;
  /**
   * User's preferred local hour (0-23) for the daily push notification
   * (#1315). Null means "no preference" - the send-daily route falls back to
   * PUSH_DEFAULT_HOUR_UTC (8 = 08:00 UTC). Stored as a scalar column on
   * user_settings (migration 030), NOT inside the JSONB blob, for the same
   * reason as timezone/dateFormat: a dedicated write path via pushRegionalPrefs
   * prevents last-write-wins races with the JSONB merge path.
   */
  pushNotificationHour: number | null;
  /**
   * Streak protection state (#1227, revised #1245). Tokens auto-preserve a
   * streak across a missed day. Earned 1 per 30 consecutive review days,
   * capped at 3; scarcity is the only gate (consecutive spends are
   * permitted). The full rules and tunables live in `lib/streak/tokens.ts`.
   * Stored inside the JSONB blob so the existing settings sync carries the
   * state across devices; the per-key merge in `merge_user_settings` keeps
   * disjoint device writes safe.
   */
  streakProtection: StreakProtection;
  /**
   * Opt-in verified typed entry mode (#1251). When true, name cards render a
   * text input instead of the honour-system Reveal / grade buttons. The user
   * types the name; the grade is computed automatically from the Levenshtein
   * distance between their answer and the canonical species name.
   *
   * - Exact match (distance 0)       → Good (4)
   * - Near miss (distance 1 or 2)    → Hard (2)
   * - Wrong or empty (distance > 2)  → Again (1)
   *
   * Reverse, evolution, cry, and reverse-evolution cards are unaffected.
   * Default false: honour-system mode is preserved for all existing users.
   */
  verifiedTypedEntryMode: boolean;
  /**
   * Grading strictness for non-English typed entry (#1576). `"lenient"`
   * (default) accepts native script OR the pre-baked romanisation (rōmaji /
   * pinyin), tone/spacing/case-insensitively; `"strict"` accepts native
   * script only. The English typed-entry path ignores this value. Absent in
   * pre-#1576 records; back-fills to `"lenient"` on read. Plain JSONB field -
   * syncs via merge_user_settings, no migration.
   */
  typedEntryStrictness: TypedEntryStrictness;
  /**
   * One-time onboarding toast for typed entry (#1271). Set to true after the
   * first-enable toast is shown so it never fires again. Default false - absent
   * in pre-#1271 records; bool parser back-fills to false.
   */
  typedEntryOnboardingShown: boolean;
  /**
   * One-time banner above the first MC card (#1271). Set to true after the
   * first MC card in typed-entry mode is graded so the banner never reappears.
   * Default false - absent in pre-#1271 records; bool parser back-fills to false.
   */
  mcCardOnboardingShown: boolean;
  /**
   * Opt-in feature flags for preview / pre-release features (#1258).
   * Distinct from Superuser/Developer flags (which are QA cheats).
   * Labs flags are real user preferences: they sync normally and are never
   * suppressed by the superuser write-guard.
   *
   * Stored in the JSONB blob; missing keys back-fill from DEFAULT_LABS_FLAGS
   * on read (no migration needed). The registry of known flags lives in
   * `lib/labs/flags.ts`.
   */
  labsFlags: LabsFlags;
  /**
   * Locale for Pokémon name display (#1260). Independent from the app UI
   * locale (which is stored in the `poke-memory:locale` cookie). A user can
   * practise Japanese names while keeping the app UI in English, or vice
   * versa. Defaults to `"en"`. Only active when the `languages` Labs flag is
   * on. Absent in pre-#1260 records; back-fills to `"en"` on read.
   *
   * @deprecated Since #1484 the active learning language is
   * `activePokemonNameLocale`. This field is kept as a back-compat read alias
   * and is mirrored from `activePokemonNameLocale` on save so any reader that
   * only knows the old scalar (including cloud JSONB before the union-merge
   * RPC ships) stays correct.
   */
  pokemonNameLocale: AppLocale;
  /**
   * The set of Pokémon-name languages the user is actively learning (#1484).
   * English is always present and cannot be removed; at most the four supported
   * locales; order preserved for rendering. Absent in pre-#1484 records;
   * back-fills to `["en"]` (or `["en", pokemonNameLocale]` for a returning user
   * who had a non-English `pokemonNameLocale`) on read.
   */
  learningLocales: AppLocale[];
  /**
   * The currently-active member of `learningLocales` (#1484): the language shown
   * on practice cards and flipped by the status-bar switcher. Always a member of
   * `learningLocales`. Absent in pre-#1484 records; derived from
   * `pokemonNameLocale` on read.
   */
  activePokemonNameLocale: AppLocale;
  /**
   * Locales for which the machine-translation banner has been dismissed
   * (#1387). Each entry is an `AppLocale` string (e.g. `"ja"`, `"zh-Hans"`).
   * Absent in pre-#1387 records; back-fills to `[]` on read.
   *
   * Sync semantics: LWW via the `merge_user_settings` RPC `||` overlay, which
   * OVERWRITES arrays rather than unioning them. In the rare case where two
   * devices dismiss different locales before syncing, the last push wins and a
   * banner may re-show once on the other device. This is acceptable for a
   * cosmetic banner and matches the existing `seenStreakMilestones` behaviour.
   * On pull, dismissed locales from the cloud are UNIONED into the local
   * standalone `poke-memory:mt-banner-dismissed:<locale>` keys so a locally-
   * dismissed locale not yet pushed is never lost (see `pullAndMerge`).
   */
  dismissedMtBannerLocales: string[];
  /**
   * Locales the user has explicitly removed from their learning set (#1568).
   * A tombstone set: when a locale appears here it must not be re-added by
   * cross-device union-merge unless the user explicitly re-enrols it on this
   * device. Never contains `"en"` (English cannot be removed). Absent in
   * pre-#1568 records; back-fills to `[]` on read.
   *
   * Sync semantics: client-side union in `pullAndMerge` (see `mergeRemovedLocales`
   * in `lib/sync/settings.ts`). A locale in both `learningLocales` and
   * `removedLocales` is an invalid state - `saveSettings` and the enrol/remove
   * handlers keep them disjoint.
   *
   * v1 limitation: re-enrolling a locale that another OFFLINE device still
   * has tombstoned may be re-removed when that device syncs (no per-locale
   * timestamps). Rare and recoverable by re-enrolling.
   */
  removedLocales: AppLocale[];
  /**
   * ISO timestamp of the last user-triggered onboarding reset ("Show onboarding
   * again" button in Settings). Used as a tombstone by the DB regression trigger
   * (migration 038, predicate 4/6): a strictly-newer value signals that the flag
   * resets and counter decreases are user-intentional, not a stale-client clobber.
   * Absent in pre-reset records and in the DEFAULT_SETTINGS shape; back-fills to
   * undefined on read (trigger treats absent OLD as '' for the comparison).
   */
  onboardingResetAt?: string;
};

export const DEFAULT_SETTINGS: UserSettings = {
  masteryRepetitions: 3,
  maxNewPerDay: 10,
  maxReviewsPerDay: 100,
  maxNewEvolutionPerDay: 5,
  maxReviewsEvolutionPerDay: 50,
  evolutionCardsEnabled: true,
  reverseEvolutionCardsEnabled: false,
  maxNewReversePerDay: 10,
  maxReviewsReversePerDay: 100,
  playCryOnReveal: false,
  speakNameOnReveal: false,
  cryCardsEnabled: false,
  maxNewCryPerDay: 10,
  maxReviewsCryPerDay: 100,
  alternateFormsEnabled: false,
  favouriteTheme: null,
  themeIntensity: "accents",
  retentionTarget: 0.9,
  practiceScope: EMPTY_SCOPE,
  miniGameBestScore: 0,
  seenStreakMilestones: [],
  earnedBadges: [],
  onboarding: DEFAULT_ONBOARDING,
  appVisitCount: 0,
  // New users get the bottom tab bar; existing users who have a settings record
  // without this field are migrated to 'hamburger' in parseStoredSettings.
  mobileNav: "bottom" as MobileNav,
  ttsVoice: null,
  ttsRate: 1,
  ttsVolume: 1,
  // Default on: preserves today's behaviour. Users who want the faster swap
  // can turn this off in Settings → Audio (#1191).
  waitForAudioOnGrade: true,
  // Default "default": preserves the original 600/1200 ms behaviour for
  // existing users who have not explicitly chosen a delay (#1200).
  reverseFeedbackDelay: "default" as const,
  timezone: null,
  dateFormat: null,
  // Null = no preference; route falls back to PUSH_DEFAULT_HOUR_UTC (8).
  pushNotificationHour: null,
  streakProtection: { ...DEFAULT_STREAK_PROTECTION },
  // Default off: existing users keep the honour-system flow unchanged.
  verifiedTypedEntryMode: false,
  // Default lenient (#1576): romanised input is accepted for ja/zh typed entry.
  typedEntryStrictness: "lenient",
  // Default false: absent in pre-#1271 records; bool parser back-fills to false.
  typedEntryOnboardingShown: false,
  // Default false: absent in pre-#1271 records; bool parser back-fills to false.
  mcCardOnboardingShown: false,
  // Empty registry on initial ship (#1258); back-fill on read from DEFAULT_LABS_FLAGS.
  labsFlags: { ...DEFAULT_LABS_FLAGS },
  // Default "en": absent in pre-#1260 records; back-fills to English on read.
  pokemonNameLocale: DEFAULT_LOCALE,
  // Default ["en"]: a fresh user is enrolled in English only (#1484).
  learningLocales: [DEFAULT_LOCALE],
  // Default "en": matches the only enrolled locale (#1484).
  activePokemonNameLocale: DEFAULT_LOCALE,
  // Default []: absent in pre-#1387 records; back-fills to empty array on read.
  dismissedMtBannerLocales: [],
  // Default []: absent in pre-#1568 records; back-fills to empty array on read.
  removedLocales: [],
};

/** Inclusive bounds for the retention-target slider. */
export const RETENTION_TARGET_MIN = 0.8;
export const RETENTION_TARGET_MAX = 0.97;

function clampRetention(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.retentionTarget;
  if (v < RETENTION_TARGET_MIN) return RETENTION_TARGET_MIN;
  if (v > RETENTION_TARGET_MAX) return RETENTION_TARGET_MAX;
  return v;
}

/**
 * Strict-on-gens, permissive-on-types validator for the persisted scope
 * payload (#333). Same defensive posture as `favouriteTheme`: a malformed
 * sub-field must not poison the whole settings payload.
 *
 *   - gens: integers in [1, 9], deduped, preserving first-occurrence order.
 *   - types: any string accepted - the UI restricts the input set; this
 *     validator just guards JSON shape so a manually-edited localStorage
 *     blob with a stray type name doesn't drop the whole payload.
 *   - presets: only the known preset literals (`"starters"`, `"legendaries"`,
 *     `"incomplete-chains"`) are kept; unknown values are silently dropped.
 *
 * Returns `null` on malformed input so `loadSettings` can fall back to
 * the default.
 */
function validatePracticeScope(value: unknown): PracticeScope | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.gens) || !Array.isArray(v.types) || !Array.isArray(v.presets)) {
    return null;
  }
  const gens: number[] = [];
  const seenGens = new Set<number>();
  for (const g of v.gens) {
    if (typeof g !== "number" || !Number.isInteger(g) || g < 1 || g > 9) {
      return null;
    }
    if (seenGens.has(g)) continue;
    seenGens.add(g);
    gens.push(g);
  }
  const types: string[] = [];
  for (const t of v.types) {
    if (typeof t !== "string") return null;
    types.push(t);
  }
  const presets: PracticeScopePreset[] = [];
  const seenPresets = new Set<PracticeScopePreset>();
  for (const p of v.presets) {
    if (p !== "starters" && p !== "legendaries" && p !== "incomplete-chains") continue;
    if (seenPresets.has(p)) continue;
    seenPresets.add(p);
    presets.push(p);
  }
  // formCategories is additive - absent in pre-#450 persisted scopes; default
  // to {mode:'all'} so existing users see no behaviour change.
  const formCategories = parseFormCategoryFilter(v.formCategories);
  // games is additive - absent in pre-#1089 persisted scopes; default to [].
  // Unknown string entries are kept (the matcher just won't match them) rather
  // than rejecting the whole payload, mirroring the type-axis approach.
  const games: string[] = [];
  if (Array.isArray(v.games)) {
    const seenGames = new Set<string>();
    for (const g of v.games) {
      if (typeof g !== "string") return null;
      if (seenGames.has(g)) continue;
      seenGames.add(g);
      games.push(g);
    }
  }
  return { gens, types, presets, formCategories, games };
}

// ─── Coercion helpers (local to this file) ──────────────────────────────────
//
// Each helper reads a single key from the raw parsed object and returns the
// stored value when its runtime type matches, or the corresponding default
// otherwise.  They are intentionally narrow - no side-effects, no clamping.
// Custom validators (retentionTarget clamp, practiceScope, etc.) are left
// inline so they remain visually distinct.

type RawObj = Record<string, unknown>;

/** Returns `obj[key]` when it is a `number`, otherwise `DEFAULT_SETTINGS[key]`. */
function num<K extends keyof UserSettings>(
  obj: RawObj,
  key: K,
): UserSettings[K] {
  return (typeof obj[key] === "number"
    ? obj[key]
    : DEFAULT_SETTINGS[key]) as UserSettings[K];
}

/** Returns `obj[key]` when it is a `boolean`, otherwise `DEFAULT_SETTINGS[key]`. */
function bool<K extends keyof UserSettings>(
  obj: RawObj,
  key: K,
): UserSettings[K] {
  return (typeof obj[key] === "boolean"
    ? obj[key]
    : DEFAULT_SETTINGS[key]) as UserSettings[K];
}

/** Returns `obj[key]` when it is a `string`, otherwise `DEFAULT_SETTINGS[key]`. */
function str<K extends keyof UserSettings>(
  obj: RawObj,
  key: K,
): UserSettings[K] {
  return (typeof obj[key] === "string"
    ? obj[key]
    : DEFAULT_SETTINGS[key]) as UserSettings[K];
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal: parse settings JSON without applying the legacy-scope migration.
 * Used by both `loadSettings` and the migration path so the migration can
 * inspect the parsed payload before triggering side effects.
 *
 * Always returns a fresh object so the caller (the migration path) can
 * mutate `practiceScope` without aliasing back into `DEFAULT_SETTINGS`.
 */
function parseStoredSettings(raw: string | null): UserSettings {
  if (raw === null) return { ...DEFAULT_SETTINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SETTINGS };
  const obj = parsed as RawObj;
  // Multi-language enrolment (#1484): derive the learning set and the active
  // member, with a one-shot back-compat promotion from the legacy
  // pokemonNameLocale scalar for records that predate #1484.
  const legacyPokemonLocale: AppLocale | null = isAppLocale(obj.pokemonNameLocale)
    && obj.pokemonNameLocale !== "en"
    ? obj.pokemonNameLocale
    : null;
  const learningLocales: AppLocale[] =
    obj.learningLocales == null && legacyPokemonLocale !== null
      ? ["en", legacyPokemonLocale]
      : validateLearningLocales(obj.learningLocales);
  const activePokemonNameLocale: AppLocale = resolveActiveLocale(
    obj.activePokemonNameLocale,
    legacyPokemonLocale,
    learningLocales,
  );
  return {
    masteryRepetitions:        num(obj, "masteryRepetitions"),
    maxNewPerDay:              num(obj, "maxNewPerDay"),
    maxReviewsPerDay:          num(obj, "maxReviewsPerDay"),
    maxNewEvolutionPerDay:     num(obj, "maxNewEvolutionPerDay"),
    maxReviewsEvolutionPerDay: num(obj, "maxReviewsEvolutionPerDay"),
    evolutionCardsEnabled:        bool(obj, "evolutionCardsEnabled"),
    reverseEvolutionCardsEnabled: bool(obj, "reverseEvolutionCardsEnabled"),
    maxNewReversePerDay:     num(obj, "maxNewReversePerDay"),
    maxReviewsReversePerDay: num(obj, "maxReviewsReversePerDay"),
    playCryOnReveal:   bool(obj, "playCryOnReveal"),
    speakNameOnReveal: bool(obj, "speakNameOnReveal"),
    cryCardsEnabled:   bool(obj, "cryCardsEnabled"),
    maxNewCryPerDay:     num(obj, "maxNewCryPerDay"),
    maxReviewsCryPerDay: num(obj, "maxReviewsCryPerDay"),
    // Defensive default: missing/non-boolean → false. Existing users lose form
    // cards from practice until they opt in via the Settings toggle (#658).
    alternateFormsEnabled: bool(obj, "alternateFormsEnabled"),
    // Shallow validation only - lib/theme/persistence.ts does the deep
    // validation (HEX_COLOR, known Pokémon id) on read.
    favouriteTheme:
      typeof obj.favouriteTheme === "object" && obj.favouriteTheme !== null
        ? (obj.favouriteTheme as StoredFavouriteTheme)
        : null,
    themeIntensity:
      obj.themeIntensity === "accents" ||
      obj.themeIntensity === "tinted" ||
      obj.themeIntensity === "full"
        ? obj.themeIntensity
        : DEFAULT_SETTINGS.themeIntensity,
    retentionTarget:
      typeof obj.retentionTarget === "number"
        ? clampRetention(obj.retentionTarget)
        : DEFAULT_SETTINGS.retentionTarget,
    practiceScope:
      validatePracticeScope(obj.practiceScope) ?? EMPTY_SCOPE,
    miniGameBestScore:
      Number.isFinite(obj.miniGameBestScore) &&
      (obj.miniGameBestScore as number) >= 0
        ? (obj.miniGameBestScore as number)
        : DEFAULT_SETTINGS.miniGameBestScore,
    seenStreakMilestones: validateSeenStreakMilestones(obj.seenStreakMilestones),
    earnedBadges: validateEarnedBadges(obj.earnedBadges),
    onboarding: validateOnboarding(obj.onboarding),
    appVisitCount:
      typeof obj.appVisitCount === "number" &&
      Number.isInteger(obj.appVisitCount) &&
      obj.appVisitCount >= 0
        ? obj.appVisitCount
        : DEFAULT_SETTINGS.appVisitCount,
    waitForAudioOnGrade: bool(obj, "waitForAudioOnGrade"),
    // Existing-user migration (#1200): records without this field get
    // "default" so they keep the original 600/1200 ms behaviour.
    reverseFeedbackDelay:
      obj.reverseFeedbackDelay === "off" ||
      obj.reverseFeedbackDelay === "fast" ||
      obj.reverseFeedbackDelay === "default"
        ? obj.reverseFeedbackDelay
        : "default",
    ttsVoice: str(obj, "ttsVoice"),
    ttsRate:
      typeof obj.ttsRate === "number" && Number.isFinite(obj.ttsRate)
        ? Math.max(0.5, Math.min(2.0, obj.ttsRate))
        : DEFAULT_SETTINGS.ttsRate,
    ttsVolume:
      typeof obj.ttsVolume === "number" && Number.isFinite(obj.ttsVolume)
        ? Math.max(0, Math.min(1, obj.ttsVolume))
        : DEFAULT_SETTINGS.ttsVolume,
    timezone: str(obj, "timezone"),
    dateFormat:
      obj.dateFormat === "iso" || obj.dateFormat === "dmy" || obj.dateFormat === "mdy"
        ? obj.dateFormat
        : DEFAULT_SETTINGS.dateFormat,
    // Null = no preference. Absent in pre-#1315 records; back-fills to null.
    pushNotificationHour:
      typeof obj.pushNotificationHour === "number" &&
      Number.isInteger(obj.pushNotificationHour) &&
      obj.pushNotificationHour >= 0 &&
      obj.pushNotificationHour <= 23
        ? obj.pushNotificationHour
        : null,
    // Existing-user migration (#661): a record that pre-dates this field will
    // have no `mobileNav` key. To preserve their experience, default to
    // 'hamburger' (what they had before). A brand-new user (raw === null) never
    // reaches this branch - they get DEFAULT_SETTINGS which is 'bottom'.
    mobileNav:
      obj.mobileNav === "bottom" || obj.mobileNav === "hamburger"
        ? obj.mobileNav
        : "hamburger",
    streakProtection: validateStreakProtection(obj.streakProtection),
    // Default false: existing records without this field keep the honour-system
    // flow unchanged (#1251).
    verifiedTypedEntryMode: bool(obj, "verifiedTypedEntryMode"),
    // Default "lenient": absent in pre-#1576 records; only the known literals
    // are kept (same defensive posture as reverseFeedbackDelay).
    typedEntryStrictness:
      obj.typedEntryStrictness === "strict" || obj.typedEntryStrictness === "lenient"
        ? obj.typedEntryStrictness
        : DEFAULT_SETTINGS.typedEntryStrictness,
    // Default false: absent in pre-#1271 records (#1271).
    typedEntryOnboardingShown: bool(obj, "typedEntryOnboardingShown"),
    // Default false: absent in pre-#1271 records (#1271).
    mcCardOnboardingShown: bool(obj, "mcCardOnboardingShown"),
    // Back-fill missing keys from the registry; unknown keys silently dropped (#1258).
    labsFlags: parseLabsFlags(obj.labsFlags),
    // Default "en": absent in pre-#1260 records (#1260). Only accepted locale
    // values are kept; anything else falls back to English.
    pokemonNameLocale:
      obj.pokemonNameLocale === "en" ||
      obj.pokemonNameLocale === "ja" ||
      obj.pokemonNameLocale === "zh-Hans" ||
      obj.pokemonNameLocale === "zh-Hant"
        ? (obj.pokemonNameLocale as AppLocale)
        : DEFAULT_LOCALE,
    // Multi-language enrolment + active member (#1484), derived above.
    learningLocales,
    activePokemonNameLocale,
    // Default []: absent in pre-#1387 records. Non-array or entries that are
    // not strings are silently dropped - same defensive posture as seenStreakMilestones.
    dismissedMtBannerLocales: validateDismissedMtBannerLocales(obj.dismissedMtBannerLocales),
    // Default []: absent in pre-#1568 records. Deduped; "en" always dropped.
    removedLocales: validateRemovedLocales(obj.removedLocales),
    // Absent in records that predate the first onboarding reset; back-fills to
    // undefined so the trigger treats it as '' (no bypass).
    onboardingResetAt: typeof obj.onboardingResetAt === 'string' ? obj.onboardingResetAt : undefined,
  };
}

export function validateOnboarding(value: unknown): OnboardingFlags {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_ONBOARDING };
  const v = value as Record<string, unknown>;
  return {
    firstVisitOnboardingDismissed: v.firstVisitOnboardingDismissed === true,
    welcomeDismissed: v.welcomeDismissed === true,
    practiceHintDismissed: v.practiceHintDismissed === true,
    statsHintDismissed: v.statsHintDismissed === true,
    settingsHintDismissed: v.settingsHintDismissed === true,
    installNudgeDismissed: v.installNudgeDismissed === true,
    audioHintDismissed: v.audioHintDismissed === true,
    cardTypesHintDismissed: v.cardTypesHintDismissed === true,
    guestStorageNoticeDismissed: v.guestStorageNoticeDismissed === true,
    // === true coercion: absent key in pre-#1441 blobs resolves to false (hint shows).
    journeyMasteryExplainerDismissed: v.journeyMasteryExplainerDismissed === true,
    // === true coercion: absent key in pre-#1443 blobs resolves to false (nudge shows).
    markWhatIKnowNudgeDismissed: v.markWhatIKnowNudgeDismissed === true,
    // === true coercion: absent key in pre-#1443 blobs resolves to false (nudge shows).
    practiceScopeNudgeDismissed: v.practiceScopeNudgeDismissed === true,
    // === true coercion: absent key in pre-#1482 blobs resolves to false (never opened).
    scopeEverOpened: v.scopeEverOpened === true,
    // Integer coercion: absent key in pre-#1482 blobs resolves to 0 (below threshold).
    practiceSessionsCount:
      typeof v.practiceSessionsCount === 'number' &&
      Number.isInteger(v.practiceSessionsCount) &&
      v.practiceSessionsCount >= 0
        ? v.practiceSessionsCount
        : 0,
    // === true coercion: absent key in pre-#1538 blobs resolves to false (nudge shows).
    offlineDownloadNudgeDismissed: v.offlineDownloadNudgeDismissed === true,
    // Integer coercion: absent key in pre-#1538 blobs resolves to 0 (below threshold).
    slowSpriteLoadCount:
      typeof v.slowSpriteLoadCount === 'number' &&
      Number.isInteger(v.slowSpriteLoadCount) &&
      v.slowSpriteLoadCount >= 0
        ? v.slowSpriteLoadCount
        : 0,
    // === true coercion: absent key in pre-#1572 blobs resolves to false (hint shows).
    pastureLongPressHintDismissed: v.pastureLongPressHintDismissed === true,
    // === true coercion: absent key in pre-#1573 blobs resolves to false (hint shows).
    higherOrLowerNudgeDismissed: v.higherOrLowerNudgeDismissed === true,
    // === true coercion: absent key in pre-#1668 blobs resolves to false (nudge shows
    // for existing guests who meet the progress threshold on their next visit).
    guestSignUpNudgeDismissed: v.guestSignUpNudgeDismissed === true,
    // === true coercion: absent key in pre-#1726 blobs resolves to false (not dismissed;
    // Card types section defaults open on first Settings visit).
    cardTypesDefaultOpenDismissed: v.cardTypesDefaultOpenDismissed === true,
    // === true coercion: absent key in pre-#1767 blobs resolves to false (not dismissed;
    // hint shows on next practice session for existing users with blocked species).
    masteryBlockersNudgeDismissed: v.masteryBlockersNudgeDismissed === true,
  };
}

function validateSeenStreakMilestones(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of value) {
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
function validateDismissedMtBannerLocales(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Type guard for a supported app/Pokémon-name locale. */
function isAppLocale(v: unknown): v is AppLocale {
  return v === "en" || v === "ja" || v === "zh-Hans" || v === "zh-Hant";
}

/**
 * Validates the learning-locales set (#1484): keeps only known locales, dedupes,
 * and guarantees English is always present (it is the canonical reverse-card
 * answer language and cannot be removed). Order is preserved.
 *
 * Exported so the sync layer can call it when merging cloud and local sets
 * without re-deriving the logic (#1568).
 */
export function validateLearningLocales(value: unknown): AppLocale[] {
  if (!Array.isArray(value)) return [DEFAULT_LOCALE];
  const out: AppLocale[] = [];
  const seen = new Set<AppLocale>();
  for (const v of value) {
    if (!isAppLocale(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  if (!seen.has("en")) out.unshift("en");
  return out;
}

/**
 * Validates the removed-locales tombstone set (#1568): keeps only known
 * `AppLocale`s, dedupes, and ALWAYS drops `"en"` (English cannot be removed).
 * Order is preserved.
 *
 * Exported so the sync layer can call it when merging cloud and local sets
 * without re-deriving the logic.
 */
export function validateRemovedLocales(value: unknown): AppLocale[] {
  if (!Array.isArray(value)) return [];
  const out: AppLocale[] = [];
  const seen = new Set<AppLocale>();
  for (const v of value) {
    // English can never be in the removed set.
    if (!isAppLocale(v) || v === "en" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Resolves the active Pokémon-name locale (#1484): the stored value when it is a
 * known locale AND enrolled; otherwise the legacy `pokemonNameLocale` (if
 * enrolled); otherwise the first enrolled locale (always English).
 *
 * Exported so the sync layer can call it after computing the merged
 * `learningLocales` set (#1568).
 */
export function resolveActiveLocale(
  stored: unknown,
  legacy: AppLocale | null,
  learningLocales: AppLocale[],
): AppLocale {
  if (isAppLocale(stored) && learningLocales.includes(stored)) return stored;
  if (legacy !== null && learningLocales.includes(legacy)) return legacy;
  return learningLocales[0] ?? DEFAULT_LOCALE;
}

/**
 * Defensive parser: silently drops malformed entries but keeps the
 * well-formed ones. A user with 10 legitimate badges should not lose
 * all of them because a single entry was corrupted by a manual edit.
 * A non-array top-level value still falls back to `[]`.
 */
function validateEarnedBadges(
  value: unknown,
): readonly { id: string; earnedAt: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { id: string; earnedAt: string }[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.earnedAt !== "string") continue;
    out.push({ id: e.id, earnedAt: e.earnedAt });
  }
  return out;
}

// Returns DEFAULT_SETTINGS on fresh load, server, or corruption. Never throws.
// Legacy stored objects without the evolution-* keys are silently upgraded
// with the defaults - name-card limits keep their saved values.
//
// Also performs a one-shot migration of the legacy practice-scope localStorage
// key (`poke-memory:practice-scope:v1`, the original storage used before
// `practiceScope` was folded into `UserSettings`). The migration runs at most
// once per device: as soon as the legacy key is cleared, the read short-circuits
// and there is nothing left to copy in. When both the legacy key and a stored
// `practiceScope` field exist, the stored field wins (it is newer by definition
// - once `saveSettings` runs it always carries `practiceScope`).
export function loadSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const settings = readLocalStorage(
    STORAGE_KEY,
    (raw) => parseStoredSettings(raw),
    { ...DEFAULT_SETTINGS },
  );

  // Legacy scope migration. Only fires when the current settings.practiceScope
  // is the empty default - a non-empty stored field always wins. The legacy
  // key is cleared after the read regardless, so the migration is strictly
  // one-shot (no perpetual re-fire).
  const legacy = readLegacyScope();
  if (legacy !== null) {
    clearLegacyScope();
    if (isScopeEmpty(settings.practiceScope) && !isScopeEmpty(legacy)) {
      settings.practiceScope = legacy;
      // Persist so the next load (and the next sync push) carries the scope
      // without depending on the legacy key.
      saveSettings(settings);
    }
  }

  return settings;
}

/**
 * Fires on every successful `saveSettings` write. The detail carries the
 * settings object that was just persisted. Consumed by
 * `components/sync/AutoSyncOnChange.tsx` to push the change to Supabase
 * without waiting for the next manual Sync (#319).
 */
export const SETTINGS_SAVED_EVENT = "poke-memory:settings-saved";

// Serialises to localStorage. No-op on server. Never throws.
export function saveSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  // Mirror the deprecated `pokemonNameLocale` scalar from the active learning
  // locale (#1484), so any reader that only knows the old field - including the
  // cloud settings JSONB before the union-merge RPC ships - stays correct.
  // Fall back to the existing `pokemonNameLocale` field for pre-#1484 backups
  // where `activePokemonNameLocale` may be absent (F44 / #1860).
  const toWrite: UserSettings = {
    ...settings,
    pokemonNameLocale: settings.activePokemonNameLocale ?? settings.pokemonNameLocale,
  };
  // writeLocalStorage handles the guard + try/catch. The CustomEvent dispatch
  // is kept explicit here because it carries a typed detail payload that is
  // not a plain StorageEvent.
  writeLocalStorage(STORAGE_KEY, toWrite);
  window.dispatchEvent(
    new CustomEvent(SETTINGS_SAVED_EVENT, { detail: toWrite }),
  );
}

// True if a settings blob has been explicitly written. loadSettings cannot
// distinguish "never written" from "written with defaults" - sync logic needs
// this to know whether a pulled cloud value should overlay local defaults.
export function hasStoredSettings(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}

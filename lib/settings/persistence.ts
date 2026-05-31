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

// localStorage key for all user-configurable settings
export const STORAGE_KEY = KEY_SETTINGS;

// Mirror of the structure stored under `favouriteTheme`. Validation of the
// values (HEX_COLOR / known Pokémon id) happens in lib/theme/persistence.ts
// — here we treat the field as an opaque container.
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
};

/**
 * Mobile navigation style (#661). Controls which mobile nav surface is shown
 * below the `md` breakpoint.
 * - `'bottom'` — fixed bottom tab bar (new default for new users).
 * - `'hamburger'` — slide-in drawer triggered by a hamburger button in the header
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
   * Defaults to false — the base Pokédex is already a large deck and forms
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
   * consistent — settings sync is LWW so a second device will only learn
   * about a celebration after the next manual sync cycle.
   */
  seenStreakMilestones: number[];
  /**
   * Gym badges the user has earned (#420). Append-only on award. The
   * id matches a `BadgeDefinition.id` from `lib/badges/catalog.ts`;
   * `earnedAt` is an ISO timestamp. The list is the source of truth for
   * which badges to render on the Trainer card. Unearned badges have no
   * entry — there is no progress hint anywhere in the UI.
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
   * Used to gate the PWA install nudge (#701) — shown only after 3 visits.
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
   * card — cry/TTS are global and are not cut off, only overlapped. Turning
   * this off removes the ~1-3 s audio-wait lag from the grading critical path.
   */
  waitForAudioOnGrade: boolean;
  /**
   * Controls how long the sprite-picker lingers on the correct/incorrect
   * feedback colouring before auto-advancing (#1200).
   * - `"off"`     — 0 ms / 0 ms (no pause; advances immediately).
   * - `"fast"`    — 250 ms correct / 500 ms incorrect.
   * - `"default"` — 600 ms correct / 1200 ms incorrect (original hardcoded values).
   * Defaults to `"default"` so existing users keep the behaviour they know.
   */
  reverseFeedbackDelay: "off" | "fast" | "default";
  /**
   * User's IANA timezone (#508). Null means "not yet detected" — the
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
   * (#1315). Null means "no preference" — the send-daily route falls back to
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
   * One-time onboarding toast for typed entry (#1271). Set to true after the
   * first-enable toast is shown so it never fires again. Default false — absent
   * in pre-#1271 records; bool parser back-fills to false.
   */
  typedEntryOnboardingShown: boolean;
  /**
   * One-time banner above the first MC card (#1271). Set to true after the
   * first MC card in typed-entry mode is graded so the banner never reappears.
   * Default false — absent in pre-#1271 records; bool parser back-fills to false.
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
   */
  pokemonNameLocale: AppLocale;
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
  // Default false: absent in pre-#1271 records; bool parser back-fills to false.
  typedEntryOnboardingShown: false,
  // Default false: absent in pre-#1271 records; bool parser back-fills to false.
  mcCardOnboardingShown: false,
  // Empty registry on initial ship (#1258); back-fill on read from DEFAULT_LABS_FLAGS.
  labsFlags: { ...DEFAULT_LABS_FLAGS },
  // Default "en": absent in pre-#1260 records; back-fills to English on read.
  pokemonNameLocale: DEFAULT_LOCALE,
  // Default []: absent in pre-#1387 records; back-fills to empty array on read.
  dismissedMtBannerLocales: [],
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
 *   - types: any string accepted — the UI restricts the input set; this
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
  // formCategories is additive — absent in pre-#450 persisted scopes; default
  // to {mode:'all'} so existing users see no behaviour change.
  const formCategories = parseFormCategoryFilter(v.formCategories);
  // games is additive — absent in pre-#1089 persisted scopes; default to [].
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
// otherwise.  They are intentionally narrow — no side-effects, no clamping.
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
    // Shallow validation only — lib/theme/persistence.ts does the deep
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
    // reaches this branch — they get DEFAULT_SETTINGS which is 'bottom'.
    mobileNav:
      obj.mobileNav === "bottom" || obj.mobileNav === "hamburger"
        ? obj.mobileNav
        : "hamburger",
    streakProtection: validateStreakProtection(obj.streakProtection),
    // Default false: existing records without this field keep the honour-system
    // flow unchanged (#1251).
    verifiedTypedEntryMode: bool(obj, "verifiedTypedEntryMode"),
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
    // Default []: absent in pre-#1387 records. Non-array or entries that are
    // not strings are silently dropped — same defensive posture as seenStreakMilestones.
    dismissedMtBannerLocales: validateDismissedMtBannerLocales(obj.dismissedMtBannerLocales),
  };
}

function validateOnboarding(value: unknown): OnboardingFlags {
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
// with the defaults — name-card limits keep their saved values.
//
// Also performs a one-shot migration of the legacy practice-scope localStorage
// key (`poke-memory:practice-scope:v1`, the original storage used before
// `practiceScope` was folded into `UserSettings`). The migration runs at most
// once per device: as soon as the legacy key is cleared, the read short-circuits
// and there is nothing left to copy in. When both the legacy key and a stored
// `practiceScope` field exist, the stored field wins (it is newer by definition
// — once `saveSettings` runs it always carries `practiceScope`).
export function loadSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const settings = readLocalStorage(
    STORAGE_KEY,
    (raw) => parseStoredSettings(raw),
    { ...DEFAULT_SETTINGS },
  );

  // Legacy scope migration. Only fires when the current settings.practiceScope
  // is the empty default — a non-empty stored field always wins. The legacy
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
  // writeLocalStorage handles the guard + try/catch. The CustomEvent dispatch
  // is kept explicit here because it carries a typed detail payload that is
  // not a plain StorageEvent.
  writeLocalStorage(STORAGE_KEY, settings);
  window.dispatchEvent(
    new CustomEvent(SETTINGS_SAVED_EVENT, { detail: settings }),
  );
}

// True if a settings blob has been explicitly written. loadSettings cannot
// distinguish "never written" from "written with defaults" — sync logic needs
// this to know whether a pulled cloud value should overlay local defaults.
export function hasStoredSettings(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}

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

// localStorage key for all user-configurable settings
export const STORAGE_KEY = "poke-memory:settings:v1";

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
  welcomeDismissed: boolean;
  practiceHintDismissed: boolean;
  statsHintDismissed: boolean;
  settingsHintDismissed: boolean;
};

export const DEFAULT_ONBOARDING: OnboardingFlags = {
  welcomeDismissed: false,
  practiceHintDismissed: false,
  statsHintDismissed: false,
  settingsHintDismissed: false,
};

export type UserSettings = {
  masteryRepetitions: number;        // cards with this many consecutive correct reviews = mastered
  maxNewPerDay: number;              // hard daily cap for new name cards
  maxReviewsPerDay: number;          // soft daily cap for name reviews
  maxNewEvolutionPerDay: number;     // hard daily cap for new evolution cards
  maxReviewsEvolutionPerDay: number; // soft daily cap for evolution reviews
  nameCardsEnabled: boolean;         // show sprite as prompt; type/select the name
  evolutionCardsEnabled: boolean;    // show sprite; identify evolution chain
  reverseEvolutionCardsEnabled: boolean; // reverse-direction evolution edge cards (#343)
  reverseCardsEnabled: boolean;      // show name as prompt; reveal sprite
  maxNewReversePerDay: number;       // hard daily cap for new reverse cards
  maxReviewsReversePerDay: number;   // soft daily cap for reverse reviews
  playCryOnReveal: boolean;          // play Pokémon cry audio on card reveal
  speakNameOnReveal: boolean;        // speak Pokémon name aloud (TTS) on card reveal
  cryCardsEnabled: boolean;          // enable third-direction cards: audio prompt → name
  maxNewCryPerDay: number;
  maxReviewsCryPerDay: number;
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
};

export const DEFAULT_SETTINGS: UserSettings = {
  masteryRepetitions: 3,
  maxNewPerDay: 10,
  maxReviewsPerDay: 100,
  maxNewEvolutionPerDay: 5,
  maxReviewsEvolutionPerDay: 50,
  nameCardsEnabled: true,
  evolutionCardsEnabled: true,
  reverseEvolutionCardsEnabled: false,
  reverseCardsEnabled: false,
  maxNewReversePerDay: 10,
  maxReviewsReversePerDay: 100,
  playCryOnReveal: false,
  speakNameOnReveal: false,
  cryCardsEnabled: false,
  maxNewCryPerDay: 10,
  maxReviewsCryPerDay: 100,
  favouriteTheme: null,
  themeIntensity: "accents",
  retentionTarget: 0.9,
  practiceScope: EMPTY_SCOPE,
  miniGameBestScore: 0,
  seenStreakMilestones: [],
  earnedBadges: [],
  onboarding: DEFAULT_ONBOARDING,
  ttsVoice: null,
  ttsRate: 1,
  ttsVolume: 1,
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
 *   - presets: only the known preset literals (`"starters"`, `"legendaries"`)
 *     are kept; unknown values are silently dropped.
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
    if (p !== "starters" && p !== "legendaries") continue;
    if (seenPresets.has(p)) continue;
    seenPresets.add(p);
    presets.push(p);
  }
  // formCategories is additive — absent in pre-#450 persisted scopes; default
  // to {mode:'all'} so existing users see no behaviour change.
  const formCategories = parseFormCategoryFilter(v.formCategories);
  return { gens, types, presets, formCategories };
}

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
  const obj = parsed as Record<string, unknown>;
  return {
    masteryRepetitions:
      typeof obj.masteryRepetitions === "number"
        ? obj.masteryRepetitions
        : DEFAULT_SETTINGS.masteryRepetitions,
    maxNewPerDay:
      typeof obj.maxNewPerDay === "number"
        ? obj.maxNewPerDay
        : DEFAULT_SETTINGS.maxNewPerDay,
    maxReviewsPerDay:
      typeof obj.maxReviewsPerDay === "number"
        ? obj.maxReviewsPerDay
        : DEFAULT_SETTINGS.maxReviewsPerDay,
    maxNewEvolutionPerDay:
      typeof obj.maxNewEvolutionPerDay === "number"
        ? obj.maxNewEvolutionPerDay
        : DEFAULT_SETTINGS.maxNewEvolutionPerDay,
    maxReviewsEvolutionPerDay:
      typeof obj.maxReviewsEvolutionPerDay === "number"
        ? obj.maxReviewsEvolutionPerDay
        : DEFAULT_SETTINGS.maxReviewsEvolutionPerDay,
    nameCardsEnabled:
      typeof obj.nameCardsEnabled === "boolean"
        ? obj.nameCardsEnabled
        : DEFAULT_SETTINGS.nameCardsEnabled,
    evolutionCardsEnabled:
      typeof obj.evolutionCardsEnabled === "boolean"
        ? obj.evolutionCardsEnabled
        : DEFAULT_SETTINGS.evolutionCardsEnabled,
    reverseEvolutionCardsEnabled:
      typeof obj.reverseEvolutionCardsEnabled === "boolean"
        ? obj.reverseEvolutionCardsEnabled
        : DEFAULT_SETTINGS.reverseEvolutionCardsEnabled,
    reverseCardsEnabled:
      typeof obj.reverseCardsEnabled === "boolean"
        ? obj.reverseCardsEnabled
        : DEFAULT_SETTINGS.reverseCardsEnabled,
    maxNewReversePerDay:
      typeof obj.maxNewReversePerDay === "number"
        ? obj.maxNewReversePerDay
        : DEFAULT_SETTINGS.maxNewReversePerDay,
    maxReviewsReversePerDay:
      typeof obj.maxReviewsReversePerDay === "number"
        ? obj.maxReviewsReversePerDay
        : DEFAULT_SETTINGS.maxReviewsReversePerDay,
    playCryOnReveal:
      typeof obj.playCryOnReveal === "boolean"
        ? obj.playCryOnReveal
        : DEFAULT_SETTINGS.playCryOnReveal,
    speakNameOnReveal:
      typeof obj.speakNameOnReveal === "boolean"
        ? obj.speakNameOnReveal
        : DEFAULT_SETTINGS.speakNameOnReveal,
    cryCardsEnabled:
      typeof obj.cryCardsEnabled === "boolean"
        ? obj.cryCardsEnabled
        : DEFAULT_SETTINGS.cryCardsEnabled,
    maxNewCryPerDay:
      typeof obj.maxNewCryPerDay === "number"
        ? obj.maxNewCryPerDay
        : DEFAULT_SETTINGS.maxNewCryPerDay,
    maxReviewsCryPerDay:
      typeof obj.maxReviewsCryPerDay === "number"
        ? obj.maxReviewsCryPerDay
        : DEFAULT_SETTINGS.maxReviewsCryPerDay,
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
    ttsVoice:
      typeof obj.ttsVoice === "string" ? obj.ttsVoice : DEFAULT_SETTINGS.ttsVoice,
    ttsRate:
      typeof obj.ttsRate === "number" && Number.isFinite(obj.ttsRate)
        ? Math.max(0.5, Math.min(2.0, obj.ttsRate))
        : DEFAULT_SETTINGS.ttsRate,
    ttsVolume:
      typeof obj.ttsVolume === "number" && Number.isFinite(obj.ttsVolume)
        ? Math.max(0, Math.min(1, obj.ttsVolume))
        : DEFAULT_SETTINGS.ttsVolume,
  };
}

function validateOnboarding(value: unknown): OnboardingFlags {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_ONBOARDING };
  const v = value as Record<string, unknown>;
  return {
    welcomeDismissed: v.welcomeDismissed === true,
    practiceHintDismissed: v.practiceHintDismissed === true,
    statsHintDismissed: v.statsHintDismissed === true,
    settingsHintDismissed: v.settingsHintDismissed === true,
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
  const raw = localStorage.getItem(STORAGE_KEY);
  const settings = parseStoredSettings(raw);

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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

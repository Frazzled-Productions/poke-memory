"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadSettings,
  saveSettings,
  RETENTION_TARGET_MIN,
  RETENTION_TARGET_MAX,
} from "@/lib/settings/persistence";
import type { UserSettings } from "@/lib/settings/persistence";
import { exportProgress, validateBackup, applyBackup } from "@/lib/backup/io";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { useAuth } from "@/lib/auth/AuthContext";
import { clearLocalProgress } from "@/lib/storage/reset";
import { resetAllProgressEverywhere } from "@/lib/sync/reset";
import { ResetProgressDialog } from "@/components/settings/ResetProgressDialog";
import { DeleteAccountDialog } from "@/components/settings/DeleteAccountDialog";
import { ReenableCardTypeDialog, type ReenableChoice } from "@/components/settings/ReenableCardTypeDialog";
import { deleteAccountEverywhere } from "@/lib/sync/deleteAccount";
import { signOut } from "@/lib/auth/actions";
import { CURATED_POKEMON } from "@/lib/theme/curated-pokemon";
import type { CuratedPokemon } from "@/lib/theme/curated-pokemon";
import { loadFavourite, saveFavourite } from "@/lib/theme/persistence";
import { useFavourite } from "@/components/theme/FavouriteThemeProvider";
import { isMastered } from "@/lib/stats/derive";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadGradeLog } from "@/lib/gradelog/persistence";
import type { ReviewState } from "@/lib/srs/scheduler";
import { initialReviewState } from "@/lib/srs/scheduler";
import { countOptimizableReviews } from "@/lib/srs/optimizer";
import { FsrsOptimizerSection } from "@/components/settings/FsrsOptimizerSection";
import { IntensityPicker } from "@/components/settings/IntensityPicker";
import { KnownPokemonQuiz } from "@/components/onboarding/KnownPokemonQuiz";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { DEFAULT_ONBOARDING } from "@/lib/settings/persistence";
import { VoiceQualityHint } from "@/components/settings/VoiceQualityHint";
import { TtsControls } from "@/components/settings/TtsControls";
import { CollapsibleSection } from "@/components/settings/CollapsibleSection";
import { SettingsSearch } from "@/components/settings/SettingsSearch";
import {
  SETTINGS_SEARCH_INDEX,
  sectionMatchesQuery,
} from "@/components/settings/settingsSearchIndex";
import {
  detectTimezone,
  detectDateFormat,
  formatShortDate,
  type DateFormat,
} from "@/lib/utils/format-date";
import { pushRegionalPrefs } from "@/lib/sync/settings";
import { LinkIdentitiesSection } from "@/components/auth/LinkIdentitiesSection";
import { PushOptIn } from "@/components/pwa/PushOptIn";
import { OfflineSection } from "@/components/settings/OfflineSection";
import { cn } from "@/lib/utils/cn";
import { cardPanelPadded, colStackLg, sectionLabel } from "@/lib/utils/class-names";
import { LABS_FLAGS, type LabsFlagKey } from "@/lib/labs/flags";

/**
 * Curated fallback list for browsers that don't support
 * `Intl.supportedValuesOf("timeZone")` (pre-2022 engines). Covers the most
 * common IANA zones across all inhabited UTC offsets.
 */
const FALLBACK_TIMEZONES: string[] = [
  "Pacific/Midway",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Caracas",
  "America/Halifax",
  "America/St_Johns",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Noronha",
  "Atlantic/Azores",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Helsinki",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Apia",
];

// Evaluated once at module load — list is stable, no point computing it
// on every render of the Settings page.
const TIMEZONE_OPTIONS: string[] =
  typeof Intl !== "undefined" && "supportedValuesOf" in Intl
    ? (Intl as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("timeZone")
    : FALLBACK_TIMEZONES;

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

/**
 * Developer-only row for clearing the earned-badges list (#420). A QA tool
 * — no confirmation dialog because the only way to render it is from inside
 * superuser mode. While any superuser flag is on, cloud sync is paused, so
 * the click only mutates localStorage; cloud state is untouched until the
 * user explicitly exits superuser mode.
 */
function ResetEarnedBadgesRow() {
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!cleared) return;
    const t = setTimeout(() => setCleared(false), 1500);
    return () => clearTimeout(t);
  }, [cleared]);

  function handleClear() {
    saveSettings({ ...loadSettings(), earnedBadges: [] });
    setCleared(true);
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            Reset earned badges
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Clears your gym-badge list so you can re-trigger the reveal
            toasts. Local-only while superuser is on.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="min-h-[36px] shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          aria-label="Reset earned badges"
        >
          {cleared ? "Cleared" : "Reset"}
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className={colStackLg} aria-busy="true" aria-label="Loading settings">
      <SkeletonBlock className="h-20 w-full" />
      <SkeletonBlock className="h-20 w-full" />
      <SkeletonBlock className="h-20 w-full" />
    </div>
  );
}

function FavouritePicker({
  settings,
  favouriteId,
  onSelect,
}: {
  settings: UserSettings;
  favouriteId: number | null;
  onSelect: (entry: CuratedPokemon | null, spriteUrl: string | null) => void;
}) {
  const { flags } = useSuperuser();
  // Loaded once at mount. Nothing on this page writes to the session so a
  // snapshot is safe and avoids re-reading on every render.
  const [cardStateById, setCardStateById] = useState<Map<number, ReviewState>>(new Map());
  useEffect(() => {
    async function load() {
      const session = await loadSession();
      setCardStateById(new Map((session?.cards ?? []).map((c) => [c.id, c.state])));
    }
    void load();
  }, []);

  const unlockedEntries = CURATED_POKEMON.filter((entry) => {
    const state = cardStateById.get(entry.id);
    return (
      flags.pretendAllMastered ||
      (state !== undefined && isMastered(state, settings.masteryRepetitions))
    );
  });

  if (unlockedEntries.length === 0) return null;

  return (
    <>
      <h3
        id="theme-heading"
        className="text-sm font-semibold text-foreground"
      >
        App Theme
      </h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Master a Pokémon to unlock it as an app colour theme.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {unlockedEntries.map((entry) => {
          const seed = SEED_POKEMON.find((p) => p.id === entry.id);
          const selected = favouriteId === entry.id;

          return (
            <div
              key={entry.id}
              className="relative rounded-xl border border-zinc-200 bg-background px-4 py-3 flex flex-col items-center gap-2 transition-colors dark:border-zinc-800"
            >
              <div
                className="h-2 w-full rounded-full mb-1"
                style={{ backgroundColor: entry.colors.primary }}
                aria-hidden="true"
              />
              {seed?.spriteUrl ? (
                <Image
                  src={seed.spriteUrl}
                  alt={entry.name}
                  width={64}
                  height={64}
                  className="h-16 w-16 object-contain"
                />
              ) : (
                <div className="h-16 w-16" />
              )}
              <p className="text-sm font-medium text-foreground text-center">
                {entry.name}
              </p>
              {selected ? (
                <div className="flex flex-col items-center gap-1 w-full">
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Selected ✓
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelect(null, null)}
                    className="w-full min-h-[36px] rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-400"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(entry, seed?.spriteUrl ?? null)}
                  className="w-full min-h-[36px] rounded-lg bg-foreground px-3 py-1 text-xs font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
                >
                  Set as theme
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}


type FieldConfig = {
  key: keyof UserSettings;
  label: string;
  helper: string;
  min: number;
  max: number;
};

type FieldGroup = {
  heading: string | null; // null = ungrouped (renders without a heading)
  fields: FieldConfig[];
};

const GROUPS: FieldGroup[] = [
  {
    heading: null,
    fields: [
      {
        key: "masteryRepetitions",
        label: "Mastery threshold",
        helper: "Cards with this many consecutive correct reviews count as mastered.",
        min: 1,
        max: 10,
      },
    ],
  },
];

const NAME_NUMERIC_FIELDS: FieldConfig[] = [
  {
    key: "maxNewPerDay",
    label: "New cards per day",
    helper: "Hard daily cap. Raising this grows tomorrow's review pile faster.",
    min: 1,
    max: 50,
  },
  {
    key: "maxReviewsPerDay",
    label: "Reviews per day",
    helper: "Soft cap; you can always override it during a session.",
    min: 1,
    max: 500,
  },
];

const EVOLUTION_NUMERIC_FIELDS: FieldConfig[] = [
  {
    key: "maxNewEvolutionPerDay",
    label: "New cards per day",
    helper: "Hard daily cap for evolution cards. Tracked separately from name cards.",
    min: 1,
    max: 50,
  },
  {
    key: "maxReviewsEvolutionPerDay",
    label: "Reviews per day",
    helper: "Soft cap for evolution reviews. Independent of the name-card review cap.",
    min: 1,
    max: 500,
  },
];

// Numeric fields only — used for clamping on save. Boolean fields are handled
// separately in handleSave via spread.
const ALL_NUMERIC_FIELDS: FieldConfig[] = [
  ...GROUPS.flatMap((g) => g.fields),
  ...NAME_NUMERIC_FIELDS,
  ...EVOLUTION_NUMERIC_FIELDS,
];

const REVERSE_NUMERIC_FIELDS: FieldConfig[] = [
  {
    key: "maxNewReversePerDay",
    label: "New cards per day",
    helper: "Hard daily cap for reverse cards. Tracked separately from name cards.",
    min: 1,
    max: 50,
  },
  {
    key: "maxReviewsReversePerDay",
    label: "Reviews per day",
    helper: "Soft cap for reverse reviews. Independent of the name-card review cap.",
    min: 1,
    max: 500,
  },
];

/** Human-readable names for the card-type settings keys — used in the re-enable dialog. */
const CARD_TYPE_DISPLAY_NAMES: Partial<Record<keyof UserSettings, string>> = {
  evolutionCardsEnabled: "evolution cards",
  reverseEvolutionCardsEnabled: "reverse-evolution cards",
  cryCardsEnabled: "cry cards",
};

/** All top-level section ids used on this page — drives hash deep-link detection. */
const TOP_LEVEL_SECTION_IDS = [
  "appearance-heading",
  "practice-heading",
  "audio-heading",
  "offline-heading",
  "account-data-heading",
  "labs-heading",
  "advanced-heading",
] as const;

/** All known anchor ids (top-level + sub-section) for deep-link resolution. */
const ALL_ANCHOR_IDS = [
  ...TOP_LEVEL_SECTION_IDS,
  "theme-heading",
  "mobile-nav-heading",
  "scheduler-heading",
  "known-quiz-heading",
  "name-cards-heading",
  "evolution-cards-heading",
  "reverse-evolution-heading",
  "alternate-forms-heading",
  "reverse-heading",
  "cry-heading",
  "offline-download-heading",
  "onboarding-heading",
  "backup-heading",
  "regional-heading",
  "about-heading",
  "labs-heading",
  "developer-heading",
  "danger-zone-heading",
] as const;

type AnchorId = typeof ALL_ANCHOR_IDS[number];
type TopLevelId = typeof TOP_LEVEL_SECTION_IDS[number];

/**
 * Map from a sub-section anchor to the top-level CollapsibleSection that
 * contains it. Used so navigating to e.g. #onboarding-heading also expands
 * the "Account & Data" category.
 */
const ANCHOR_TO_CATEGORY: Partial<Record<AnchorId, TopLevelId>> = {
  "theme-heading": "appearance-heading",
  "mobile-nav-heading": "appearance-heading",
  "scheduler-heading": "practice-heading",
  "known-quiz-heading": "practice-heading",
  "name-cards-heading": "practice-heading",
  "evolution-cards-heading": "practice-heading",
  "reverse-evolution-heading": "practice-heading",
  "alternate-forms-heading": "practice-heading",
  "reverse-heading": "practice-heading",
  "cry-heading": "audio-heading",
  "offline-download-heading": "offline-heading",
  "onboarding-heading": "account-data-heading",
  "backup-heading": "account-data-heading",
  "regional-heading": "account-data-heading",
  "about-heading": "account-data-heading",
  "developer-heading": "advanced-heading",
  "danger-zone-heading": "advanced-heading",
};

export default function SettingsPage() {
  const router = useRouter();
  const { user, supabase } = useAuth();
  const { updateFavourite } = useFavourite();
  const { unlocked, flags, setFlag, anyFlagOn } = useSuperuser();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [draftValues, setDraftValues] = useState<Partial<Record<keyof UserSettings, string>>>({});
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Re-enable dialog: set when toggling a card type from disabled → enabled.
  // Holds the settings key being re-enabled so the dialog knows what to label.
  const [reenableKey, setReenableKey] = useState<keyof UserSettings | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleErrorKey, setToggleErrorKey] = useState<keyof UserSettings | null>(null);
  const [favouriteId, setFavouriteId] = useState<number | null>(null);
  // One-time onboarding banner shown when verified typed entry is first enabled (#1271).
  const [typedEntryBannerVisible, setTypedEntryBannerVisible] = useState(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks whether auto-detection ran on this mount so the push effect below
  // only fires when prefs were freshly detected, not on every auth change.
  const autoDetectedPrefsRef = useRef<{ timezone: string; dateFormat: DateFormat } | null>(null);

  const [optimizableReviewCount, setOptimizableReviewCount] = useState<number>(0);

  // "Mark Pokémon I already know" quiz — collapsed by default so the long
  // sprite grid does not eat the Practice section.
  const [knownQuizOpen, setKnownQuizOpen] = useState<boolean>(false);

  // Settings search/filter query.
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Normalised (trimmed, lower-cased) version used for matching.
  const normalisedQuery = searchQuery.trim().toLowerCase();
  const isFiltering = normalisedQuery.length > 0;

  // Hash deep-link: the top-level CollapsibleSection id that should be
  // force-expanded on load, derived from window.location.hash.
  const [targetCategoryId, setTargetCategoryId] = useState<TopLevelId | null>(null);

  // Derive which top-level sections are visible under the current query.
  // When a hash deep-link target is active, always include its section so the
  // target is never filtered out by a coincident search query.
  const visibleSectionIds = new Set(
    SETTINGS_SEARCH_INDEX
      .filter((entry) => sectionMatchesQuery(entry, normalisedQuery))
      .map((entry) => entry.sectionId),
  );
  if (targetCategoryId !== null) {
    visibleSectionIds.add(targetCategoryId);
  }

  useEffect(() => {
    const loaded = loadSettings();

    // Auto-detect regional prefs on first load when not yet set.
    // These live in LOCAL settings (which syncs to the scalar columns on
    // user_settings via pushRegionalPrefs — NOT through merge_user_settings,
    // which would put them inside the JSONB blob and expose them to the LWW
    // race documented in the #517 audit).
    let needsSave = false;
    if (loaded.timezone === null) {
      loaded.timezone = detectTimezone();
      needsSave = true;
    }
    if (loaded.dateFormat === null) {
      loaded.dateFormat = detectDateFormat();
      needsSave = true;
    }
    if (needsSave) {
      saveSettings(loaded);
      autoDetectedPrefsRef.current = {
        timezone: loaded.timezone!,
        dateFormat: loaded.dateFormat!,
      };
    }

    setSettings(loaded);
    setFavouriteId(loadFavourite()?.id ?? null);
    // Count optimizable reviews from local grade log (async now — IDB backed)
    void loadGradeLog().then((log) => setOptimizableReviewCount(countOptimizableReviews(log)));

    // Resolve hash deep-link → find the top-level category to force-expand.
    const hash = window.location.hash.replace("#", "") as AnchorId;
    if ((ALL_ANCHOR_IDS as ReadonlyArray<string>).includes(hash)) {
      // Sub-section anchor → use the map. Top-level anchor → use it directly.
      const fromMap = ANCHOR_TO_CATEGORY[hash];
      const isTopLevel = (TOP_LEVEL_SECTION_IDS as ReadonlyArray<string>).includes(hash);
      const category: TopLevelId | null = fromMap ?? (isTopLevel ? (hash as TopLevelId) : null);
      setTargetCategoryId(category);
    }

    return () => {
      if (savedTimeoutRef.current !== null) clearTimeout(savedTimeoutRef.current);
      if (toggleErrorTimeoutRef.current !== null) clearTimeout(toggleErrorTimeoutRef.current);
    };
  }, []);

  // Best-effort push of auto-detected regional prefs once auth is available.
  // Runs when user/supabase resolve (async after mount) so the push is not
  // silently skipped when useAuth hasn't resolved yet at mount time.
  // Only fires if auto-detection ran on this mount (ref guard).
  useEffect(() => {
    if (!user || !supabase || !autoDetectedPrefsRef.current) return;
    const prefs = autoDetectedPrefsRef.current;
    autoDetectedPrefsRef.current = null;
    void pushRegionalPrefs(supabase, user.id, {
      timezone: prefs.timezone,
      dateFormat: prefs.dateFormat,
    }).catch(() => {});
  }, [user, supabase]);

  function handleChange(key: keyof UserSettings, raw: string) {
    setDraftValues((prev) => ({ ...prev, [key]: raw }));
  }

  function handleBlur(key: keyof UserSettings, min: number) {
    if (settings === null) return;
    const raw = draftValues[key];
    if (raw === undefined) return;
    const parsed = parseInt(raw, 10);
    const value = isNaN(parsed) ? (settings[key] as number) : Math.max(min, parsed);
    setSettings({ ...settings, [key]: value });
    setDraftValues((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  function handleToggle(key: keyof UserSettings) {
    if (settings === null) return;

    // Card-type toggles: re-enable prompts and non-destructive disable.
    //
    // Disabling is now non-destructive — saved progress is preserved in
    // storage. When re-enabling, we show a prompt so the user can choose
    // between resuming saved progress (the default) or starting fresh.
    //
    // Name and reverse are always on since #1234 — they are not in this list.
    const cardTypeKeys = [
      "evolutionCardsEnabled",
      "reverseEvolutionCardsEnabled",
      "cryCardsEnabled",
    ] as const;
    if ((cardTypeKeys as readonly string[]).includes(key)) {
      if (!settings[key]) {
        // Toggling from disabled → enabled: show the reuse-or-reset prompt.
        setReenableKey(key);
        return;
      }
      // Toggling from enabled → disabled: non-destructive, no confirm needed.
    }

    setToggleError(null);
    setToggleErrorKey(null);

    // First-enable onboarding for verified typed entry (#1271): when the user
    // flips verifiedTypedEntryMode on for the first time ever, show a one-time
    // banner explaining the MC ramp. The flag is persisted so the banner never
    // re-fires after dismiss.
    if (
      key === "verifiedTypedEntryMode" &&
      !settings.verifiedTypedEntryMode &&
      !settings.typedEntryOnboardingShown
    ) {
      const updated = {
        ...settings,
        verifiedTypedEntryMode: !settings.verifiedTypedEntryMode,
        typedEntryOnboardingShown: true,
      };
      setSettings(updated);
      setTypedEntryBannerVisible(true);
      saveSettings(updated);
      return;
    }

    setSettings({ ...settings, [key]: !settings[key] });
  }

  /**
   * Called when the user picks a choice in the re-enable dialog.
   * "reuse" — enable the type; saved progress is preserved as-is.
   * "fresh" — enable the type and reset all cards of that type to initialReviewState.
   */
  async function handleReenableChoice(choice: ReenableChoice) {
    if (settings === null || reenableKey === null) return;
    setReenableKey(null);
    setToggleError(null);
    setToggleErrorKey(null);

    // Enable the card type in settings state immediately.
    setSettings({ ...settings, [reenableKey]: true });

    if (choice === "fresh") {
      // Reset cards of the re-enabled type to initial state in IDB.
      const cardTypeForKey: Record<string, string> = {
        evolutionCardsEnabled: "evolution",
        reverseEvolutionCardsEnabled: "reverse-evolution",
        cryCardsEnabled: "cry",
      };
      const targetType = cardTypeForKey[reenableKey];
      if (targetType !== undefined) {
        const session = await loadSession();
        if (session !== null) {
          const now = new Date();
          const reset = session.cards.map((card) =>
            card.cardType === targetType
              ? { ...card, state: initialReviewState(now) }
              : card,
          );
          await saveSession({ ...session, cards: reset });
        }
      }
    }
  }


  async function handleReset() {
    if (anyFlagOn) return;
    if (user && supabase) {
      const result = await resetAllProgressEverywhere(supabase);
      if (!result.ok) throw new Error("Could not delete cloud data. Check your connection and try again.");
    } else {
      // Guest: no cloud to wipe — the orchestrator's local clear is invoked
      // directly here. The two paths must not converge into one orchestrator
      // call: passing a null client would force the orchestrator to skip the
      // cloud step (silently OK for guests, but a future signed-out-but-stale
      // user could miss a cloud wipe). Keeping the call sites split makes
      // the "are we authenticated?" decision explicit.
      await clearLocalProgress();
    }
    saveFavourite(null);
    setFavouriteId(null);
    updateFavourite(null);
    router.replace("/");
  }

  /**
   * Full account erasure: wipe the cloud identity (and all cascaded data) via
   * the delete_account RPC, clear ALL local poke-memory keys — including the
   * settings keys a normal reset spares — then sign out.
   *
   * This is gated on a signed-in session; the button is only rendered for
   * `user`. The superuser write-guard (anyFlagOn) disables the button at the
   * call site, mirroring the reset-progress control and FsrsOptimizerSection.
   */
  async function handleDeleteAccount() {
    if (anyFlagOn) return;
    if (!user || !supabase) return;
    const result = await deleteAccountEverywhere(supabase);
    if (!result.ok) {
      throw new Error(
        "Could not delete your account. Check your connection and try again.",
      );
    }
    // Note: do NOT call saveFavourite(null) here — deleteAccountEverywhere
    // has already wiped every poke-memory:* localStorage key. saveFavourite
    // would re-create the settings key (leaving stale settings the deletion
    // was meant to erase) and dispatch SETTINGS_SAVED_EVENT, triggering a
    // doomed pushSettings against the just-deleted account. Only reset the
    // in-memory React state below.
    setFavouriteId(null);
    updateFavourite(null);
    // Deliberate departure from normal sign-out, which preserves local data:
    // the account is gone, so signing out here leaves nothing behind. signOut
    // redirects to "/".
    await signOut();
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-selected
    if (!file) return;
    const result = await validateBackup(file);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    const confirmed = window.confirm(
      "Replace your current progress with this backup?"
    );
    if (confirmed) {
      await applyBackup(result.data);
      window.location.reload();
    }
  }

  function handleSave() {
    if (settings === null) return;
    // Flush any in-progress drafts (blur may not fire before a Save click).
    const allNumericFields = [...ALL_NUMERIC_FIELDS, ...REVERSE_NUMERIC_FIELDS];
    const withDrafts = { ...settings } as Record<string, unknown>;
    for (const { key, min } of allNumericFields) {
      const raw = draftValues[key];
      if (raw !== undefined) {
        const parsed = parseInt(raw, 10);
        withDrafts[key] = isNaN(parsed) ? settings[key] : Math.max(min, parsed);
      }
    }
    setDraftValues({});
    const numericClamped = Object.fromEntries(
      allNumericFields.map(({ key, min, max }) => [
        key,
        Math.max(min, Math.min(max, withDrafts[key] as number)),
      ])
    );
    const clamped = {
      ...withDrafts,
      ...numericClamped,
    } as UserSettings;
    saveSettings(clamped);
    // Disabling a card type is non-destructive: saved cards are kept in
    // storage so progress is available when the type is re-enabled. The
    // session queue builder filters them out of the active queue via the
    // eligibleCardIds gate; we no longer strip them from IDB on save.
    setSettings(clamped);
    setSaved(true);
    if (savedTimeoutRef.current !== null) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => {
      savedTimeoutRef.current = null;
      setSaved(false);
    }, 2000);
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl">
        <h1 className="mb-8 text-2xl font-bold tracking-tight text-foreground">
          Settings
        </h1>

        {settings === null ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* ── Search ──────────────────────────────────────────────────── */}
            <div className="mb-4">
              <SettingsSearch
                value={searchQuery}
                onChange={setSearchQuery}
                matchCount={visibleSectionIds.size}
              />
              {isFiltering && visibleSectionIds.size === 0 && (
                <p
                  role="status"
                  className="mt-4 text-sm text-zinc-500 dark:text-zinc-400"
                  aria-live="polite"
                >
                  No settings match &ldquo;{searchQuery}&rdquo;.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">

              {/* ── Appearance ─────────────────────────────────────────────── */}
              {visibleSectionIds.has("appearance-heading") && (
              <CollapsibleSection
                sectionId="appearance-heading"
                heading="Appearance"
                forceOpen={targetCategoryId === "appearance-heading"}
                transientOpen={isFiltering}
              >
                {/* App Theme (mascot picker) — only shown when unlocked entries exist */}
                <div>
                  <FavouritePicker
                    settings={settings}
                    favouriteId={favouriteId}
                    onSelect={(entry, spriteUrl) => {
                      saveFavourite(entry, spriteUrl);
                      setFavouriteId(entry?.id ?? null);
                      updateFavourite(
                        entry
                          ? { id: entry.id, name: entry.name, colors: entry.colors, spriteUrl: spriteUrl ?? null }
                          : null
                      );
                    }}
                  />
                </div>

                <IntensityPicker
                  value={settings.themeIntensity}
                  onChange={(next) => {
                    const updated = { ...settings, themeIntensity: next };
                    setSettings(updated);
                    saveSettings(updated);
                  }}
                />

                {/* Mobile navigation style (#661) — bottom tab bar vs hamburger */}
                <div id="mobile-nav-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Mobile navigation
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Bottom tab bar
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Show a fixed tab bar at the bottom of the screen on mobile. Turn off to use the classic hamburger menu instead. Has no effect on wide screens.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Bottom tab bar"
                        aria-checked={settings.mobileNav === "bottom"}
                        onClick={() => {
                          const next = settings.mobileNav === "bottom" ? "hamburger" as const : "bottom" as const;
                          const updated: UserSettings = { ...settings, mobileNav: next };
                          setSettings(updated);
                          saveSettings(updated);
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                          settings.mobileNav === "bottom"
                            ? "bg-foreground"
                            : "bg-zinc-300 dark:bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            settings.mobileNav === "bottom" ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
              )}

              {/* ── Practice ───────────────────────────────────────────────── */}
              {visibleSectionIds.has("practice-heading") && (
              <CollapsibleSection
                sectionId="practice-heading"
                heading="Practice"
                forceOpen={targetCategoryId === "practice-heading"}
                transientOpen={isFiltering}
              >
                {/* Scheduler knobs */}
                <div id="scheduler-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Scheduler
                  </p>
                  <OnboardingHint id="settingsHintDismissed" title="What recall target does">
                    <p>
                      The scheduler aims to show each card just before
                      you&apos;d forget it. A higher recall target means more
                      reviews and stronger retention; a lower target means
                      fewer reviews and a bit more forgetting. Most people
                      leave this at 90%.
                    </p>
                  </OnboardingHint>
                  {/* Mastery threshold */}
                  {GROUPS.flatMap((g) =>
                    g.fields.map(({ key, label, helper, min, max }) => (
                      <div
                        key={key}
                        className={cardPanelPadded}
                      >
                        <label
                          htmlFor={key}
                          className="block text-sm font-medium text-foreground"
                        >
                          {label}
                        </label>
                        <input
                          id={key}
                          type="number"
                          min={min}
                          max={max}
                          step={1}
                          value={draftValues[key] ?? String(settings[key])}
                          onChange={(e) => handleChange(key, e.target.value)}
                          onBlur={() => handleBlur(key, min)}
                          className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                        />
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {helper}
                        </p>
                      </div>
                    ))
                  )}
                  {/* Recall target slider */}
                  <div className={cardPanelPadded}>
                    <label
                      htmlFor="retentionTarget"
                      className="block text-sm font-medium text-foreground"
                    >
                      Recall target ({Math.round(settings.retentionTarget * 100)}%)
                    </label>
                    <input
                      id="retentionTarget"
                      type="range"
                      min={Math.round(RETENTION_TARGET_MIN * 100)}
                      max={Math.round(RETENTION_TARGET_MAX * 100)}
                      step={1}
                      value={Math.round(settings.retentionTarget * 100)}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          retentionTarget: Number(e.target.value) / 100,
                        })
                      }
                      className="mt-3 w-full"
                      aria-describedby="retentionTarget-helper"
                    />
                    <p
                      id="retentionTarget-helper"
                      className="mt-2 text-xs text-zinc-500 dark:text-zinc-400"
                    >
                      Lower means fewer reviews but you&apos;ll forget more cards. Higher means more reviews but better retention. Default 90%.
                    </p>
                  </div>
                </div>

                {/* FSRS per-user weight optimizer (#268) */}
                <FsrsOptimizerSection
                  fsrsWeightsOptimizedAt={settings.fsrsWeightsOptimizedAt}
                  optimizableReviewCount={optimizableReviewCount}
                  isSignedIn={user !== null}
                  superuserPaused={anyFlagOn}
                  onOptimized={(optimizedAt, weights) => {
                    setSettings((prev) =>
                      prev !== null
                        ? { ...prev, fsrsWeights: weights, fsrsWeightsOptimizedAt: optimizedAt }
                        : prev,
                    );
                  }}
                />

                {/* "Mark Pokémon I already know" quiz (#1084).

                    Lets the user fast-track Pokémon they already know without
                    grinding through the new-card queue. Each selection runs
                    the brand-new card through the simulated-Easy FSRS path —
                    real graduated state, not synthesised mastery. */}
                <div id="known-quiz-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Quickstart
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Mark Pokémon I already know
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Tap the Pokémon you already recognise. Each one
                          graduates straight into the scheduler with a long
                          first interval, so you can skip the new-card queue
                          for species you know cold.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setKnownQuizOpen((open) => !open)}
                        aria-expanded={knownQuizOpen}
                        aria-controls="known-quiz-panel"
                        className="min-h-[36px] shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        {knownQuizOpen ? "Close" : "Open quiz"}
                      </button>
                    </div>
                    {knownQuizOpen && (
                      <div id="known-quiz-panel" className="mt-4">
                        <KnownPokemonQuiz
                          client={supabase}
                          userId={user?.id ?? null}
                          superuserPaused={anyFlagOn}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Name cards — always on since #1234 */}
                <div id="name-cards-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Name cards
                  </p>
                  <div className={colStackLg}>
                    {NAME_NUMERIC_FIELDS.map(({ key, label, helper, min, max }) => (
                      <div
                        key={key}
                        className={cardPanelPadded}
                      >
                        <label
                          htmlFor={key}
                          className="block text-sm font-medium text-foreground"
                        >
                          {label}
                        </label>
                        <input
                          id={key}
                          type="number"
                          min={min}
                          max={max}
                          step={1}
                          value={draftValues[key] ?? String(settings[key])}
                          onChange={(e) => handleChange(key, e.target.value)}
                          onBlur={() => handleBlur(key, min)}
                          className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                        />
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {helper}
                        </p>
                      </div>
                    ))}
                    {/* Verified typed entry (#1251) */}
                    <div className={cardPanelPadded}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Verified typed entry for name cards
                          </p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Type the name instead of grading yourself. Grades are decided automatically based on how close your answer is.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={settings.verifiedTypedEntryMode}
                          aria-label="Verified typed entry for name cards"
                          onClick={() => handleToggle("verifiedTypedEntryMode")}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                            settings.verifiedTypedEntryMode
                              ? "bg-foreground"
                              : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              settings.verifiedTypedEntryMode ? "translate-x-5" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                      {/* Always-visible inline help explaining the MC ramp (#1271) */}
                      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        New cards start as multiple choice during the learning phase. Once a card has been reviewed enough times to graduate, it switches to verified typed entry.
                      </p>
                      {/* One-time first-enable banner (#1271). Dismissed by the user; never re-fires. */}
                      {typedEntryBannerVisible && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="mt-3 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
                        >
                          <p className="flex-1">
                            Verified typed entry is on. New cards will show multiple choice for the first few reviews. Once a card graduates into long-term review, you will be asked to type the name.
                          </p>
                          <button
                            type="button"
                            aria-label="Dismiss typed entry notice"
                            onClick={() => setTypedEntryBannerVisible(false)}
                            className="shrink-0 text-blue-600 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-blue-400 dark:hover:text-blue-200"
                          >
                            <span aria-hidden="true">&#x2715;</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Evolution cards */}
                <div id="evolution-cards-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Evolution cards
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Enable evolution cards
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Show sprite; identify the evolution chain. Disabling hides these cards without losing your progress.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settings.evolutionCardsEnabled}
                        onClick={() => handleToggle("evolutionCardsEnabled")}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                          settings.evolutionCardsEnabled
                            ? "bg-foreground"
                            : "bg-zinc-300 dark:bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            settings.evolutionCardsEnabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  {toggleError !== null && toggleErrorKey === "evolutionCardsEnabled" && (
                    <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
                      {toggleError}
                    </p>
                  )}
                  <div className={settings.evolutionCardsEnabled ? undefined : "opacity-50"}>
                    <div className={colStackLg}>
                      {EVOLUTION_NUMERIC_FIELDS.map(({ key, label, helper, min, max }) => (
                        <div
                          key={key}
                          className={cardPanelPadded}
                        >
                          <label
                            htmlFor={key}
                            className="block text-sm font-medium text-foreground"
                          >
                            {label}
                          </label>
                          <input
                            id={key}
                            type="number"
                            min={min}
                            max={max}
                            step={1}
                            value={draftValues[key] ?? String(settings[key])}
                            onChange={(e) => handleChange(key, e.target.value)}
                            onBlur={() => handleBlur(key, min)}
                            disabled={!settings.evolutionCardsEnabled}
                            className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                          />
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {helper}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Reverse-evolution cards */}
                <div id="reverse-evolution-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Reverse-evolution cards
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Enable reverse-evolution cards
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Quiz the opposite direction of evolution edges (&quot;Which Pokémon evolves into X via Y?&quot;).
                          Shares the same daily new/review budget as forward evolution cards.
                          Disabling hides these cards without losing your progress.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settings.reverseEvolutionCardsEnabled}
                        onClick={() => handleToggle("reverseEvolutionCardsEnabled")}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                          settings.reverseEvolutionCardsEnabled
                            ? "bg-foreground"
                            : "bg-zinc-300 dark:bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            settings.reverseEvolutionCardsEnabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Alternate forms (#658) */}
                <div id="alternate-forms-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Alternate forms
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Include alternate forms in practice
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Regional forms, Megas and other variants. Off by default: the base Pokédex is already a large deck.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Include alternate forms in practice"
                        aria-checked={settings.alternateFormsEnabled}
                        onClick={() => handleToggle("alternateFormsEnabled")}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                          settings.alternateFormsEnabled
                            ? "bg-foreground"
                            : "bg-zinc-300 dark:bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            settings.alternateFormsEnabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Reverse cards — always on since #1234 */}
                <div id="reverse-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Reverse cards
                  </p>
                  {REVERSE_NUMERIC_FIELDS.map(({ key, label, helper, min, max }) => (
                    <div
                      key={key}
                      className={cardPanelPadded}
                    >
                      <label
                        htmlFor={key}
                        className="block text-sm font-medium text-foreground"
                      >
                        {label}
                      </label>
                      <input
                        id={key}
                        type="number"
                        min={min}
                        max={max}
                        step={1}
                        value={draftValues[key] ?? String(settings[key])}
                        onChange={(e) => handleChange(key, e.target.value)}
                        onBlur={() => handleBlur(key, min)}
                        className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                      />
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {helper}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Save */}
                <div className="flex items-center gap-4 pt-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    className="min-h-[44px] rounded-lg bg-foreground px-8 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
                  >
                    Save
                  </button>
                  {saved && (
                    <p
                      className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
                      aria-live="polite"
                    >
                      Saved!
                    </p>
                  )}
                </div>
              </CollapsibleSection>
              )}

              {/* ── Audio ──────────────────────────────────────────────────── */}
              {visibleSectionIds.has("audio-heading") && (
              <CollapsibleSection
                sectionId="audio-heading"
                heading="Audio"
                forceOpen={targetCategoryId === "audio-heading"}
                transientOpen={isFiltering}
              >
                {/* Cry cards */}
                <div id="cry-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Cry → name cards
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Enable cry cards
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Audio prompt: hear the cry and name the Pokémon. Species without a cry are skipped automatically.
                          Disabling hides these cards without losing your progress.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Enable cry cards"
                        aria-checked={settings.cryCardsEnabled}
                        onClick={() => handleToggle("cryCardsEnabled")}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                          settings.cryCardsEnabled
                            ? "bg-foreground"
                            : "bg-zinc-300 dark:bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            settings.cryCardsEnabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Audio playback */}
                <div className={cardPanelPadded}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Play cry on reveal
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Plays the Pokémon&apos;s cry once when you reveal a name or evolution card, and when you answer a reverse (sprite-picker) card.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.playCryOnReveal}
                      onClick={() => handleToggle("playCryOnReveal")}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                        settings.playCryOnReveal
                          ? "bg-foreground"
                          : "bg-zinc-300 dark:bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                          settings.playCryOnReveal ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                <div className={cardPanelPadded}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Speak name on reveal
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Reads the Pokémon&apos;s name aloud using your device&apos;s text-to-speech engine when you reveal a card. British English voice preferred.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Speak name on reveal"
                      aria-checked={settings.speakNameOnReveal}
                      onClick={() => handleToggle("speakNameOnReveal")}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                        settings.speakNameOnReveal
                          ? "bg-foreground"
                          : "bg-zinc-300 dark:bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                          settings.speakNameOnReveal ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                {settings.speakNameOnReveal && (
                  <TtsControls
                    ttsVoice={settings.ttsVoice}
                    ttsRate={settings.ttsRate}
                    ttsVolume={settings.ttsVolume}
                    onChange={(patch) => setSettings({ ...settings, ...patch })}
                  />
                )}
                <VoiceQualityHint />
                {/* Audio-wait setting: only useful when cry or TTS is on */}
                {(settings.playCryOnReveal || settings.speakNameOnReveal) && (
                <div className={cardPanelPadded}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Wait for audio before next card
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        When on (default), the next card waits until the cry and spoken name finish before appearing. Turn off for a faster swap: audio continues playing under the next card and is not cut off.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Wait for audio before next card"
                      aria-checked={settings.waitForAudioOnGrade}
                      onClick={() => handleToggle("waitForAudioOnGrade")}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                        settings.waitForAudioOnGrade
                          ? "bg-foreground"
                          : "bg-zinc-300 dark:bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                          settings.waitForAudioOnGrade ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                )}

                {/* Reverse-card feedback delay (#1200) — always shown since reverse is always on (#1234) */}
                <div className={cardPanelPadded}>
                  <p className="text-sm font-medium text-foreground">
                    Reverse card feedback delay
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    How long the sprite picker lingers on the correct or incorrect highlight before advancing to the next card.
                    Off: no pause. Fast: 250 ms correct / 500 ms incorrect. Default: 600 ms / 1200 ms.
                  </p>
                  <fieldset className="mt-3 flex gap-2">
                    <legend className="sr-only">Reverse card feedback delay</legend>
                    {(
                      [
                        { value: "off", label: "Off" },
                        { value: "fast", label: "Fast" },
                        { value: "default", label: "Default" },
                      ] as const
                    ).map(({ value, label }) => (
                      <label
                        key={value}
                        className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-foreground focus-within:ring-offset-2 ${
                          settings.reverseFeedbackDelay === value
                            ? "border-foreground bg-foreground text-background"
                            : "border-zinc-300 bg-background text-foreground hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                        }`}
                      >
                        <input
                          type="radio"
                          name="reverseFeedbackDelay"
                          value={value}
                          checked={settings.reverseFeedbackDelay === value}
                          onChange={() => {
                            const updated = { ...settings, reverseFeedbackDelay: value };
                            setSettings(updated);
                            saveSettings(updated);
                          }}
                          className="sr-only"
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                </div>
              </CollapsibleSection>
              )}

              {/* ── Offline ────────────────────────────────────────────────── */}
              {visibleSectionIds.has("offline-heading") && (
              <CollapsibleSection
                sectionId="offline-heading"
                heading="Offline"
                forceOpen={targetCategoryId === "offline-heading"}
                transientOpen={isFiltering}
              >
                <div id="offline-download-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Download
                  </p>
                  <OfflineSection />
                </div>
              </CollapsibleSection>
              )}

              {/* ── Account & Data ─────────────────────────────────────────── */}
              {visibleSectionIds.has("account-data-heading") && (
              <CollapsibleSection
                sectionId="account-data-heading"
                heading="Account & Data"
                forceOpen={targetCategoryId === "account-data-heading"}
                transientOpen={isFiltering}
              >
                {/* Sign-in methods — only shown for signed-in users */}
                {user && supabase && (
                  <LinkIdentitiesSection user={user} supabase={supabase} />
                )}

                {/* Daily review reminder (Web Push, #1056). The component
                    handles its own visibility — it renders nothing outside
                    an installed PWA or when push is unsupported, so the
                    parent does not need to gate further. */}
                {user && supabase && (
                  <PushOptIn user={user} supabase={supabase} />
                )}

                {/* Onboarding explainer */}
                <div id="onboarding-heading" className={cn("flex flex-col gap-3", cardPanelPadded)}>
                  <p className={sectionLabel}>
                    How this works
                  </p>
                  <p className="text-sm text-foreground">
                    Poké Memory uses{" "}
                    <a
                      href="https://github.com/open-spaced-repetition/ts-fsrs"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-2"
                    >
                      FSRS
                    </a>
                    , a spaced-repetition scheduler that picks the best time
                    to show each card based on how well you remember it.
                  </p>
                  <p className="text-sm text-foreground">
                    After every grade the scheduler updates its model of how
                    strong your memory of that card is, and sets the next
                    review for when you&apos;re most likely to be about to
                    forget it. Forgetting and then re-remembering is what
                    actually moves a card into long-term memory, so getting
                    a few <em>Again</em>s is normal and part of the system
                    working.
                  </p>
                  <p className="text-sm text-foreground">
                    Honest grading matters more than getting every card
                    right. If you almost forgot, press <em>Hard</em>. If you
                    truly forgot, press <em>Again</em>. The scheduler
                    can&apos;t help you if you mark cards <em>Easy</em> when
                    you only just scraped it.
                  </p>
                  <hr className="border-zinc-200 dark:border-zinc-800" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Show onboarding again
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Re-opens the welcome guide on the Practice page and
                      restores contextual hints on Stats and Settings.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        // DEFAULT_ONBOARDING resets all flags including
                        // firstVisitOnboardingDismissed (#1103) and
                        // installNudgeDismissed (#701).
                        const next = { ...settings, onboarding: { ...DEFAULT_ONBOARDING } };
                        setSettings(next);
                        saveSettings(next);
                      }}
                      className="mt-3 min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      Show onboarding again
                    </button>
                  </div>
                </div>

                {/* Backup */}
                <div id="backup-heading" className={cn(cardPanelPadded, "flex flex-col gap-3")}>
                  <p className={sectionLabel}>
                    Backup
                  </p>
                  <div>
                    <p className="text-sm font-medium text-foreground">Export progress</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Downloads a JSON backup of all your card progress and settings.
                    </p>
                    <button
                      type="button"
                      onClick={() => void exportProgress()}
                      className="mt-3 min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      Export
                    </button>
                  </div>

                  {/* Review history CSV export — authenticated users only (#918) */}
                  {user && (
                    <>
                      <hr className="border-zinc-200 dark:border-zinc-800" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Download review history</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Downloads your full review history as a CSV file (date, Pokémon, card type, grade). Useful for personal analysis and satisfies GDPR data portability.
                        </p>
                        <a
                          href="/api/export"
                          download
                          className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                        >
                          Download CSV
                        </a>
                      </div>
                    </>
                  )}

                  <hr className="border-zinc-200 dark:border-zinc-800" />

                  <div>
                    <p className="text-sm font-medium text-foreground">Import progress</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Restore from a previously exported backup. Replaces current progress after confirmation.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      className="sr-only"
                      tabIndex={-1}
                      onChange={handleImport}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-3 min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      Import
                    </button>
                    {importError !== null && (
                      <p
                        role="alert"
                        className="mt-2 text-xs font-medium text-red-600 dark:text-red-400"
                      >
                        {importError}
                      </p>
                    )}
                  </div>
                </div>

                {/* Regional */}
                <div id="regional-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    Regional
                  </p>

                  {/* Timezone picker */}
                  <div className={cardPanelPadded}>
                    <label
                      htmlFor="timezone"
                      className="block text-sm font-medium text-foreground"
                    >
                      Timezone
                    </label>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Used for daily review limits and streak roll-overs. Auto-detected on first load.
                    </p>
                    <select
                      id="timezone"
                      value={settings.timezone ?? ""}
                      onChange={(e) => {
                        const next = { ...settings, timezone: e.target.value };
                        setSettings(next);
                        saveSettings(next);
                        if (user && supabase) {
                          void pushRegionalPrefs(supabase, user.id, {
                            timezone: e.target.value,
                            dateFormat: next.dateFormat,
                          }).catch(() => {});
                        }
                      }}
                      className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Date format picker */}
                  <div className={cardPanelPadded}>
                    <p className="text-sm font-medium text-foreground">
                      Date format
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Controls how dates are shown throughout the app. Live preview updates below.
                    </p>
                    <fieldset className="mt-3 flex flex-col gap-2">
                      <legend className="sr-only">Date format</legend>
                      {(() => {
                        // Hoist outside the per-option map so it is computed once.
                        const todayIso = new Date().toISOString().slice(0, 10);
                        return (
                          [
                            { value: "dmy" as DateFormat, label: "Day / Month / Year" },
                            { value: "mdy" as DateFormat, label: "Month / Day / Year" },
                            { value: "iso" as DateFormat, label: "ISO (Year-Month-Day)" },
                          ] as const
                        ).map(({ value, label }) => (
                          <label
                            key={value}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700"
                          >
                            <input
                              type="radio"
                              name="dateFormat"
                              value={value}
                              checked={(settings.dateFormat ?? "dmy") === value}
                              onChange={() => {
                                const next = { ...settings, dateFormat: value };
                                setSettings(next);
                                saveSettings(next);
                                if (user && supabase) {
                                  void pushRegionalPrefs(supabase, user.id, {
                                    timezone: next.timezone,
                                    dateFormat: value,
                                  }).catch(() => {});
                                }
                              }}
                              className="shrink-0 accent-foreground"
                            />
                            <span className="flex-1 text-foreground">{label}</span>
                            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                              {formatShortDate(todayIso, value)}
                            </span>
                          </label>
                        ));
                      })()}
                    </fieldset>
                  </div>
                </div>

                {/* About */}
                <div id="about-heading" className={cn(cardPanelPadded, "flex flex-col gap-3")}>
                  <p className={sectionLabel}>
                    About
                  </p>
                  <div>
                    <p className="text-sm font-medium text-foreground">Version</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {process.env.NEXT_PUBLIC_APP_VERSION
                        ? `v${process.env.NEXT_PUBLIC_APP_VERSION}`
                        : "dev"}
                    </p>
                  </div>

                  <hr className="border-zinc-200 dark:border-zinc-800" />

                  <div>
                    <p className="text-sm font-medium text-foreground">What&apos;s new</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      See what shipped in recent releases.
                    </p>
                    <Link
                      href="/whats-new"
                      className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      View changelog
                    </Link>
                  </div>

                  <hr className="border-zinc-200 dark:border-zinc-800" />

                  <div className="flex flex-wrap gap-3">
                    <Link
                      href="/privacy"
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      Privacy
                    </Link>
                    <Link
                      href="/terms"
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      Terms
                    </Link>
                  </div>

                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    Unofficial fan project, not affiliated with or endorsed by Nintendo,
                    Game Freak, or The Pok&eacute;mon Company. Pok&eacute;mon and all
                    related names, sprites, and cries are the property of their respective
                    owners. Sprite and species data sourced from{" "}
                    <a
                      href="https://pokeapi.co"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
                    >
                      Pok&eacute;API
                    </a>
                    .
                  </p>
                </div>
              </CollapsibleSection>
              )}

              {/* ── Labs ───────────────────────────────────────────────────── */}
              {/* The Labs section only renders when there is at least one registered flag. */}
              {visibleSectionIds.has("labs-heading") && Object.keys(LABS_FLAGS).length > 0 && (
              <CollapsibleSection
                sectionId="labs-heading"
                heading="Labs"
                forceOpen={targetCategoryId === "labs-heading"}
                transientOpen={isFiltering}
              >
                <div id="labs-heading" className={colStackLg}>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Preview features that are in active development. These may
                    change or be removed. Your feedback helps shape what ships.
                  </p>
                  {(Object.entries(LABS_FLAGS) as [LabsFlagKey, { label: string; description: string; default: boolean }][]).map(
                    ([key, meta]) => (
                      <div key={key} className={cardPanelPadded}>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {meta.label}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              {meta.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-label={meta.label}
                            aria-checked={settings.labsFlags[key] ?? false}
                            onClick={() => {
                              const updated = {
                                ...settings,
                                labsFlags: {
                                  ...settings.labsFlags,
                                  [key]: !(settings.labsFlags[key] ?? false),
                                },
                              };
                              setSettings(updated);
                              saveSettings(updated);
                            }}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                              settings.labsFlags[key] ?? false
                                ? "bg-foreground"
                                : "bg-zinc-300 dark:bg-zinc-600"
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                                settings.labsFlags[key] ?? false
                                  ? "translate-x-5"
                                  : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </CollapsibleSection>
              )}

              {/* ── Advanced ───────────────────────────────────────────────── */}
              {visibleSectionIds.has("advanced-heading") && (
              <CollapsibleSection
                sectionId="advanced-heading"
                heading="Advanced"
                forceOpen={targetCategoryId === "advanced-heading"}
                transientOpen={isFiltering}
              >
                {/* Developer section — superuser gated */}
                {unlocked && (
                  <div
                    id="developer-heading"
                    role="region"
                    aria-labelledby="developer-section-label"
                    className="rounded-xl border border-amber-300 p-5 dark:border-amber-700"
                  >
                    <p
                      id="developer-section-label"
                      className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400"
                    >
                      Developer
                    </p>
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      QA shortcuts. While any flag here is on, sync to the cloud is
                      paused so QA state can&apos;t leak into your real data.
                      Turning off the last flag (or locking superuser mode) restores
                      cloud state for signed-in users, or offers to reset local
                      state for guests.
                    </p>
                    <div className={cn("mt-4", cardPanelPadded)}>
                      <a
                        href="/audit-themes"
                        className="block text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        Theme audit →
                      </a>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Side-by-side preview of every mascot × intensity × colour
                        scheme. Use when tweaking <code className="font-mono">globals.css</code> to spot
                        combos where the grade buttons blend into the surface.
                      </p>
                    </div>

                    <div className={cn("mt-4", cardPanelPadded)}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Pretend all Pokémon are mastered
                          </p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Renders every species as mastered across the Pokédex,
                            detail pages, Pasture, Stats, and the theme picker.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label="Pretend all Pokémon are mastered"
                          aria-checked={flags.pretendAllMastered}
                          onClick={() =>
                            void setFlag("pretendAllMastered", !flags.pretendAllMastered)
                          }
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                            flags.pretendAllMastered
                              ? "bg-foreground"
                              : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              flags.pretendAllMastered ? "translate-x-5" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className={cn("mt-4", cardPanelPadded)}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Force next streak milestone
                          </p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Fires the smallest un-seen streak celebration on the
                            next visit to Practice, regardless of the real streak.
                            Self-clears after one fire. Locking superuser overwrites
                            local progress with cloud state for signed-in users.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label="Force next streak milestone"
                          aria-checked={flags.forceNextStreakMilestone}
                          onClick={() =>
                            void setFlag(
                              "forceNextStreakMilestone",
                              !flags.forceNextStreakMilestone,
                            )
                          }
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                            flags.forceNextStreakMilestone
                              ? "bg-foreground"
                              : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              flags.forceNextStreakMilestone
                                ? "translate-x-5"
                                : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className={cn("mt-4", cardPanelPadded)}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Force cards graduated
                          </p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Treat all cards as graduated. Use to test typed
                            entry without grinding learning steps.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label="Force cards graduated"
                          aria-checked={flags.forceCardsGraduated}
                          onClick={() =>
                            void setFlag(
                              "forceCardsGraduated",
                              !flags.forceCardsGraduated,
                            )
                          }
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                            flags.forceCardsGraduated
                              ? "bg-foreground"
                              : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              flags.forceCardsGraduated
                                ? "translate-x-5"
                                : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4">
                      <ResetEarnedBadgesRow />
                    </div>
                  </div>
                )}

                {/* Danger zone */}
                <div
                  id="danger-zone-heading"
                  className="rounded-xl border border-red-200 p-5 dark:border-red-900"
                >
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                    Danger zone
                  </h3>
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Reset all progress</p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        Permanently deletes your review history
                        {user ? " and cloud data" : ""}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResetOpen(true)}
                      disabled={anyFlagOn}
                      className="min-h-[44px] shrink-0 rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Reset all progress
                    </button>
                  </div>

                  {/*
                    Delete account — full erasure, distinct from reset-progress.
                    Only meaningful for a signed-in user (there is a cloud
                    identity to delete), so the row is gated on `user`. Visually
                    separated from the reset control by a divider. While a
                    superuser flag is on, all cloud writes are paused — so the
                    button shows the same disabled "Sync paused (superuser)"
                    treatment as FsrsOptimizerSection.
                  */}
                  {user && (
                    <div className="mt-5 border-t border-red-200 pt-5 dark:border-red-900">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Delete account
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            Permanently erases your account, cloud data, and
                            sign-in identity. This cannot be undone.
                          </p>
                        </div>
                        {anyFlagOn ? (
                          <button
                            type="button"
                            disabled
                            data-testid="delete-account-button"
                            title="Account deletion is paused while a superuser flag is on."
                            className="min-h-[44px] shrink-0 rounded-lg bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          >
                            Sync paused (superuser)
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteOpen(true)}
                            data-testid="delete-account-button"
                            className="min-h-[44px] shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:bg-red-600 dark:hover:bg-red-500"
                          >
                            Delete account
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
              )}

            </div>

            <ResetProgressDialog
              open={resetOpen}
              onClose={() => setResetOpen(false)}
              onConfirm={handleReset}
            />
            <DeleteAccountDialog
              open={deleteOpen}
              onClose={() => setDeleteOpen(false)}
              onConfirm={handleDeleteAccount}
            />
            <ReenableCardTypeDialog
              open={reenableKey !== null}
              cardTypeName={CARD_TYPE_DISPLAY_NAMES[reenableKey ?? "evolutionCardsEnabled"] ?? "this card type"}
              onClose={() => setReenableKey(null)}
              onChoose={(choice) => { void handleReenableChoice(choice); }}
            />
          </>
        )}
      </div>
    </div>
  );
}

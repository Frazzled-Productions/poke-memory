"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { TtsControls } from "@/components/settings/TtsControls";
import { QaSeedSection } from "@/components/settings/QaSeedSection";
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
import { cardPanelPadded, colStackLg, mutedTextXs, sectionLabel } from "@/lib/utils/class-names";
import { LABS_FLAGS, type LabsFlagKey } from "@/lib/labs/flags";
import { SUPPORTED_LOCALES, LOCALE_COOKIE, DEFAULT_LOCALE, LOCALE_ENDONYMS, type AppLocale } from "@/i18n/locales";
import { setLocaleCookie } from "@/lib/i18n/actions";
import { POKEDEX_GRID_SPRITE_SIZE } from "@/lib/sprites/sizes";

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
  const t = useTranslations();
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(() => setCleared(false), 1500);
    return () => clearTimeout(timer);
  }, [cleared]);

  function handleClear() {
    saveSettings({ ...loadSettings(), earnedBadges: [] });
    setCleared(true);
  }

  return (
    <div className={cardPanelPadded}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            {t("settings.developer.resetEarnedBadges.label")}
          </p>
          <p className={`mt-1 ${mutedTextXs}`}>
            {t("settings.developer.resetEarnedBadges.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="min-h-[36px] shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          aria-label={t("settings.developer.resetEarnedBadges.label")}
        >
          {cleared ? t("settings.developer.resetEarnedBadges.cleared") : t("settings.developer.resetEarnedBadges.reset")}
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  const t = useTranslations();
  return (
    <div className={colStackLg} aria-busy="true" aria-label={t("settings.loadingAriaLabel")}>
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
  const t = useTranslations();
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

  if (unlockedEntries.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-background px-4 py-5 dark:border-zinc-800">
        <h3
          id="theme-heading"
          className="text-sm font-semibold text-foreground"
        >
          {t("settings.appearance.theme.lockedHeading")}
        </h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("settings.appearance.theme.lockedBody")}
        </p>
        <Link
          href="/"
          className="mt-3 inline-block text-sm font-medium text-foreground underline underline-offset-2 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          {t("settings.appearance.theme.practiceLink")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <h3
        id="theme-heading"
        className="text-sm font-semibold text-foreground"
      >
        {t("settings.appearance.theme.heading")}
      </h3>
      <p className={mutedTextXs}>
        {t("settings.appearance.theme.description")}
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
                  width={POKEDEX_GRID_SPRITE_SIZE}
                  height={POKEDEX_GRID_SPRITE_SIZE}
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
                    {t("settings.appearance.theme.selected")} ✓
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelect(null, null)}
                    className="w-full min-h-[36px] rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-400"
                  >
                    {t("settings.appearance.theme.remove")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(entry, seed?.spriteUrl ?? null)}
                  className="w-full min-h-[36px] rounded-lg bg-foreground px-3 py-1 text-xs font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
                >
                  {t("settings.appearance.theme.setAsTheme")}
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
  /** Translation key passed to t() at render time. */
  labelKey: string;
  /** Translation key passed to t() at render time. */
  helperKey: string;
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
        labelKey: "settings.practice.masteryThreshold.label",
        helperKey: "settings.practice.masteryThreshold.description",
        min: 1,
        max: 10,
      },
    ],
  },
];

const NAME_NUMERIC_FIELDS: FieldConfig[] = [
  {
    key: "maxNewPerDay",
    labelKey: "settings.practice.nameCards.newPerDay.label",
    helperKey: "settings.practice.nameCards.newPerDay.description",
    min: 1,
    max: 50,
  },
  {
    key: "maxReviewsPerDay",
    labelKey: "settings.practice.nameCards.reviewsPerDay.label",
    helperKey: "settings.practice.nameCards.reviewsPerDay.description",
    min: 1,
    max: 500,
  },
];

const EVOLUTION_NUMERIC_FIELDS: FieldConfig[] = [
  {
    key: "maxNewEvolutionPerDay",
    labelKey: "settings.practice.evolutionCards.newPerDay.label",
    helperKey: "settings.practice.evolutionCards.newPerDay.description",
    min: 1,
    max: 50,
  },
  {
    key: "maxReviewsEvolutionPerDay",
    labelKey: "settings.practice.evolutionCards.reviewsPerDay.label",
    helperKey: "settings.practice.evolutionCards.reviewsPerDay.description",
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
    labelKey: "settings.practice.reverseCards.newPerDay.label",
    helperKey: "settings.practice.reverseCards.newPerDay.description",
    min: 1,
    max: 50,
  },
  {
    key: "maxReviewsReversePerDay",
    labelKey: "settings.practice.reverseCards.reviewsPerDay.label",
    helperKey: "settings.practice.reverseCards.reviewsPerDay.description",
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

// LOCALE_ENDONYMS is imported from @/i18n/locales — the single source of truth
// for locale endonyms used across the settings locale picker and the machine-
// translation banner (#1349).

/** Read the active locale from document.cookie without importing the hook. */
function readActiveLocale(): AppLocale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${LOCALE_COOKIE}=`));
  const v = match?.split("=")[1];
  if (v && (SUPPORTED_LOCALES as readonly string[]).includes(v)) return v as AppLocale;
  return DEFAULT_LOCALE;
}

export default function SettingsPage() {
  const router = useRouter();
  const t = useTranslations();
  const { user, supabase } = useAuth();
  const { updateFavourite } = useFavourite();
  const { unlocked, flags, setFlag, anyFlagOn } = useSuperuser();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [activeLocale, setActiveLocale] = useState<AppLocale>(DEFAULT_LOCALE);
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

  // Open the quiz and dismiss the discovery nudge (#1443): once the user has
  // engaged with "Mark Pokémon I already know", the nudge has served its
  // purpose, so persist its dismissal (the OnboardingHint re-syncs on the
  // SETTINGS_SAVED_EVENT and hides itself).
  function openKnownQuiz() {
    // Expand the Practice category and open the quiz row, since the nudge lives
    // at the top of the page.
    setTargetCategoryId("practice-heading");
    setKnownQuizOpen(true);
    const settings = loadSettings();
    const onboarding = settings.onboarding ?? { ...DEFAULT_ONBOARDING };
    if (onboarding.markWhatIKnowNudgeDismissed !== true) {
      saveSettings({
        ...settings,
        onboarding: { ...onboarding, markWhatIKnowNudgeDismissed: true },
      });
    }
    // Scroll the quiz itself into view once the category has expanded and the
    // quiz panel has rendered. The category's own forceOpen scroll targets the
    // category heading (much higher up), so without this the user lands above
    // the fold and never sees the quiz they asked to open (#1443 QA).
    // Use block:"start" so the quiz heading + intro lands at/near the top of
    // the viewport rather than centred — centring pushed the heading above
    // the fold and landed the user mid-list (#1486). This is a "use client"
    // component, so window is always defined here.
    window.setTimeout(() => {
      document
        .getElementById("known-quiz-heading")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  }

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
    setActiveLocale(readActiveLocale());
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
    // pushNotificationHour is not auto-detected; current settings value is passed
    // through so the UPDATE does not null the column on other devices (#1315).
    void pushRegionalPrefs(supabase, user.id, {
      timezone: prefs.timezone,
      dateFormat: prefs.dateFormat,
      pushNotificationHour: loadSettings().pushNotificationHour,
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
          {t("settings.heading")}
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
                  {t("settings.search.noMatch", { query: searchQuery })}
                </p>
              )}
            </div>

            {/* Discovery nudge (#1443): pointing users at the "Mark Pokémon I
                already know" quiz. Rendered above the collapsible category list
                so it is visible without expanding anything; its CTA expands the
                Practice category, opens the quiz, and dismisses the nudge. Uses
                its own flag so it reaches existing users (absent key → false via
                the `=== true` coercion in validateOnboarding). Hidden while a
                search filter is active to avoid cluttering results. */}
            {!isFiltering && (
              <div className="mb-3">
                <OnboardingHint
                  id="markWhatIKnowNudgeDismissed"
                  title={t("settings.practice.markWhatIKnowNudge.title")}
                  ctaLabel={t("settings.practice.markWhatIKnowNudge.cta")}
                  ctaOnClick={openKnownQuiz}
                >
                  <p>{t("settings.practice.markWhatIKnowNudge.body")}</p>
                </OnboardingHint>
              </div>
            )}

            <div className="flex flex-col gap-3">

              {/* ── Appearance ─────────────────────────────────────────────── */}
              {visibleSectionIds.has("appearance-heading") && (
              <CollapsibleSection
                sectionId="appearance-heading"
                heading={t("settings.section.appearance")}
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
                    {t("settings.appearance.mobileNav.heading")}
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("settings.appearance.mobileNav.label")}
                        </p>
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t("settings.appearance.mobileNav.description")}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label={t("settings.appearance.mobileNav.label")}
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
                heading={t("settings.section.practice")}
                forceOpen={targetCategoryId === "practice-heading"}
                transientOpen={isFiltering}
              >
                {/* Scheduler knobs */}
                <div id="scheduler-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    {t("settings.practice.scheduler.heading")}
                  </p>
                  <OnboardingHint id="settingsHintDismissed" title="What recall target does">
                    <p>
                      {t("settings.practice.scheduler.hint")}
                    </p>
                  </OnboardingHint>
                  {/* Mastery threshold */}
                  {GROUPS.flatMap((g) =>
                    g.fields.map(({ key, labelKey, helperKey, min, max }) => (
                      <div
                        key={key}
                        className={cardPanelPadded}
                      >
                        <label
                          htmlFor={key}
                          className="block text-sm font-medium text-foreground"
                        >
                          {t(labelKey)}
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
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t(helperKey)}
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
                      {t("settings.practice.recallTarget.label", { percent: Math.round(settings.retentionTarget * 100) })}
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
                      className={`mt-2 ${mutedTextXs}`}
                    >
                      {t("settings.practice.recallTarget.description")}
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
                    {t("settings.practice.quickstart.heading")}
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("settings.practice.quickstart.label")}
                        </p>
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t("settings.practice.quickstart.description")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          knownQuizOpen ? setKnownQuizOpen(false) : openKnownQuiz()
                        }
                        aria-expanded={knownQuizOpen}
                        aria-controls="known-quiz-panel"
                        className="min-h-[36px] shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        {knownQuizOpen ? t("settings.practice.quickstart.close") : t("settings.practice.quickstart.open")}
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
                    {t("settings.practice.nameCards.heading")}
                  </p>
                  <div className={colStackLg}>
                    {NAME_NUMERIC_FIELDS.map(({ key, labelKey, helperKey, min, max }) => (
                      <div
                        key={key}
                        className={cardPanelPadded}
                      >
                        <label
                          htmlFor={key}
                          className="block text-sm font-medium text-foreground"
                        >
                          {t(labelKey)}
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
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t(helperKey)}
                        </p>
                      </div>
                    ))}
                    {/* Verified typed entry (#1251) */}
                    <div className={cardPanelPadded}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {t("settings.practice.typedEntry.label")}
                          </p>
                          <p className={`mt-1 ${mutedTextXs}`}>
                            {t("settings.practice.typedEntry.description")}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={settings.verifiedTypedEntryMode}
                          aria-label={t("settings.practice.typedEntry.label")}
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
                      <p className={`mt-2 ${mutedTextXs}`}>
                        {t("settings.practice.typedEntry.mcRampNote")}
                      </p>
                      {/* One-time first-enable banner (#1271). Dismissed by the user; never re-fires. */}
                      {typedEntryBannerVisible && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="mt-3 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
                        >
                          <p className="flex-1">
                            {t("settings.practice.typedEntry.bannerText")}
                          </p>
                          <button
                            type="button"
                            aria-label={t("settings.practice.typedEntry.dismissBannerAriaLabel")}
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
                    {t("settings.practice.evolutionCards.heading")}
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("settings.practice.evolutionCards.enableLabel")}
                        </p>
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t("settings.practice.evolutionCards.enableDescription")}
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
                      {EVOLUTION_NUMERIC_FIELDS.map(({ key, labelKey, helperKey, min, max }) => (
                        <div
                          key={key}
                          className={cardPanelPadded}
                        >
                          <label
                            htmlFor={key}
                            className="block text-sm font-medium text-foreground"
                          >
                            {t(labelKey)}
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
                          <p className={`mt-1 ${mutedTextXs}`}>
                            {t(helperKey)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Reverse-evolution cards */}
                <div id="reverse-evolution-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    {t("settings.practice.reverseEvolutionCards.heading")}
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("settings.practice.reverseEvolutionCards.enableLabel")}
                        </p>
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t("settings.practice.reverseEvolutionCards.enableDescription")}
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
                    {t("settings.practice.alternateForms.heading")}
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("settings.practice.alternateForms.enableLabel")}
                        </p>
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t("settings.practice.alternateForms.enableDescription")}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label={t("settings.practice.alternateForms.enableLabel")}
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
                    {t("settings.practice.reverseCards.heading")}
                  </p>
                  {REVERSE_NUMERIC_FIELDS.map(({ key, labelKey, helperKey, min, max }) => (
                    <div
                      key={key}
                      className={cardPanelPadded}
                    >
                      <label
                        htmlFor={key}
                        className="block text-sm font-medium text-foreground"
                      >
                        {t(labelKey)}
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
                      <p className={`mt-1 ${mutedTextXs}`}>
                        {t(helperKey)}
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
                    {t("settings.save")}
                  </button>
                  {saved && (
                    <p
                      className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
                      aria-live="polite"
                    >
                      {t("settings.saved")}
                    </p>
                  )}
                </div>
              </CollapsibleSection>
              )}

              {/* ── Audio ──────────────────────────────────────────────────── */}
              {visibleSectionIds.has("audio-heading") && (
              <CollapsibleSection
                sectionId="audio-heading"
                heading={t("settings.section.audio")}
                forceOpen={targetCategoryId === "audio-heading"}
                transientOpen={isFiltering}
              >
                {/* Cry cards */}
                <div id="cry-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    {t("settings.audio.cryCards.heading")}
                  </p>
                  <div className={cardPanelPadded}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("settings.audio.cryCards.enableLabel")}
                        </p>
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t("settings.audio.cryCards.enableDescription")}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label={t("settings.audio.cryCards.enableLabel")}
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
                        {t("settings.audio.playCryOnReveal.label")}
                      </p>
                      <p className={`mt-1 ${mutedTextXs}`}>
                        {t("settings.audio.playCryOnReveal.description")}
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
                        {t("settings.audio.speakNameOnReveal.label")}
                      </p>
                      <p className={`mt-1 ${mutedTextXs}`}>
                        {t("settings.audio.speakNameOnReveal.description")}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label={t("settings.audio.speakNameOnReveal.label")}
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
                  <>
                    <p className={`px-5 pb-1 ${mutedTextXs}`}>
                      {t("settings.audio.ttsWipNote")}
                    </p>
                    <TtsControls
                      ttsVoice={settings.ttsVoice}
                      ttsRate={settings.ttsRate}
                      ttsVolume={settings.ttsVolume}
                      onChange={(patch) => setSettings({ ...settings, ...patch })}
                    />
                  </>
                )}
                {/* Audio-wait setting: only useful when cry or TTS is on */}
                {(settings.playCryOnReveal || settings.speakNameOnReveal) && (
                <div className={cardPanelPadded}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {t("settings.audio.waitForAudio.label")}
                      </p>
                      <p className={`mt-1 ${mutedTextXs}`}>
                        {t("settings.audio.waitForAudio.description")}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label={t("settings.audio.waitForAudio.label")}
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
                    {t("settings.audio.reverseFeedbackDelay.label")}
                  </p>
                  <p className={`mt-1 ${mutedTextXs}`}>
                    {t("settings.audio.reverseFeedbackDelay.description")}
                  </p>
                  <fieldset className="mt-3 flex gap-2">
                    <legend className="sr-only">{t("settings.audio.reverseFeedbackDelay.legendAriaLabel")}</legend>
                    {(
                      [
                        { value: "off" as const, labelKey: "settings.audio.reverseFeedbackDelay.off" },
                        { value: "fast" as const, labelKey: "settings.audio.reverseFeedbackDelay.fast" },
                        { value: "default" as const, labelKey: "settings.audio.reverseFeedbackDelay.default" },
                      ]
                    ).map(({ value, labelKey: delayLabelKey }) => (
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
                        {t(delayLabelKey)}
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
                heading={t("settings.section.offline")}
                forceOpen={targetCategoryId === "offline-heading"}
                transientOpen={isFiltering}
              >
                <div id="offline-download-heading" className={colStackLg}>
                  <p className={sectionLabel}>
                    {t("settings.offline.downloadHeading")}
                  </p>
                  <OfflineSection />
                </div>
              </CollapsibleSection>
              )}

              {/* ── Account & Data ─────────────────────────────────────────── */}
              {visibleSectionIds.has("account-data-heading") && (
              <CollapsibleSection
                sectionId="account-data-heading"
                heading={t("settings.section.accountData")}
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
                    {t("settings.howThisWorks.heading")}
                  </p>
                  <p className="text-sm text-foreground">
                    {t.rich("settings.howThisWorks.body1", {
                      link: (chunks) => (
                        <a
                          href="https://github.com/open-spaced-repetition/ts-fsrs"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
                        >
                          {chunks}
                        </a>
                      ),
                    })}
                  </p>
                  <p className="text-sm text-foreground">
                    {t("settings.howThisWorks.body2")}
                  </p>
                  <p className="text-sm text-foreground">
                    {t("settings.howThisWorks.body3")}
                  </p>
                  <hr className="border-zinc-200 dark:border-zinc-800" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t("settings.howThisWorks.showOnboardingAgainLabel")}
                    </p>
                    <p className={`mt-1 ${mutedTextXs}`}>
                      {t("settings.howThisWorks.showOnboardingAgainDescription")}
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
                      {t("settings.howThisWorks.showOnboardingAgainButton")}
                    </button>
                  </div>
                </div>

                {/* Backup */}
                <div id="backup-heading" className={cn(cardPanelPadded, "flex flex-col gap-3")}>
                  <p className={sectionLabel}>
                    {t("settings.backup.heading")}
                  </p>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.backup.exportLabel")}</p>
                    <p className={`mt-1 ${mutedTextXs}`}>
                      {t("settings.backup.exportDescription")}
                    </p>
                    <button
                      type="button"
                      onClick={() => void exportProgress()}
                      className="mt-3 min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      {t("settings.backup.exportButton")}
                    </button>
                  </div>

                  {/* Review history CSV export — authenticated users only (#918) */}
                  {user && (
                    <>
                      <hr className="border-zinc-200 dark:border-zinc-800" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{t("settings.backup.downloadReviewHistory")}</p>
                        <p className={`mt-1 ${mutedTextXs}`}>
                          {t("settings.backup.downloadReviewHistoryDescription")}
                        </p>
                        <a
                          href="/api/export"
                          download
                          className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                        >
                          {t("settings.backup.downloadCsv")}
                        </a>
                      </div>
                    </>
                  )}

                  <hr className="border-zinc-200 dark:border-zinc-800" />

                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.backup.importLabel")}</p>
                    <p className={`mt-1 ${mutedTextXs}`}>
                      {t("settings.backup.importDescription")}
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
                      {t("settings.backup.importButton")}
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
                    {t("settings.regional.heading")}
                  </p>

                  {/* Timezone picker */}
                  <div className={cardPanelPadded}>
                    <label
                      htmlFor="timezone"
                      className="block text-sm font-medium text-foreground"
                    >
                      {t("settings.regional.timezone.label")}
                    </label>
                    <p className={`mt-1 ${mutedTextXs}`}>
                      {t("settings.regional.timezone.description")}
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
                            pushNotificationHour: next.pushNotificationHour,
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
                      {t("settings.regional.dateFormat.label")}
                    </p>
                    <p className={`mt-1 ${mutedTextXs}`}>
                      {t("settings.regional.dateFormat.description")}
                    </p>
                    <fieldset className="mt-3 flex flex-col gap-2">
                      <legend className="sr-only">{t("settings.regional.dateFormat.legendAriaLabel")}</legend>
                      {(() => {
                        // Hoist outside the per-option map so it is computed once.
                        const todayIso = new Date().toISOString().slice(0, 10);
                        return (
                          [
                            { value: "dmy" as DateFormat, labelKey: "settings.regional.dateFormat.dmy" },
                            { value: "mdy" as DateFormat, labelKey: "settings.regional.dateFormat.mdy" },
                            { value: "iso" as DateFormat, labelKey: "settings.regional.dateFormat.iso" },
                          ] as const
                        ).map(({ value, labelKey: dateLabelKey }) => (
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
                                    pushNotificationHour: next.pushNotificationHour,
                                  }).catch(() => {});
                                }
                              }}
                              className="shrink-0 accent-foreground"
                            />
                            <span className="flex-1 text-foreground">{t(dateLabelKey)}</span>
                            <span className={`font-mono ${mutedTextXs} tabular-nums`}>
                              {formatShortDate(todayIso, value)}
                            </span>
                          </label>
                        ));
                      })()}
                    </fieldset>
                  </div>

                  {/* Push notification hour (#1315) */}
                  <div className={cardPanelPadded}>
                    <label
                      htmlFor="push-notification-hour"
                      className="block text-sm font-medium text-foreground"
                    >
                      {t("settings.regional.dailyReminderTime.label")}
                    </label>
                    <p className={`mt-1 ${mutedTextXs}`}>
                      {t("settings.regional.dailyReminderTime.description")}
                    </p>
                    <select
                      id="push-notification-hour"
                      value={settings.pushNotificationHour ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const parsed = raw === "" ? null : parseInt(raw, 10);
                        const hour = parsed !== null && !isNaN(parsed) && parsed >= 0 && parsed <= 23
                          ? parsed
                          : null;
                        const next = { ...settings, pushNotificationHour: hour };
                        setSettings(next);
                        saveSettings(next);
                        if (user && supabase) {
                          void pushRegionalPrefs(supabase, user.id, {
                            timezone: next.timezone,
                            dateFormat: next.dateFormat,
                            pushNotificationHour: hour,
                          }).catch(() => {});
                        }
                      }}
                      className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      <option value="">{t("settings.regional.dailyReminderTime.defaultOption")}</option>
                      {Array.from({ length: 24 }, (_, h) => {
                        const label = `${String(h).padStart(2, "0")}:00`;
                        return (
                          <option key={h} value={String(h)}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* About */}
                <div id="about-heading" className={cn(cardPanelPadded, "flex flex-col gap-3")}>
                  <p className={sectionLabel}>
                    {t("settings.about.heading")}
                  </p>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.about.version")}</p>
                    <p className={`mt-1 ${mutedTextXs}`}>
                      {process.env.NEXT_PUBLIC_APP_VERSION
                        ? `v${process.env.NEXT_PUBLIC_APP_VERSION}`
                        : "dev"}
                    </p>
                  </div>

                  <hr className="border-zinc-200 dark:border-zinc-800" />

                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.about.whatsNew")}</p>
                    <p className={`mt-1 ${mutedTextXs}`}>
                      {t("settings.about.whatsNewDescription")}
                    </p>
                    <Link
                      href="/whats-new"
                      className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      {t("settings.about.viewChangelog")}
                    </Link>
                  </div>

                  <hr className="border-zinc-200 dark:border-zinc-800" />

                  <div className="flex flex-wrap gap-3">
                    <Link
                      href="/privacy"
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      {t("settings.about.privacy")}
                    </Link>
                    <Link
                      href="/terms"
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      {t("settings.about.terms")}
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
                heading={t("settings.section.labs")}
                forceOpen={targetCategoryId === "labs-heading"}
                transientOpen={isFiltering}
              >
                <div id="labs-heading" className={colStackLg}>
                  <p className={mutedTextXs}>
                    {t("settings.labs.description")}
                  </p>
                  {(Object.entries(LABS_FLAGS) as [LabsFlagKey, { label: string; description: string; default: boolean }][]).map(
                    ([key, meta]) => (
                      <div key={key} className={cardPanelPadded}>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {meta.label}
                            </p>
                            <p className={`mt-1 ${mutedTextXs}`}>
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

                        {/* Locale pickers — only shown when languages flag is on.
                            Two independent selectors: one for the app UI, one
                            for Pokémon names (#1260). */}
                        {key === "languages" && (settings.labsFlags[key] ?? false) && (
                          <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800 flex flex-col gap-4">
                            {/* App language — writes the locale cookie */}
                            <div>
                              <label
                                htmlFor="labs-app-locale-select"
                                className="block text-sm font-medium text-foreground"
                              >
                                {t("settings.labs.languages.appLanguageLabel")}
                              </label>
                              <p className={`mt-1 ${mutedTextXs}`}>
                                {t("settings.labs.languages.appLanguageDescription")}
                              </p>
                              <select
                                id="labs-app-locale-select"
                                value={activeLocale}
                                onChange={(e) => {
                                  const next = e.target.value as AppLocale;
                                  setActiveLocale(next);
                                  void setLocaleCookie(next).then(() => {
                                    router.refresh();
                                  });
                                }}
                                className="mt-2 rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                              >
                                {SUPPORTED_LOCALES.map((loc) => (
                                  <option key={loc} value={loc}>
                                    {loc === "en"
                                      ? LOCALE_ENDONYMS[loc]
                                      : `${LOCALE_ENDONYMS[loc]} ${t("settings.labs.languages.previewSuffix")}`}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Pokémon name language — writes pokemonNameLocale in settings */}
                            <div>
                              <label
                                htmlFor="labs-pokemon-name-locale-select"
                                className="block text-sm font-medium text-foreground"
                              >
                                {t("settings.labs.languages.pokemonNameLanguageLabel")}
                              </label>
                              <p className={`mt-1 ${mutedTextXs}`}>
                                {t("settings.labs.languages.pokemonNameLanguageDescription")}
                              </p>
                              <select
                                id="labs-pokemon-name-locale-select"
                                value={settings.pokemonNameLocale}
                                onChange={(e) => {
                                  const next = e.target.value as AppLocale;
                                  const updated = { ...settings, pokemonNameLocale: next };
                                  setSettings(updated);
                                  saveSettings(updated);
                                }}
                                className="mt-2 rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                              >
                                {SUPPORTED_LOCALES.map((loc) => (
                                  <option key={loc} value={loc}>
                                    {loc === "en"
                                      ? LOCALE_ENDONYMS[loc]
                                      : `${LOCALE_ENDONYMS[loc]} ${t("settings.labs.languages.previewSuffix")}`}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}
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
                heading={t("settings.section.advanced")}
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
                      {t("settings.developer.heading")}
                    </p>
                    <p className={`mt-2 ${mutedTextXs}`}>
                      {t("settings.developer.description")}
                    </p>
                    <div className={cn("mt-4", cardPanelPadded)}>
                      <a
                        href="/audit-themes"
                        className="block text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {t("settings.developer.themeAudit")}
                      </a>
                      <p className={`mt-1 ${mutedTextXs}`}>
                        {t("settings.developer.themeAuditDescription")}
                      </p>
                    </div>

                    <div className={cn("mt-4", cardPanelPadded)}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {t("settings.developer.pretendAllMastered.label")}
                          </p>
                          <p className={`mt-1 ${mutedTextXs}`}>
                            {t("settings.developer.pretendAllMastered.description")}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label={t("settings.developer.pretendAllMastered.label")}
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
                            {t("settings.developer.forceNextStreakMilestone.label")}
                          </p>
                          <p className={`mt-1 ${mutedTextXs}`}>
                            {t("settings.developer.forceNextStreakMilestone.description")}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label={t("settings.developer.forceNextStreakMilestone.label")}
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
                            {t("settings.developer.forceTokenToast.label")}
                          </p>
                          <p className={`mt-1 ${mutedTextXs}`}>
                            {t("settings.developer.forceTokenToast.description")}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label={t("settings.developer.forceTokenToast.label")}
                          aria-checked={flags.forceTokenToast}
                          onClick={() =>
                            void setFlag(
                              "forceTokenToast",
                              !flags.forceTokenToast,
                            )
                          }
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                            flags.forceTokenToast
                              ? "bg-foreground"
                              : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              flags.forceTokenToast
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
                            {t("settings.developer.forceCardsGraduated.label")}
                          </p>
                          <p className={`mt-1 ${mutedTextXs}`}>
                            {t("settings.developer.forceCardsGraduated.description")}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label={t("settings.developer.forceCardsGraduated.label")}
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

                    {/* QA seed mode toggle (#1326) */}
                    <div className={cn("mt-4", cardPanelPadded)}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {t("settings.developer.qaSeedMode.label")}
                          </p>
                          <p className={`mt-1 ${mutedTextXs}`}>
                            {t("settings.developer.qaSeedMode.description")}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label={t("settings.developer.qaSeedMode.label")}
                          aria-checked={flags.qaSeedMode}
                          onClick={() =>
                            void setFlag("qaSeedMode", !flags.qaSeedMode)
                          }
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                            flags.qaSeedMode
                              ? "bg-foreground"
                              : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              flags.qaSeedMode
                                ? "translate-x-5"
                                : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* QA seed panel — only shown when qaSeedMode is on */}
                    {flags.qaSeedMode && <QaSeedSection />}
                  </div>
                )}

                {/* Danger zone */}
                <div
                  id="danger-zone-heading"
                  className="rounded-xl border border-red-200 p-5 dark:border-red-900"
                >
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                    {t("settings.dangerZone.heading")}
                  </h3>
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{t("settings.dangerZone.resetAllProgress")}</p>
                      <p className={`mt-0.5 ${mutedTextXs}`}>
                        {user
                          ? t("settings.dangerZone.resetDescriptionCloud")
                          : t("settings.dangerZone.resetDescription")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResetOpen(true)}
                      disabled={anyFlagOn}
                      className="min-h-[44px] shrink-0 rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      {t("settings.dangerZone.resetAllProgress")}
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
                            {t("settings.dangerZone.deleteAccount")}
                          </p>
                          <p className={`mt-0.5 ${mutedTextXs}`}>
                            {t("settings.dangerZone.deleteDescription")}
                          </p>
                        </div>
                        {anyFlagOn ? (
                          <button
                            type="button"
                            disabled
                            data-testid="delete-account-button"
                            title={t("settings.dangerZone.deletePausedTitle")}
                            className="min-h-[44px] shrink-0 rounded-lg bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          >
                            {t("settings.dangerZone.syncPausedSuperuser")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteOpen(true)}
                            data-testid="delete-account-button"
                            className="min-h-[44px] shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:bg-red-600 dark:hover:bg-red-500"
                          >
                            {t("settings.dangerZone.deleteAccount")}
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

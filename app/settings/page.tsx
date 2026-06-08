"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  loadSettings,
  saveSettings,
  RETENTION_TARGET_MIN,
  RETENTION_TARGET_MAX,
  DEFAULT_ONBOARDING,
} from "@/lib/settings/persistence";
import type { UserSettings } from "@/lib/settings/persistence";
import { exportProgress, validateBackup, applyBackup } from "@/lib/backup/io";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { useAuth } from "@/lib/auth/AuthContext";
import { clearLocalProgress } from "@/lib/storage/reset";
import { resetAllProgressEverywhere } from "@/lib/sync/reset";
import { ResetProgressDialog } from "@/components/settings/ResetProgressDialog";
import { DeleteAccountDialog } from "@/components/settings/DeleteAccountDialog";
import { FeedbackModal } from "@/components/feedback/FeedbackModal";
import { ReenableCardTypeDialog, type ReenableChoice } from "@/components/settings/ReenableCardTypeDialog";
import { deleteAccountEverywhere } from "@/lib/sync/deleteAccount";
import { signOut } from "@/lib/auth/actions";
import { CURATED_POKEMON } from "@/lib/theme/curated-pokemon";
import type { CuratedPokemon } from "@/lib/theme/curated-pokemon";
import { loadFavourite, saveFavourite } from "@/lib/theme/persistence";
import { useFavourite } from "@/components/theme/FavouriteThemeProvider";
import { isMastered } from "@/lib/stats/derive";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadGradeLog } from "@/lib/gradelog/persistence";
import type { ReviewState } from "@/lib/srs/scheduler";
import { initialReviewState } from "@/lib/srs/scheduler";
import { countOptimizableReviews } from "@/lib/srs/optimizer";
import { FsrsOptimizerSection } from "@/components/settings/FsrsOptimizerSection";
import { ForcePullSection } from "@/components/settings/ForcePullSection";
import { IntensityPicker } from "@/components/settings/IntensityPicker";
import { KnownPokemonQuiz } from "@/components/onboarding/KnownPokemonQuiz";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
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
import { SignInSheet } from "@/components/auth/SignInSheet";
import { PushOptIn } from "@/components/pwa/PushOptIn";
import { OfflineSection } from "@/components/settings/OfflineSection";
import { SyncStatusLine } from "@/components/stats/SyncStatusLine";
import { useRetryPush } from "@/lib/sync/useRetryPush";
import { loadSyncStatus } from "@/lib/sync/persistence";
import { cn } from "@/lib/utils/cn";
import { cardPanelPadded, colStack, colStackLg, mutedText, mutedTextXs, sectionLabel } from "@/lib/utils/class-names";
import { CompanyDisclosure } from "@/components/CompanyDisclosure";
import { SUPPORTED_LOCALES, LOCALE_COOKIE, DEFAULT_LOCALE, LOCALE_ENDONYMS, type AppLocale } from "@/i18n/locales";
import { setLocaleCookie } from "@/lib/i18n/actions";
import { POKEDEX_GRID_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { readMasteredCountCache } from "@/lib/profile/masteredCountCache";

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

// Evaluated once at module load - list is stable, no point computing it
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
 * - no confirmation dialog because the only way to render it is from inside
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
  const { seed } = useSeed();
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
      (state !== undefined && isMastered(state))
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
        <p className={`mt-1 ${mutedText}`}>
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
          const pokemon = seed?.seedPokemon.find((p) => p.id === entry.id);
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
              {pokemon?.spriteUrl ? (
                <Image
                  src={pokemon.spriteUrl}
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
                  onClick={() => onSelect(entry, pokemon?.spriteUrl ?? null)}
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

// Numeric fields only - used for clamping on save. Boolean fields are handled
// separately in handleSave via spread.
const ALL_NUMERIC_FIELDS: FieldConfig[] = [
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

/** Human-readable names for the card-type settings keys - used in the re-enable dialog. */
const CARD_TYPE_DISPLAY_NAMES: Partial<Record<keyof UserSettings, string>> = {
  evolutionCardsEnabled: "evolution cards",
  reverseEvolutionCardsEnabled: "reverse-evolution cards",
  cryCardsEnabled: "cry cards",
};

/** All top-level section ids used on this page - drives hash deep-link detection. */
const TOP_LEVEL_SECTION_IDS = [
  "practice-schedule-heading",
  "card-types-heading",
  "audio-heading",
  "language-heading",
  "appearance-heading",
  "offline-heading",
  "regional-reminders-heading",
  "data-backup-heading",
  "about-heading",
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
  // Note: "about-heading" and "language-heading" are already included via
  // ...TOP_LEVEL_SECTION_IDS above - no explicit duplicates needed here.
  "languages-learning",
  "developer-heading",
  "danger-zone-heading",
] as const;

type AnchorId = typeof ALL_ANCHOR_IDS[number];
type TopLevelId = typeof TOP_LEVEL_SECTION_IDS[number];

/**
 * Map from a sub-section anchor to the top-level CollapsibleSection that
 * contains it. Used so navigating to e.g. #onboarding-heading also expands
 * the correct parent category.
 */
const ANCHOR_TO_CATEGORY: Partial<Record<AnchorId, TopLevelId>> = {
  "theme-heading": "appearance-heading",
  "mobile-nav-heading": "appearance-heading",
  "scheduler-heading": "practice-schedule-heading",
  "known-quiz-heading": "practice-schedule-heading",
  "name-cards-heading": "card-types-heading",
  "evolution-cards-heading": "card-types-heading",
  "reverse-evolution-heading": "card-types-heading",
  "alternate-forms-heading": "card-types-heading",
  "reverse-heading": "card-types-heading",
  "cry-heading": "card-types-heading",
  "offline-download-heading": "offline-heading",
  "onboarding-heading": "data-backup-heading",
  "backup-heading": "data-backup-heading",
  "regional-heading": "regional-reminders-heading",
  // Top-level ids resolve via the isTopLevel fallback in the hash handler -
  // no explicit self-reference needed here for "about-heading" or "language-heading".
  "languages-learning": "language-heading",
  "developer-heading": "advanced-heading",
  "danger-zone-heading": "advanced-heading",
};

// LOCALE_ENDONYMS is imported from @/i18n/locales - the single source of truth
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

/**
 * Derive the provider label for a signed-in user from their identities array.
 * Falls back to "unknown" if no recognised provider is linked.
 */
function resolveProviderKey(user: NonNullable<ReturnType<typeof useAuth>["user"]>): "github" | "google" | "email" | "username" | "unknown" {
  const identities = user.identities ?? [];
  for (const id of identities) {
    if (id.provider === "github") return "github";
    if (id.provider === "google") return "google";
    if (id.provider === "email") return "email";
  }
  // Username/password auth uses the "email" provider internally but
  // user_metadata.provider_id may be absent. Check for username explicitly.
  const meta = user.user_metadata ?? {};
  if (meta.username) return "username";
  return "unknown";
}

/**
 * Resolve a human-readable display identity for the signed-in user.
 * Prefers username, then full name, then email.
 */
function resolveDisplayName(user: NonNullable<ReturnType<typeof useAuth>["user"]>): string {
  const meta = user.user_metadata ?? {};
  return (
    (meta.username as string | undefined) ??
    (meta.user_name as string | undefined) ??
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    user.email ??
    "User"
  );
}

// ── Inline toggle switch (reusable within this file) ─────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
        checked ? "bg-foreground" : "bg-zinc-300 dark:bg-zinc-600"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ── SettingsSubsection: real <h3> sub-heading for WCAG 1.3.1 compliance ──────

function SettingsSubsection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className={colStackLg}>
      <h3 className={sectionLabel}>{heading}</h3>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const t = useTranslations();
  const { user, supabase } = useAuth();
  const { updateFavourite } = useFavourite();
  const { unlocked, flags, setFlag, anyFlagOn } = useSuperuser();
  const { seed } = useSeed();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [activeLocale, setActiveLocale] = useState<AppLocale>(DEFAULT_LOCALE);
  const [draftValues, setDraftValues] = useState<Partial<Record<keyof UserSettings, string>>>({});
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [signInSheetOpen, setSignInSheetOpen] = useState(false);
  // Re-enable dialog: set when toggling a card type from disabled to enabled.
  // Holds the settings key being re-enabled so the dialog knows what to label.
  const [reenableKey, setReenableKey] = useState<keyof UserSettings | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleErrorKey, setToggleErrorKey] = useState<keyof UserSettings | null>(null);
  const [favouriteId, setFavouriteId] = useState<number | null>(null);
  // Pending unenrol confirmation: the locale the user wants to remove when it
  // is the currently-active language. An inline confirm block is shown instead
  // of applying immediately, to avoid accidentally switching practice to English.
  const [pendingUnenrolLocale, setPendingUnenrolLocale] =
    useState<AppLocale | null>(null);
  // Per-locale mastered counts for the enrolment checklist.
  const [enrolmentMasteredCounts, setEnrolmentMasteredCounts] = useState<
    Record<AppLocale, number>
  >({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 });
  // One-time onboarding banner shown when verified typed entry is first enabled (#1271).
  const [typedEntryBannerVisible, setTypedEntryBannerVisible] = useState(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks whether auto-detection ran on this mount so the push effect below
  // only fires when prefs were freshly detected, not on every auth change.
  const autoDetectedPrefsRef = useRef<{ timezone: string; dateFormat: DateFormat } | null>(null);

  const [optimizableReviewCount, setOptimizableReviewCount] = useState<number>(0);
  const [isPendingSignOut, startSignOutTransition] = useTransition();

  // "Mark Pokémon I already know" quiz - collapsed by default so the long
  // sprite grid does not eat the Practice schedule section.
  const [knownQuizOpen, setKnownQuizOpen] = useState<boolean>(false);

  // Retry push hook for the account/sync block.
  const { retryState, retryNow } = useRetryPush(
    anyFlagOn ? null : supabase,
    anyFlagOn ? null : (user?.id ?? null),
  );

  // Derive whether sync is in a failed state for the amber border.
  // Mirrors the isFailed / schemaError logic in SyncStatusLine - uses the
  // same loadSyncStatus() read that SyncStatusLine already performs, so no
  // new data source is introduced.
  const syncHasFailed = (() => {
    if (retryState === "error") return true;
    const status = loadSyncStatus();
    if (status.structuralSyncError !== null) return true;
    if (!status.lastPushFailed) return false;
    // failedCardCount === 0 is the edge case SyncStatusLine treats as success
    // (the push flag cleared between the write and the .then() read).
    return status.failedCardCount !== 0;
  })();

  // Open the quiz and dismiss the discovery nudge (#1443).
  function openKnownQuiz() {
    setTargetCategoryId("practice-schedule-heading");
    setKnownQuizOpen(true);
    const currentSettings = loadSettings();
    const onboarding = currentSettings.onboarding ?? { ...DEFAULT_ONBOARDING };
    if (onboarding.markWhatIKnowNudgeDismissed !== true) {
      saveSettings({
        ...currentSettings,
        onboarding: { ...onboarding, markWhatIKnowNudgeDismissed: true },
      });
    }
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
    setEnrolmentMasteredCounts(readMasteredCountCache());
    void loadGradeLog().then((log) => setOptimizableReviewCount(countOptimizableReviews(log)));

    // Resolve hash deep-link to the top-level category to force-expand.
    const hash = window.location.hash.replace("#", "") as AnchorId;
    if ((ALL_ANCHOR_IDS as ReadonlyArray<string>).includes(hash)) {
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
  useEffect(() => {
    if (!user || !supabase || !autoDetectedPrefsRef.current) return;
    const prefs = autoDetectedPrefsRef.current;
    autoDetectedPrefsRef.current = null;
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

    const cardTypeKeys = [
      "evolutionCardsEnabled",
      "reverseEvolutionCardsEnabled",
      "cryCardsEnabled",
    ] as const;
    if ((cardTypeKeys as readonly string[]).includes(key)) {
      if (!settings[key]) {
        setReenableKey(key);
        return;
      }
    }

    setToggleError(null);
    setToggleErrorKey(null);

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

  async function handleReenableChoice(choice: ReenableChoice) {
    if (settings === null || reenableKey === null) return;
    setReenableKey(null);
    setToggleError(null);
    setToggleErrorKey(null);

    setSettings({ ...settings, [reenableKey]: true });

    if (choice === "fresh") {
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
      await clearLocalProgress();
    }
    saveFavourite(null);
    setFavouriteId(null);
    updateFavourite(null);
    router.replace("/");
  }

  async function handleDeleteAccount() {
    if (anyFlagOn) return;
    if (!user || !supabase) return;
    const result = await deleteAccountEverywhere(supabase);
    if (!result.ok) {
      throw new Error(
        "Could not delete your account. Check your connection and try again.",
      );
    }
    setFavouriteId(null);
    updateFavourite(null);
    await signOut();
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
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
    setSettings(clamped);
    setSaved(true);
    if (savedTimeoutRef.current !== null) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => {
      savedTimeoutRef.current = null;
      setSaved(false);
    }, 2000);
  }

  /**
   * Whether Card types should default-open this visit (#1726).
   * True when cardTypesDefaultOpenDismissed is not yet set (absent key in
   * pre-#1726 blobs, or brand-new user) AND no search filter is active AND
   * no hash deep-link to a different section is targeted.
   */
  const cardTypesDefaultOpen =
    settings !== null &&
    settings.onboarding.cardTypesDefaultOpenDismissed !== true &&
    !isFiltering &&
    (targetCategoryId === null || targetCategoryId === "card-types-heading");

  /**
   * Write the cardTypesDefaultOpenDismissed flag on first manual collapse.
   * Called by CollapsibleSection's onFirstCollapse callback.
   * Only writes once (guards on the flag value).
   */
  function handleCardTypesFirstCollapse() {
    const current = loadSettings();
    if (current.onboarding.cardTypesDefaultOpenDismissed === true) return;
    const updated = {
      ...current,
      onboarding: { ...current.onboarding, cardTypesDefaultOpenDismissed: true },
    };
    saveSettings(updated);
    setSettings(updated);
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl">
        <h1 className="mb-8 text-2xl font-bold tracking-tight text-foreground">
          {t("settings.heading")}
        </h1>

        {/* ── Always-visible account/sync block (#1721) ─────────────────── */}
        <section aria-label={t("settings.account.sectionAriaLabel")} className="mb-6">
          {user === null ? (
            // Guest state
            <div className="rounded-xl border border-zinc-200 bg-background px-4 py-3 dark:border-zinc-800">
              <p className="text-sm font-medium text-foreground">
                {t("settings.account.guest.practising")}
              </p>
              <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className={mutedTextXs}>
                  {t("settings.account.guest.savedLocally")}
                </p>
                <button
                  type="button"
                  onClick={() => setSignInSheetOpen(true)}
                  className="inline-flex min-h-[44px] items-center text-sm font-medium underline underline-offset-2 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 sm:min-h-0 sm:text-xs"
                  aria-label={t("settings.account.guest.signIn")}
                >
                  {t("settings.account.guest.signIn")} &rarr;
                </button>
              </div>
            </div>
          ) : (
            // Signed-in state (healthy or failed)
            <div
              className={cn(
                "rounded-xl border bg-background px-4 py-3",
                syncHasFailed
                  ? "border-amber-300 dark:border-amber-700"
                  : "border-zinc-200 dark:border-zinc-800",
              )}
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {resolveDisplayName(user)}
                  </p>
                  <p className={mutedTextXs}>
                    {t(`settings.account.provider.${resolveProviderKey(user)}`)}
                  </p>
                  <div className="mt-1">
                    <SyncStatusLine
                      retryState={retryState}
                      retryNow={retryNow}
                      superuserPaused={anyFlagOn}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => startSignOutTransition(() => signOut())}
                  disabled={isPendingSignOut}
                  aria-label={t("settings.account.signedIn.signOut")}
                  className="min-h-[44px] self-start shrink-0 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-700 sm:min-h-0 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-xs"
                >
                  {t("settings.account.signedIn.signOut")}
                </button>
              </div>
            </div>
          )}
        </section>

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
                  className={`mt-4 ${mutedText}`}
                  aria-live="polite"
                >
                  {t("settings.search.noMatch", { query: searchQuery })}
                </p>
              )}
            </div>

            {/* Discovery nudge (#1443) - hidden while search is active */}
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

              {/* ── 1. Practice schedule ────────────────────────────────── */}
              {visibleSectionIds.has("practice-schedule-heading") && (
              <CollapsibleSection
                sectionId="practice-schedule-heading"
                heading={t("settings.section.practiceSchedule")}
                forceOpen={targetCategoryId === "practice-schedule-heading"}
                transientOpen={isFiltering}
              >
                {/* Scheduler knobs */}
                <SettingsSubsection id="scheduler-heading" heading={t("settings.practice.scheduler.heading")}>
                  <OnboardingHint id="settingsHintDismissed" title="What recall target does">
                    <p>
                      {t("settings.practice.scheduler.hint")}
                    </p>
                  </OnboardingHint>
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
                </SettingsSubsection>

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

                {/* "Mark Pokémon I already know" quickstart (#1084) */}
                <SettingsSubsection id="known-quiz-heading" heading={t("settings.practice.quickstart.heading")}>
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
                </SettingsSubsection>

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

              {/* ── 2. Card types ─────────────────────────────────────────── */}
              {visibleSectionIds.has("card-types-heading") && (
              <CollapsibleSection
                sectionId="card-types-heading"
                heading={t("settings.section.cardTypes")}
                forceOpen={
                  targetCategoryId === "card-types-heading" ||
                  cardTypesDefaultOpen
                }
                transientOpen={isFiltering}
                onFirstCollapse={cardTypesDefaultOpen ? handleCardTypesFirstCollapse : undefined}
              >
                {/* Name cards - always on since #1234 */}
                <SettingsSubsection id="name-cards-heading" heading={t("settings.practice.nameCards.heading")}>
                  <div className={colStackLg}>
                    {NAME_NUMERIC_FIELDS.map(({ key, labelKey, helperKey, min, max }) => (
                      <div key={key} className={cardPanelPadded}>
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
                        <p className={`mt-1 ${mutedTextXs}`}>{t(helperKey)}</p>
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
                        <ToggleSwitch
                          checked={settings.verifiedTypedEntryMode}
                          onChange={() => handleToggle("verifiedTypedEntryMode")}
                          ariaLabel={t("settings.practice.typedEntry.label")}
                        />
                      </div>
                      <p className={`mt-2 ${mutedTextXs}`}>
                        {t("settings.practice.typedEntry.mcRampNote")}
                      </p>
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
                </SettingsSubsection>

                {/* Evolution cards */}
                <SettingsSubsection id="evolution-cards-heading" heading={t("settings.practice.evolutionCards.heading")}>
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
                      <ToggleSwitch
                        checked={settings.evolutionCardsEnabled}
                        onChange={() => handleToggle("evolutionCardsEnabled")}
                        ariaLabel={t("settings.practice.evolutionCards.enableLabel")}
                      />
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
                        <div key={key} className={cardPanelPadded}>
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
                          <p className={`mt-1 ${mutedTextXs}`}>{t(helperKey)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </SettingsSubsection>

                {/* Reverse-evolution cards */}
                <SettingsSubsection id="reverse-evolution-heading" heading={t("settings.practice.reverseEvolutionCards.heading")}>
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
                      <ToggleSwitch
                        checked={settings.reverseEvolutionCardsEnabled}
                        onChange={() => handleToggle("reverseEvolutionCardsEnabled")}
                        ariaLabel={t("settings.practice.reverseEvolutionCards.enableLabel")}
                      />
                    </div>
                  </div>
                </SettingsSubsection>

                {/* Alternate forms (#658) */}
                <SettingsSubsection id="alternate-forms-heading" heading={t("settings.practice.alternateForms.heading")}>
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
                      <ToggleSwitch
                        checked={settings.alternateFormsEnabled}
                        onChange={() => handleToggle("alternateFormsEnabled")}
                        ariaLabel={t("settings.practice.alternateForms.enableLabel")}
                      />
                    </div>
                  </div>
                </SettingsSubsection>

                {/* Reverse cards - always on since #1234 */}
                <SettingsSubsection id="reverse-heading" heading={t("settings.practice.reverseCards.heading")}>
                  {REVERSE_NUMERIC_FIELDS.map(({ key, labelKey, helperKey, min, max }) => (
                    <div key={key} className={cardPanelPadded}>
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
                      <p className={`mt-1 ${mutedTextXs}`}>{t(helperKey)}</p>
                    </div>
                  ))}
                </SettingsSubsection>

                {/* Cry cards enable/disable - moved from Audio (#1722) */}
                <SettingsSubsection id="cry-heading" heading={t("settings.audio.cryCards.heading")}>
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
                      <ToggleSwitch
                        checked={settings.cryCardsEnabled}
                        onChange={() => handleToggle("cryCardsEnabled")}
                        ariaLabel={t("settings.audio.cryCards.enableLabel")}
                      />
                    </div>
                  </div>
                  {/* Cross-link to Audio for playback options - only when cry cards are enabled (#1722) */}
                  {settings.cryCardsEnabled && (
                    <p className={mutedTextXs}>
                      {t("settings.cardTypes.cryAudioNote")}{" "}
                      <a
                        href="#audio-heading"
                        className="underline underline-offset-2 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded"
                      >
                        {t("settings.cardTypes.cryAudioLink")}
                      </a>
                    </p>
                  )}
                </SettingsSubsection>

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

              {/* ── 3. Audio ──────────────────────────────────────────────── */}
              {visibleSectionIds.has("audio-heading") && (
              <CollapsibleSection
                sectionId="audio-heading"
                heading={t("settings.section.audio")}
                forceOpen={targetCategoryId === "audio-heading"}
                transientOpen={isFiltering}
              >
                {/* Cry playback options - greyed when cry cards disabled (#1722) */}
                <div className={settings.cryCardsEnabled ? undefined : "opacity-50"}>
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
                      <ToggleSwitch
                        checked={settings.playCryOnReveal}
                        onChange={() => handleToggle("playCryOnReveal")}
                        ariaLabel={t("settings.audio.playCryOnReveal.label")}
                      />
                    </div>
                  </div>
                </div>
                {!settings.cryCardsEnabled && (
                  <p className={mutedTextXs}>
                    {t("settings.audio.cryDisabledNote")}
                  </p>
                )}

                {/* Speak name on reveal (TTS) */}
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
                    <ToggleSwitch
                      checked={settings.speakNameOnReveal}
                      onChange={() => handleToggle("speakNameOnReveal")}
                      ariaLabel={t("settings.audio.speakNameOnReveal.label")}
                    />
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
                {/* Audio-wait setting */}
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
                    <ToggleSwitch
                      checked={settings.waitForAudioOnGrade}
                      onChange={() => handleToggle("waitForAudioOnGrade")}
                      ariaLabel={t("settings.audio.waitForAudio.label")}
                    />
                  </div>
                </div>
                )}

                {/* Reverse-card feedback delay (#1200) */}
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

              {/* ── 4. Language ──────────────────────────────────────────── */}
              {visibleSectionIds.has("language-heading") && (
              <CollapsibleSection
                sectionId="language-heading"
                heading={t("settings.section.language")}
                forceOpen={targetCategoryId === "language-heading"}
                transientOpen={isFiltering}
              >
                {/* App language - writes the locale cookie */}
                <div>
                  <label
                    htmlFor="app-locale-select"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t("settings.language.appLanguageLabel")}
                  </label>
                  <p className={`mt-1 ${mutedTextXs}`}>
                    {t("settings.language.appLanguageDescription")}
                  </p>
                  <select
                    id="app-locale-select"
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
                        {LOCALE_ENDONYMS[loc]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Pokémon name practice languages - enrolment set (#1484 Phase 3) */}
                <div id="languages-learning" className="scroll-mt-24">
                  <p className="block text-sm font-medium text-foreground">
                    {t("settings.language.enrolment.heading")}
                  </p>
                  <p className={`mt-1 ${mutedTextXs}`}>
                    {t("settings.language.enrolment.description")}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {SUPPORTED_LOCALES.map((loc) => {
                      const enrolled = (
                        settings.learningLocales ?? ["en"]
                      ).includes(loc);
                      const isEnglish = loc === "en";
                      const masteredCount = flags.pretendAllMastered
                        ? (seed?.seedPokemon.length ?? 0)
                        : (enrolmentMasteredCounts[loc] ?? 0);
                      const isPendingConfirm = pendingUnenrolLocale === loc;
                      return (
                        <li key={loc} className="flex flex-col gap-1.5 py-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex flex-col">
                              <span className="flex items-center gap-2">
                                <span
                                  lang={loc}
                                  className="text-sm font-medium text-foreground"
                                >
                                  {LOCALE_ENDONYMS[loc]}
                                </span>
                                {masteredCount > 0 && (
                                  <span className={mutedTextXs}>
                                    {t("settings.language.enrolment.masteredCount", { count: masteredCount })}
                                  </span>
                                )}
                              </span>
                              <span className={mutedTextXs}>
                                {isEnglish
                                  ? t("settings.language.enrolment.lockedEnglishNote")
                                  : t("settings.language.enrolment.machineTranslationNote")}
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              checked={enrolled}
                              disabled={isEnglish}
                              aria-label={t("settings.language.enrolment.checkboxAriaLabel", { language: LOCALE_ENDONYMS[loc] })}
                              onChange={(e) => {
                                setPendingUnenrolLocale(null);
                                const checked = e.target.checked;
                                if (!checked) {
                                  const activeStored = settings.activePokemonNameLocale ?? "en";
                                  if (activeStored === loc) {
                                    setPendingUnenrolLocale(loc);
                                    return;
                                  }
                                }
                                const current = settings.learningLocales ?? ["en"];
                                let next = checked
                                  ? current.includes(loc) ? current : [...current, loc]
                                  : current.filter((l) => l !== loc);
                                if (!next.includes("en")) next = ["en", ...next];
                                const activeStored = settings.activePokemonNameLocale ?? "en";
                                const active = next.includes(activeStored) ? activeStored : "en";
                                const currentRemoved = settings.removedLocales ?? [];
                                const nextRemoved = checked
                                  ? currentRemoved.filter((l) => l !== loc)
                                  : loc !== "en" && !currentRemoved.includes(loc)
                                    ? [...currentRemoved, loc]
                                    : currentRemoved;
                                const updated = {
                                  ...settings,
                                  learningLocales: next,
                                  activePokemonNameLocale: active,
                                  removedLocales: nextRemoved,
                                };
                                setSettings(updated);
                                saveSettings(updated);
                              }}
                              className="size-4 shrink-0 accent-[var(--theme-accent)] disabled:opacity-50"
                            />
                          </div>
                          {isPendingConfirm && (
                            <div
                              role="alert"
                              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-800 dark:bg-amber-950"
                            >
                              <p className="text-amber-800 dark:text-amber-200">
                                {t("settings.language.enrolment.unenrolConfirmMessage", { language: LOCALE_ENDONYMS[loc] })}
                              </p>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingUnenrolLocale(null);
                                    const current = settings.learningLocales ?? ["en"];
                                    let next = current.filter((l) => l !== loc);
                                    if (!next.includes("en")) next = ["en", ...next];
                                    const currentRemoved = settings.removedLocales ?? [];
                                    const nextRemoved =
                                      loc !== "en" && !currentRemoved.includes(loc)
                                        ? [...currentRemoved, loc]
                                        : currentRemoved;
                                    const updated = {
                                      ...settings,
                                      learningLocales: next,
                                      activePokemonNameLocale: "en" as AppLocale,
                                      removedLocales: nextRemoved,
                                    };
                                    setSettings(updated);
                                    saveSettings(updated);
                                  }}
                                  className="min-h-[32px] rounded-md bg-amber-700 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 dark:bg-amber-600 dark:hover:bg-amber-700"
                                >
                                  {t("settings.language.enrolment.unenrolConfirm")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingUnenrolLocale(null)}
                                  className="min-h-[32px] rounded-md border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900"
                                >
                                  {t("settings.language.enrolment.unenrolCancel")}
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Pokémon name language pointer */}
                <div>
                  <p className="block text-sm font-medium text-foreground">
                    {t("settings.language.pokemonNameLanguageLabel")}
                  </p>
                  <p className={`mt-1 ${mutedTextXs}`}>
                    {t("settings.language.pokemonNameLanguageDescription")}
                  </p>
                </div>
              </CollapsibleSection>
              )}

              {/* ── 5. Appearance ─────────────────────────────────────────── */}
              {visibleSectionIds.has("appearance-heading") && (
              <CollapsibleSection
                sectionId="appearance-heading"
                heading={t("settings.section.appearance")}
                forceOpen={targetCategoryId === "appearance-heading"}
                transientOpen={isFiltering}
              >
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

                {/* Mobile navigation style (#661) */}
                <SettingsSubsection id="mobile-nav-heading" heading={t("settings.appearance.mobileNav.heading")}>
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
                </SettingsSubsection>
              </CollapsibleSection>
              )}

              {/* ── 6. Offline ────────────────────────────────────────────── */}
              {visibleSectionIds.has("offline-heading") && (
              <CollapsibleSection
                sectionId="offline-heading"
                heading={t("settings.section.offline")}
                forceOpen={targetCategoryId === "offline-heading"}
                transientOpen={isFiltering}
              >
                <SettingsSubsection id="offline-download-heading" heading={t("settings.offline.downloadHeading")}>
                  <OfflineSection />
                </SettingsSubsection>
              </CollapsibleSection>
              )}

              {/* ── 7. Regional & reminders ──────────────────────────────── */}
              {visibleSectionIds.has("regional-reminders-heading") && (
              <CollapsibleSection
                sectionId="regional-reminders-heading"
                heading={t("settings.section.regionalReminders")}
                forceOpen={targetCategoryId === "regional-reminders-heading"}
                transientOpen={isFiltering}
              >
                <div id="regional-heading" className={colStackLg}>
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
                        <option key={tz} value={tz}>{tz}</option>
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
                    <fieldset className={`mt-3 ${colStack}`}>
                      <legend className="sr-only">{t("settings.regional.dateFormat.legendAriaLabel")}</legend>
                      {(() => {
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
                          <option key={h} value={String(h)}>{label}</option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* Push opt-in (#1056) - gated on signed-in user */}
                {user && supabase && (
                  <PushOptIn user={user} supabase={supabase} />
                )}
              </CollapsibleSection>
              )}

              {/* ── 8. Data & backup ─────────────────────────────────────── */}
              {visibleSectionIds.has("data-backup-heading") && (
              <CollapsibleSection
                sectionId="data-backup-heading"
                heading={t("settings.section.dataBackup")}
                forceOpen={targetCategoryId === "data-backup-heading"}
                transientOpen={isFiltering}
              >
                {/* Onboarding explainer */}
                <div id="onboarding-heading" className={cn("flex flex-col gap-3", cardPanelPadded)}>
                  <h3 className={sectionLabel}>{t("settings.howThisWorks.heading")}</h3>
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
                  <p className="text-sm text-foreground">{t("settings.howThisWorks.body2")}</p>
                  <p className="text-sm text-foreground">{t("settings.howThisWorks.body3")}</p>
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
                        const next = {
                          ...settings,
                          onboarding: { ...DEFAULT_ONBOARDING },
                          onboardingResetAt: new Date().toISOString(),
                        };
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
                  <h3 className={sectionLabel}>{t("settings.backup.heading")}</h3>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.backup.exportLabel")}</p>
                    <p className={`mt-1 ${mutedTextXs}`}>{t("settings.backup.exportDescription")}</p>
                    <button
                      type="button"
                      onClick={() => void exportProgress()}
                      className="mt-3 min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      {t("settings.backup.exportButton")}
                    </button>
                  </div>

                  {/* Review history CSV export - authenticated users only (#918) */}
                  {user && (
                    <>
                      <hr className="border-zinc-200 dark:border-zinc-800" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{t("settings.backup.downloadReviewHistory")}</p>
                        <p className={`mt-1 ${mutedTextXs}`}>{t("settings.backup.downloadReviewHistoryDescription")}</p>
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
                    <p className={`mt-1 ${mutedTextXs}`}>{t("settings.backup.importDescription")}</p>
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
                      <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
                        {importError}
                      </p>
                    )}
                  </div>
                </div>

                {/* Restore from cloud - authenticated users only (#1732 / #1729).
                    Moved here from Stats page; Stats shows a link to /settings instead.
                    Gated on signed-in + supabase available + superuser off. */}
                {user && supabase && !anyFlagOn && (
                  <div className={cn(cardPanelPadded, "flex flex-col gap-3")}>
                    <h3 className={sectionLabel}>{t("stats.forcePull.heading")}</h3>
                    <ForcePullSection supabase={supabase} userId={user.id} />
                  </div>
                )}
              </CollapsibleSection>
              )}

              {/* ── 9. About ──────────────────────────────────────────────── */}
              {visibleSectionIds.has("about-heading") && (
              <CollapsibleSection
                sectionId="about-heading"
                heading={t("settings.section.about")}
                forceOpen={targetCategoryId === "about-heading"}
                transientOpen={isFiltering}
              >
                <div className={cn(cardPanelPadded, "flex flex-col gap-3")}>
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
                    <p className={`mt-1 ${mutedTextXs}`}>{t("settings.about.whatsNewDescription")}</p>
                    <Link
                      href="/whats-new"
                      className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      {t("settings.about.viewChangelog")}
                    </Link>
                  </div>

                  <hr className="border-zinc-200 dark:border-zinc-800" />

                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.about.moreFromFrazzled")}</p>
                    <p className={`mt-1 ${mutedTextXs}`}>{t("settings.about.moreFromFrazzledDescription")}</p>
                    <a
                      href="https://frazzledproductions.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      {t("settings.about.moreFromFrazzledCta")}
                    </a>
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
                  <CompanyDisclosure />
                </div>

                {/* Manage sign-in methods - for signed-in users */}
                {user && supabase && (
                  <LinkIdentitiesSection user={user} supabase={supabase} />
                )}
              </CollapsibleSection>
              )}

              {/* ── 10. Advanced ──────────────────────────────────────────── */}
              {visibleSectionIds.has("advanced-heading") && (
              <CollapsibleSection
                sectionId="advanced-heading"
                heading={t("settings.section.advanced")}
                forceOpen={targetCategoryId === "advanced-heading"}
                transientOpen={isFiltering}
              >
                {/* Developer section - superuser gated */}
                {unlocked && (
                  <div
                    id="developer-heading"
                    className="rounded-xl border border-amber-300 p-5 dark:border-amber-700"
                  >
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                      {t("settings.developer.heading")}
                    </h3>
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
                        <ToggleSwitch
                          checked={flags.pretendAllMastered}
                          onChange={() => void setFlag("pretendAllMastered", !flags.pretendAllMastered)}
                          ariaLabel={t("settings.developer.pretendAllMastered.label")}
                        />
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
                        <ToggleSwitch
                          checked={flags.forceNextStreakMilestone}
                          onChange={() => void setFlag("forceNextStreakMilestone", !flags.forceNextStreakMilestone)}
                          ariaLabel={t("settings.developer.forceNextStreakMilestone.label")}
                        />
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
                        <ToggleSwitch
                          checked={flags.forceTokenToast}
                          onChange={() => void setFlag("forceTokenToast", !flags.forceTokenToast)}
                          ariaLabel={t("settings.developer.forceTokenToast.label")}
                        />
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
                        <ToggleSwitch
                          checked={flags.forceCardsGraduated}
                          onChange={() => void setFlag("forceCardsGraduated", !flags.forceCardsGraduated)}
                          ariaLabel={t("settings.developer.forceCardsGraduated.label")}
                        />
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
                        <ToggleSwitch
                          checked={flags.qaSeedMode}
                          onChange={() => void setFlag("qaSeedMode", !flags.qaSeedMode)}
                          ariaLabel={t("settings.developer.qaSeedMode.label")}
                        />
                      </div>
                    </div>

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

            {/* ── Persistent feedback link (below all accordions) ──────── */}
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setFeedbackOpen(true)}
                className="inline-flex min-h-[44px] items-center text-sm font-medium text-foreground underline underline-offset-2 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
              >
                {t("settings.feedback.rowLabel")}
              </button>
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
            <FeedbackModal
              open={feedbackOpen}
              onClose={() => setFeedbackOpen(false)}
            />
            <SignInSheet
              open={signInSheetOpen}
              onClose={() => setSignInSheetOpen(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
import { deleteAllCloudProgress } from "@/lib/sync/cloud";
import { ResetProgressDialog } from "@/components/settings/ResetProgressDialog";
import { CURATED_POKEMON } from "@/lib/theme/curated-pokemon";
import type { CuratedPokemon } from "@/lib/theme/curated-pokemon";
import { loadFavourite, saveFavourite } from "@/lib/theme/persistence";
import { useFavourite } from "@/components/theme/FavouriteThemeProvider";
import { isMastered } from "@/lib/stats/derive";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadGradeLog } from "@/lib/gradelog/persistence";
import { countOptimizableReviews } from "@/lib/srs/optimizer";
import { FsrsOptimizerSection } from "@/components/settings/FsrsOptimizerSection";
import { IntensityPicker } from "@/components/settings/IntensityPicker";

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading settings">
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
  // Empty deps: session is loaded once at mount. Nothing on this page writes
  // to the session, so a snapshot is safe and avoids re-reading on every render.
  const cardStateById = useMemo(() => {
    const session = loadSession();
    return new Map((session?.cards ?? []).map((c) => [c.id, c.state]));
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
    <section className="flex flex-col gap-4" aria-labelledby="theme-heading">
      <h2
        id="theme-heading"
        className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        App Theme
      </h2>
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
    </section>
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
    helper: "Soft cap — you can always override it during a session.",
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

export default function SettingsPage() {
  const router = useRouter();
  const { user, supabase } = useAuth();
  const { updateFavourite } = useFavourite();
  const { unlocked, flags, setFlag, anyFlagOn } = useSuperuser();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleErrorKey, setToggleErrorKey] = useState<keyof UserSettings | null>(null);
  const [favouriteId, setFavouriteId] = useState<number | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [optimizableReviewCount, setOptimizableReviewCount] = useState<number>(0);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setFavouriteId(loadFavourite()?.id ?? null);
    // Count optimizable reviews from local grade log
    setOptimizableReviewCount(countOptimizableReviews(loadGradeLog()));
    return () => {
      if (savedTimeoutRef.current !== null) clearTimeout(savedTimeoutRef.current);
      if (toggleErrorTimeoutRef.current !== null) clearTimeout(toggleErrorTimeoutRef.current);
    };
  }, []);

  function handleChange(key: keyof UserSettings, raw: string) {
    if (settings === null) return;
    const value = parseInt(raw, 10);
    setSettings({ ...settings, [key]: isNaN(value) ? settings[key] : value });
  }

  function handleToggle(key: keyof UserSettings) {
    if (settings === null) return;

    // Interlocking guard: block if toggling off would leave all three types disabled.
    const toggleKeys = ["nameCardsEnabled", "evolutionCardsEnabled", "reverseCardsEnabled"] as const;
    if (toggleKeys.includes(key as typeof toggleKeys[number]) && settings[key] === true) {
      const wouldAllBeOff = toggleKeys.every((k) => (k === key ? false : !settings[k]));
      if (wouldAllBeOff) {
        setToggleError("At least one card type must be enabled.");
        setToggleErrorKey(key);
        if (toggleErrorTimeoutRef.current !== null) clearTimeout(toggleErrorTimeoutRef.current);
        toggleErrorTimeoutRef.current = setTimeout(() => {
          toggleErrorTimeoutRef.current = null;
          setToggleError(null);
          setToggleErrorKey(null);
        }, 3000);
        return;
      }
    }

    // Confirm dialogs before disabling a card type.
    if (key === "nameCardsEnabled" && settings.nameCardsEnabled) {
      if (!window.confirm("Disabling name cards will discard all name-card progress when saved. This cannot be undone. Continue?")) {
        return;
      }
    }
    if (key === "evolutionCardsEnabled" && settings.evolutionCardsEnabled) {
      if (!window.confirm("Disabling evolution cards will discard all evolution-card progress when saved. This cannot be undone. Continue?")) {
        return;
      }
    }
    if (key === "reverseCardsEnabled" && settings.reverseCardsEnabled) {
      if (!window.confirm("Disabling reverse cards will discard all reverse-card progress when saved. This cannot be undone. Continue?")) {
        return;
      }
    }
    if (key === "reverseEvolutionCardsEnabled" && settings.reverseEvolutionCardsEnabled) {
      if (!window.confirm("Disabling reverse-evolution cards will discard all their progress when saved. This cannot be undone. Continue?")) {
        return;
      }
    }

    setToggleError(null);
    setToggleErrorKey(null);
    setSettings({ ...settings, [key]: !settings[key] });
  }


  async function handleReset() {
    if (user && supabase) {
      const ok = await deleteAllCloudProgress(supabase, user.id);
      if (!ok) throw new Error("Could not delete cloud data. Check your connection and try again.");
    }
    saveFavourite(null);
    clearLocalProgress();
    setFavouriteId(null);
    updateFavourite(null);
    router.replace("/");
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
      applyBackup(result.data);
      window.location.reload();
    }
  }

  function handleSave() {
    if (settings === null) return;
    const allNumeric = [...ALL_NUMERIC_FIELDS, ...REVERSE_NUMERIC_FIELDS];
    const numericClamped = Object.fromEntries(
      allNumeric.map(({ key, min, max }) => [
        key,
        Math.max(min, Math.min(max, settings[key] as number)),
      ])
    );
    const clamped = {
      ...settings,
      ...numericClamped,
    } as UserSettings;
    saveSettings(clamped);
    const session = loadSession();
    if (session !== null) {
      const filtered = session.cards.filter((card) => {
        if (card.cardType === "name" && !clamped.nameCardsEnabled) return false;
        if (card.cardType === "evolution" && !clamped.evolutionCardsEnabled) return false;
        if (card.cardType === "reverse-evolution" && !clamped.reverseEvolutionCardsEnabled) return false;
        if (card.cardType === "reverse" && !clamped.reverseCardsEnabled) return false;
        if (card.cardType === "cry" && !clamped.cryCardsEnabled) return false;
        return true;
      });
      if (filtered.length !== session.cards.length) {
        saveSession({ ...session, cards: filtered });
      }
    }
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
            <div className="flex flex-col gap-6">
              {GROUPS.map((group, groupIdx) => (
                <section
                  key={group.heading ?? `group-${groupIdx}`}
                  className="flex flex-col gap-4"
                  aria-labelledby={
                    group.heading ? `group-heading-${groupIdx}` : undefined
                  }
                >
                  {group.heading !== null && (
                    <h2
                      id={`group-heading-${groupIdx}`}
                      className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                    >
                      {group.heading}
                    </h2>
                  )}
                  {group.fields.map(({ key, label, helper, min, max }) => (
                    <div
                      key={key}
                      className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800"
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
                        value={Number(settings[key])}
                        onChange={(e) => handleChange(key, e.target.value)}
                        className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                      />
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {helper}
                      </p>
                    </div>
                  ))}
                </section>
              ))}

              {/* Scheduler section — FSRS knobs */}
              <section className="flex flex-col gap-4" aria-labelledby="scheduler-heading">
                <h2
                  id="scheduler-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Scheduler
                </h2>
                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
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
              </section>

              {/* Personalize my schedule — FSRS per-user weight optimizer (#268) */}
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

              {/* Name cards section */}
              <section className="flex flex-col gap-4" aria-labelledby="name-cards-heading">
                <h2
                  id="name-cards-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Name cards
                </h2>
                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Enable name cards
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Show sprite as prompt; type the name. Re-enabling after disabling will reset name-card progress.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.nameCardsEnabled}
                      onClick={() => handleToggle("nameCardsEnabled")}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                        settings.nameCardsEnabled
                          ? "bg-foreground"
                          : "bg-zinc-300 dark:bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                          settings.nameCardsEnabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                {toggleError !== null && toggleErrorKey === "nameCardsEnabled" && (
                  <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
                    {toggleError}
                  </p>
                )}
                <div className={settings.nameCardsEnabled ? undefined : "opacity-50"}>
                  <div className="flex flex-col gap-4">
                    {NAME_NUMERIC_FIELDS.map(({ key, label, helper, min, max }) => (
                      <div
                        key={key}
                        className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800"
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
                          value={Number(settings[key])}
                          onChange={(e) => handleChange(key, e.target.value)}
                          disabled={!settings.nameCardsEnabled}
                          className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                        />
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {helper}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Evolution cards section */}
              <section className="flex flex-col gap-4" aria-labelledby="evolution-cards-heading">
                <h2
                  id="evolution-cards-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Evolution cards
                </h2>
                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Enable evolution cards
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Show sprite; identify the evolution chain. Re-enabling after disabling will reset evolution-card progress.
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
                  <div className="flex flex-col gap-4">
                    {EVOLUTION_NUMERIC_FIELDS.map(({ key, label, helper, min, max }) => (
                      <div
                        key={key}
                        className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800"
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
                          value={Number(settings[key])}
                          onChange={(e) => handleChange(key, e.target.value)}
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
              </section>

              <section className="flex flex-col gap-4" aria-labelledby="reverse-evolution-heading">
                <h2
                  id="reverse-evolution-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Reverse-evolution cards
                </h2>
                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Enable reverse-evolution cards
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Quiz the opposite direction of evolution edges (&quot;Which Pokémon evolves into X via Y?&quot;).
                        Shares the same daily new/review budget as forward evolution cards.
                        Re-enabling after disabling will reset reverse-evolution progress.
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
              </section>

              <section className="flex flex-col gap-4" aria-labelledby="reverse-heading">
                <h2
                  id="reverse-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Reverse cards
                </h2>
                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Enable reverse cards
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Show the Pokémon&apos;s name as the prompt; identify the sprite on reveal.
                        Re-enabling after disabling will reset reverse-card progress.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.reverseCardsEnabled}
                      onClick={() => handleToggle("reverseCardsEnabled")}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
                        settings.reverseCardsEnabled
                          ? "bg-foreground"
                          : "bg-zinc-300 dark:bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                          settings.reverseCardsEnabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                {toggleError !== null && toggleErrorKey === "reverseCardsEnabled" && (
                  <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
                    {toggleError}
                  </p>
                )}
                {settings.reverseCardsEnabled && (
                  <>
                    {REVERSE_NUMERIC_FIELDS.map(({ key, label, helper, min, max }) => (
                      <div
                        key={key}
                        className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800"
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
                          value={Number(settings[key])}
                          onChange={(e) => handleChange(key, e.target.value)}
                          className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                        />
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {helper}
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </section>

              {/* Cry-direction cards */}
              <section className="flex flex-col gap-4" aria-labelledby="cry-heading">
                <h2
                  id="cry-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Cry → name cards
                </h2>
                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Enable cry cards
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Audio prompt — hear the cry and name the Pokémon. Species without a cry are skipped automatically.
                        Re-enabling after disabling will reset cry-card progress.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
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
              </section>

              {/* Audio section */}
              <section className="flex flex-col gap-4" aria-labelledby="audio-heading">
                <h2
                  id="audio-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Audio
                </h2>
                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Play cry on reveal
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Plays the Pokémon&apos;s cry once when you reveal a name or evolution card. Does not affect reverse cards.
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
              </section>

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

              <IntensityPicker
                value={settings.themeIntensity}
                onChange={(next) => {
                  const updated = { ...settings, themeIntensity: next };
                  setSettings(updated);
                  saveSettings(updated);
                }}
              />

              <section className="flex flex-col gap-4" aria-labelledby="about-heading">
                <h2
                  id="about-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  About
                </h2>
                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Version</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {process.env.NEXT_PUBLIC_APP_VERSION
                        ? `v${process.env.NEXT_PUBLIC_APP_VERSION}`
                        : "dev"}
                    </p>
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-4" aria-labelledby="backup-heading">
                <h2
                  id="backup-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Backup
                </h2>

                <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Export progress</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Downloads a JSON backup of all your card progress and settings.
                    </p>
                    <button
                      type="button"
                      onClick={exportProgress}
                      className="mt-3 min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                    >
                      Export
                    </button>
                  </div>

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
              </section>

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
            </div>

            {unlocked && (
              <section
                className="mt-10 rounded-xl border border-amber-300 p-5 dark:border-amber-700"
                aria-labelledby="developer-heading"
              >
                <h2
                  id="developer-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400"
                >
                  Developer
                </h2>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  QA shortcuts. While any flag here is on, sync to the cloud is
                  paused so QA state can&apos;t leak into your real data.
                  Turning off the last flag (or locking superuser mode) restores
                  cloud state for signed-in users, or offers to reset local
                  state for guests.
                </p>
                <div className="mt-4 rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
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

                <div className="mt-4 rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
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

                <div className="mt-4 rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
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
              </section>
            )}

            <section
              className="mt-10 rounded-xl border border-red-200 p-5 dark:border-red-900"
              aria-labelledby="danger-zone-heading"
            >
              <h2
                id="danger-zone-heading"
                className="text-sm font-semibold uppercase tracking-wide text-red-600 dark:text-red-400"
              >
                Danger zone
              </h2>
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
                  className="min-h-[44px] shrink-0 rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Reset all progress
                </button>
              </div>
            </section>

            <ResetProgressDialog
              open={resetOpen}
              onClose={() => setResetOpen(false)}
              onConfirm={handleReset}
            />
          </>
        )}
      </div>
    </div>
  );
}

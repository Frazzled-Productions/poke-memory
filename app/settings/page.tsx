"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
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
import { applyTheme } from "@/lib/theme/apply";
import { isMastered } from "@/lib/stats/derive";
import { SEED_POKEMON } from "@/lib/pokemon/seed";

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
  const cardStateById = useMemo(() => {
    const session = loadSession();
    return new Map((session?.cards ?? []).map((c) => [c.id, c.state]));
  }, []);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="favourite-heading">
      <h2
        id="favourite-heading"
        className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        Favourite Pokémon
      </h2>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Master a Pokémon to unlock its colour theme. Electing a favourite re-skins the whole app.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CURATED_POKEMON.map((entry) => {
          const seed = SEED_POKEMON.find((p) => p.id === entry.id);
          const state = cardStateById.get(entry.id);
          const mastered =
            state !== undefined &&
            isMastered(state, settings.masteryRepetitions);
          const selected = favouriteId === entry.id;

          return (
            <div
              key={entry.id}
              className={`relative rounded-xl border px-4 py-3 flex flex-col items-center gap-2 transition-colors ${
                mastered
                  ? "border-zinc-200 bg-background dark:border-zinc-800"
                  : "border-zinc-100 bg-zinc-50 opacity-60 dark:border-zinc-900 dark:bg-zinc-900"
              }`}
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
                  unoptimized
                />
              ) : (
                <div className="h-16 w-16" />
              )}
              <p className="text-sm font-medium text-foreground text-center">
                {entry.name}
              </p>
              {mastered ? (
                selected ? (
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
                    Set as favourite
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled
                  className="w-full min-h-[36px] rounded-lg border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-400 cursor-not-allowed dark:border-zinc-800 dark:text-zinc-600"
                >
                  Not yet mastered
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

  useEffect(() => {
    setSettings(loadSettings());
    setFavouriteId(loadFavourite()?.id ?? null);
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
    applyTheme(null);
    setFavouriteId(null);
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
    const clamped = { ...settings, ...numericClamped } as UserSettings;
    saveSettings(clamped);
    const session = loadSession();
    if (session !== null) {
      const filtered = session.cards.filter((card) => {
        if (card.cardType === "name" && !clamped.nameCardsEnabled) return false;
        if (card.cardType === "evolution" && !clamped.evolutionCardsEnabled) return false;
        if (card.cardType === "reverse" && !clamped.reverseCardsEnabled) return false;
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

              <FavouritePicker
                settings={settings}
                favouriteId={favouriteId}
                onSelect={(entry, spriteUrl) => {
                  saveFavourite(entry, spriteUrl);
                  applyTheme(entry?.colors ?? null);
                  setFavouriteId(entry?.id ?? null);
                }}
              />

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

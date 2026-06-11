"use client";

/**
 * "Mark Pokémon I already know" quiz (#1084).
 *
 * Opened from the Settings page (a Settings entry - no first-run onboarding
 * flow in this change). The user picks a generation, taps sprites for species
 * they already know, then applies. Each selected card is run through
 * `nextReview(state, Easy, now)` - the brand-new + Easy graduation path A2 in
 * `lib/srs/scheduler.ts` - producing a real graduated FSRS state with
 * `reps = 1` and a long initial interval. We never synthesise a "mastered"
 * state: mastery requires `stability >= MASTERY_STABILITY_DAYS`
 * (`lib/stats/derive.ts`) and a single tap cannot establish that stability.
 * If the user is overconfident, the next live review's Again grade demotes the
 * card on the standard FSRS curve.
 *
 * Eligibility: only `new` cards (`lastReview === null && firstSeen === null`).
 * Cards the user has already touched are excluded so a quiz pass can never
 * regress in-progress state.
 *
 * Persistence: graded cards are written via `saveSession`. Each application
 * also emits a real grade-log entry via `appendGradeEntry` so the FSRS
 * optimiser sees the signal. For authenticated users, `enqueueGrade` queues
 * each card through the standard per-grade debounced upsert path
 * (`usePerGradeSync`) - the 200 ms debounce coalesces a batch of taps into
 * one network drain per cycle, and `AutoSyncOnChange` pushes grade-log
 * entries automatically via its `GRADE_LOG_APPENDED_EVENT` listener.
 *
 * Superuser write-guard: while any superuser flag is on, the Apply button is
 * disabled with a "Sync paused (superuser)" label - same pattern as
 * `FsrsOptimizerSection`. The quiz never runs when a flag is active.
 *
 * Quiz scope: name cards only. Reverse/cry/evolution variants are out of
 * scope for the v1 quiz to keep the grid scannable; if a species is in the
 * quiz it does not also imply the user knows its cry or evolution.
 */

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { loadSettings } from "@/lib/settings/persistence";
import type { ReviewableCard, NameReviewCard } from "@/lib/review/session";
import { buildSession, DEFAULT_LIMITS } from "@/lib/review/session";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import { appendGradeEntry } from "@/lib/gradelog/persistence";
import { todayInTimezone } from "@/lib/utils/format-date";
import { generationOf, GEN_RANGES } from "@/lib/stats/derive";
import { POKEDEX_GRID_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import {
  applyKnownGrades,
  eligibleCardsForKnownQuiz,
} from "@/lib/onboarding/applyKnownGrades";
import { colStack, colStackLg, dialogPanel, mutedText, sectionLabel } from "@/lib/utils/class-names";

// ---------------------------------------------------------------------------
// KnownPokemonCard - single sprite tile in the "mark as known" grid.
//
// Extracted as its own component so `useLocalePokemonName` can be called
// unconditionally - hooks may not be called inside array maps (#1327).
// ---------------------------------------------------------------------------

type KnownPokemonCardProps = {
  card: NameReviewCard;
  selected: boolean;
  onToggle: (id: number) => void;
};

function KnownPokemonCard({ card, selected, onToggle }: KnownPokemonCardProps) {
  const tQuiz = useTranslations("onboarding.knownQuiz");
  // eslint-disable-next-line no-restricted-syntax -- displayName is the English-fallback arg to useLocalePokemonName, not a direct render
  const { name: localeName } = useLocalePokemonName(card.speciesId, card.displayName);
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={tQuiz("iAlreadyKnowAriaLabel", { name: localeName })}
        onClick={() => onToggle(card.id)}
        className={`flex w-full flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
          selected
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
            : "border-zinc-200 bg-background hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
        }`}
      >
        <Image
          src={card.spriteUrl}
          alt=""
          width={POKEDEX_GRID_SPRITE_SIZE}
          height={POKEDEX_GRID_SPRITE_SIZE}
          className="h-16 w-16 object-contain"
          loading="lazy"
          priority={false}
        />
        <span className="text-xs font-medium text-foreground">{localeName}</span>
        {selected && (
          <span className="sr-only">selected</span>
        )}
      </button>
    </li>
  );
}

type Props = {
  /**
   * Authenticated Supabase client, or null for guest mode / superuser
   * write-guard. Forwarded to `usePerGradeSync` directly so the quiz honours
   * the same null-guard semantics as `ReviewSession`.
   */
  client: SupabaseClient | null;
  /** Authenticated user id, or null in the same cases as `client`. */
  userId: string | null;
  /**
   * True when any superuser flag is on. Disables the Apply button with the
   * standard "Sync paused (superuser)" treatment.
   */
  superuserPaused: boolean;
  /**
   * Called after a successful apply (cards saved). The caller may want to
   * refresh other surfaces or surface a "done" message.
   */
  onApplied?: (gradedCount: number) => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; gradedCount: number }
  | { kind: "error"; message: string };

const DEFAULT_GEN = 1;

export function KnownPokemonQuiz({ client, userId, superuserPaused, onApplied }: Props) {
  const tQuiz = useTranslations("onboarding.knownQuiz");
  const { seed } = useSeed();
  // The quiz only writes when the user clicks Apply, so a single snapshot of
  // the session at mount is enough. Re-loading on every render would risk
  // stamping over a concurrent grade from a different tab.
  const [eligibleCards, setEligibleCards] = useState<NameReviewCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeGen, setActiveGen] = useState<number>(DEFAULT_GEN);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Per-grade sync hook - mounted at the component level so its 200 ms
  // debounce coalesces a batch of "I know this" taps into one drain.
  // When the user is a guest or any superuser flag is on, the caller passes
  // null client/userId and the hook short-circuits - same path as
  // `ReviewSession`.
  const effectiveClient = superuserPaused ? null : client;
  const effectiveUserId = superuserPaused ? null : userId;
  const { enqueueGrade } = usePerGradeSync(effectiveClient, effectiveUserId);

  const dialogRef = useRef<HTMLDialogElement>(null);

  // Load session once on mount (or once seed has loaded). When the session is
  // missing (Settings opened before Practice ever ran), fall back to building a
  // fresh seed-derived card set so the quiz can serve as a true first-touch
  // entry point.
  useEffect(() => {
    if (seed === null) return;
    const currentSeed = seed; // capture non-null reference for async closure
    let cancelled = false;
    async function load() {
      const session = await loadSession();
      if (cancelled) return;
      const settings = loadSettings();
      const opts = seedOptsFromSettings(settings);
      const cards: ReviewableCard[] = session?.cards ?? buildSession(
        currentSeed.seedPokemon,
        currentSeed.seedEvolutionCards,
        new Date(),
        opts,
      );
      // Quiz operates on name cards only - keep the grid scannable. Filtered
      // to the active pokemonNameLocale (#1851): a multi-locale session holds
      // one card per (id, locale), and the unfiltered list rendered duplicate
      // tiles with duplicate React keys, one tap selected every locale's
      // variant, and the push loop's by-id Map dropped all but the last.
      const names = cards.filter(
        (c): c is NameReviewCard =>
          c.cardType === "name" &&
          (c.locale ?? "en") === settings.pokemonNameLocale,
      );
      // Pass alternateFormsEnabled so alternate-form cards (Alolan, Galarian,
      // Mega, etc.) are excluded from the grid when the user has not enabled
      // them - matching the gate buildSessionQueues applies via isCardEligible
      // (#1481).
      setEligibleCards(eligibleCardsForKnownQuiz(names, settings.alternateFormsEnabled) as NameReviewCard[]);
      setLoaded(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [seed]);

  // Group eligible cards by generation so the tab switcher is O(1) on click.
  const cardsByGen = useMemo(() => {
    const map = new Map<number, NameReviewCard[]>();
    for (const card of eligibleCards) {
      const gen = generationOf(card.speciesId ?? card.id);
      if (gen === 0) continue;
      const bucket = map.get(gen) ?? [];
      bucket.push(card);
      map.set(gen, bucket);
    }
    // Sort each gen's cards by speciesId for a stable Pokédex order.
    for (const [, bucket] of map) {
      bucket.sort((a, b) => (a.speciesId ?? a.id) - (b.speciesId ?? b.id));
    }
    return map;
  }, [eligibleCards]);

  const activeCards = cardsByGen.get(activeGen) ?? [];
  const selectedInActive = activeCards.filter((c) => selectedIds.has(c.id)).length;
  const totalSelected = selectedIds.size;

  const toggleCard = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const markAllInActiveGen = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const card of activeCards) next.add(card.id);
      return next;
    });
    setConfirmBulkOpen(false);
  }, [activeCards]);

  const clearActiveGen = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const card of activeCards) next.delete(card.id);
      return next;
    });
  }, [activeCards]);

  // Show or hide the bulk-confirm dialog imperatively (HTMLDialogElement API).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmBulkOpen) dialog.showModal();
    else dialog.close();
  }, [confirmBulkOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleCancel(e: Event) {
      e.preventDefault();
      setConfirmBulkOpen(false);
    }
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, []);

  const handleApply = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setStatus({ kind: "saving" });

    try {
      // Re-load the latest session so the merge does not clobber any grades
      // that landed between mount and apply (e.g. a background pull). Build
      // a fresh seed-derived session when none exists yet - the quiz acts as
      // a first-touch entry point and must not depend on Practice having
      // been visited first.
      const settings = loadSettings();
      const now = new Date();
      const existing = await loadSession();
      const opts = seedOptsFromSettings(settings);
      const currentCards = existing?.cards ?? buildSession(
        seed?.seedPokemon ?? [],
        seed?.seedEvolutionCards ?? [],
        now,
        opts,
      );
      const currentLimits = existing?.limits ?? DEFAULT_LIMITS;

      const { cards: nextCards, gradedIds } = applyKnownGrades(
        currentCards,
        selectedIds,
        now,
        settings.pokemonNameLocale,
        { retentionTarget: settings.retentionTarget, weights: settings.fsrsWeights },
      );

      // Persist. saveSession dispatches a synthetic StorageEvent so other
      // surfaces re-render. Failure to persist is fatal for the apply.
      const saveResult = await saveSession({
        cards: nextCards,
        limits: currentLimits,
      });
      if (!saveResult.ok) {
        setStatus({
          kind: "error",
          message:
            "Could not save progress. Your device storage may be full. Free some space and try again.",
        });
        return;
      }

      // Emit grade-log entries and enqueue per-grade cloud upserts. Each
      // appendGradeEntry fires GRADE_LOG_APPENDED_EVENT, which
      // AutoSyncOnChange picks up to push to grade_log. enqueueGrade short
      // circuits when client/userId are null (guest or superuser pause).
      // Stamp with the user's-timezone day (#1853), matching ReviewSession's
      // handleGrade and the todayGradeSequence readers.
      const todayLocal = todayInTimezone(settings.timezone ?? "UTC", now);
      // Scoped to the active locale before keying by bare id (#1851): the
      // session still holds other locales' variants with the same numeric id,
      // and an unfiltered Map collapsed to whichever appeared last - pushing
      // the wrong locale's card_reviews row and dropping the graded one.
      const gradedCardsById = new Map(
        nextCards
          .filter((c) => (c.locale ?? "en") === settings.pokemonNameLocale)
          .map((c) => [c.id, c]),
      );
      for (const id of gradedIds) {
        const card = gradedCardsById.get(id);
        if (!card) continue;
        // appendGradeEntry is awaited individually inside the loop so an IDB
        // error on one entry does not break the others - sequential writes
        // avoid contention on the single IDB store.
        // Onboarding bulk-grades at Easy which graduates immediately;
        // learningStep and stepStartedAt are null for graduated cards (#1416).
        await appendGradeEntry({
          date: todayLocal,
          grade: 5,
          cardType: card.cardType,
          subjectKey: card.subjectKey,
          learningStep: null,
          stepStartedAt: null,
          // Carry the graded card's locale (#1851) so non-en grades no longer
          // sync to grade_log as "en" and pollute per-locale FSRS optimisation.
          locale: card.locale ?? "en",
        });
        enqueueGrade(card);
      }

      // Drop the graded cards from the local eligibility list so they
      // disappear from the grid immediately.
      setEligibleCards((prev) => prev.filter((c) => !gradedIds.includes(c.id)));
      setSelectedIds(new Set());
      setStatus({ kind: "done", gradedCount: gradedIds.length });
      onApplied?.(gradedIds.length);
    } catch (err) {
      console.error("[KnownPokemonQuiz] apply failed", err);
      setStatus({
        kind: "error",
        message: "Could not apply your selection. Try again in a moment.",
      });
    }
  }, [enqueueGrade, onApplied, selectedIds]);

  if (!loaded) {
    return (
      <p className={mutedText} aria-busy="true">
        Loading your Pokémon list...
      </p>
    );
  }

  if (eligibleCards.length === 0) {
    return (
      <p className={mutedText}>
        No new Pokémon left to mark. Every species in your deck has already been touched.
      </p>
    );
  }

  return (
    <div className={colStackLg}>
      {/* Generation switcher */}
      <fieldset className={colStack}>
        <legend className={sectionLabel}>
          Generation
        </legend>
        <div role="tablist" aria-label={tQuiz("chooseGenerationAriaLabel")} className="flex flex-wrap gap-2">
          {GEN_RANGES.map((range) => {
            const count = cardsByGen.get(range.gen)?.length ?? 0;
            const isActive = range.gen === activeGen;
            const disabled = count === 0;
            return (
              <button
                key={range.gen}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`known-quiz-grid-${range.gen}`}
                disabled={disabled}
                onClick={() => setActiveGen(range.gen)}
                className={`min-h-[36px] rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-zinc-300 bg-background text-foreground hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {range.name} ({count})
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Bulk + clear actions for the active gen */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">
          {selectedInActive} of {activeCards.length} selected in this generation,{" "}
          {totalSelected} in total.
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setConfirmBulkOpen(true)}
          disabled={activeCards.length === 0 || selectedInActive === activeCards.length}
          className="min-h-[36px] rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Mark all in this generation
        </button>
        <button
          type="button"
          onClick={clearActiveGen}
          disabled={selectedInActive === 0}
          className="min-h-[36px] rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Clear this generation
        </button>
      </div>

      {/* Sprite grid for the active gen */}
      <ul
        id={`known-quiz-grid-${activeGen}`}
        role="tabpanel"
        aria-label={tQuiz("generationSpritesAriaLabel", { name: GEN_RANGES.find((r) => r.gen === activeGen)?.name ?? "" })}
        className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6"
      >
        {activeCards.map((card) => (
          <KnownPokemonCard
            key={card.id}
            card={card}
            selected={selectedIds.has(card.id)}
            onToggle={toggleCard}
          />
        ))}
      </ul>

      {/* Apply / status row */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {superuserPaused ? (
          <button
            type="button"
            disabled
            title="Sync is paused while a superuser flag is on."
            className="min-h-[44px] rounded-lg bg-zinc-200 px-6 py-2 text-sm font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          >
            Sync paused (superuser)
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={totalSelected === 0 || status.kind === "saving"}
            aria-busy={status.kind === "saving"}
            className="min-h-[44px] rounded-lg bg-foreground px-6 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status.kind === "saving"
              ? "Applying..."
              : `Apply (${totalSelected} selected)`}
          </button>
        )}
        {status.kind === "done" && (
          <p
            role="status"
            aria-live="polite"
            className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
          >
            Marked {status.gradedCount} Pokémon as known.
          </p>
        )}
        {status.kind === "error" && (
          <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
            {status.message}
          </p>
        )}
      </div>

      {/* Bulk-confirm dialog */}
      <dialog
        ref={dialogRef}
        aria-labelledby="bulk-confirm-title"
        aria-describedby="bulk-confirm-desc"
        className={dialogPanel}
      >
        <h3 id="bulk-confirm-title" className="text-lg font-semibold text-foreground">
          Mark every Pokémon in {GEN_RANGES.find((r) => r.gen === activeGen)?.name}?
        </h3>
        <p id="bulk-confirm-desc" className={`mt-2 ${mutedText}`}>
          This will add {activeCards.length} Pokémon to your selection. You can still
          tap individual sprites to deselect them before applying.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setConfirmBulkOpen(false)}
            className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={markAllInActiveGen}
            className="min-h-[44px] rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
          >
            Mark all {activeCards.length}
          </button>
        </div>
      </dialog>
    </div>
  );
}

// Helper export for use in callers - keeps the `ReviewableCard` import surface
// small.
export type { ReviewableCard };

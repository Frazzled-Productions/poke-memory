/**
 * "Mark Pokémon I already know" quiz — pure state transition (#1084).
 *
 * The quiz lives on the Settings page. The user taps sprites for species they
 * already know, then commits the selection. Each selected card is run through
 * `nextReview(state, Easy, now)` — the brand-new + Easy graduation path (A2 in
 * `lib/srs/scheduler.ts`) — producing a real graduated FSRS state with
 * `reps = 1`, `firstSeen = today`, `lastReview = today`, and a long initial
 * interval.
 *
 * Critical correctness rule: do NOT synthesise a "mastered" state. Mastery
 * means `reps >= masteryRepetitions && scheduledDays >= 21`; a single tap
 * can't prove 21-day retention. The simulated-Easy approach lets FSRS push
 * cards toward mastery on the normal curve while leaving room for the user
 * to fall back to Again on a future review if they were overconfident.
 *
 * Eligibility: only `new` cards (`lastReview === null`). Cards the user has
 * already graded are skipped so a quiz pass cannot regress in-flight state.
 *
 * The helper is pure — no localStorage, no sync, no time source other than
 * the injected `now`. Callers are responsible for persistence and grade-log
 * emission (see `components/onboarding/KnownPokemonQuiz.tsx`).
 */

import type { ReviewableCard } from "@/lib/review/session";
import { nextReview, type NextReviewOptions } from "@/lib/srs/scheduler";
import { isCardEligible } from "@/lib/eligibility/index";

export type ApplyKnownGradesOptions = NextReviewOptions;

/**
 * True when the card has never been graded — the only state a quiz pass is
 * allowed to touch. Cards in a learning step (firstSeen set but lastReview
 * null) are also skipped: the user already started learning them and a quiz
 * pass would clobber their in-progress state.
 */
export function isEligibleForKnownQuiz(card: ReviewableCard): boolean {
  return card.state.lastReview === null && card.state.firstSeen === null;
}

/**
 * Returns the subset of `cards` that the quiz is allowed to operate on.
 * Eligibility is calculated upfront so the UI shows a stable grid while the
 * underlying session may be mutating in the background.
 *
 * When `alternateFormsEnabled` is `false` (the default), alternate-form cards
 * (species id >= 10000, e.g. Alolan Vulpix, Galarian Ponyta) are excluded from
 * the result. This mirrors the same gate applied by `buildSessionQueues` via
 * `isCardEligible` (#1481) — cards hidden from the practice queue must also be
 * hidden from the known-quiz grid so the user cannot create orphaned FSRS
 * states for cards that will never surface.
 *
 * The `isCardEligible` predicate from `lib/eligibility/index.ts` is the shared
 * single source of truth for the alternate-forms gate; we delegate to it here
 * rather than re-deriving the check.
 */
export function eligibleCardsForKnownQuiz(
  cards: readonly ReviewableCard[],
  alternateFormsEnabled: boolean = true,
): ReviewableCard[] {
  return cards.filter(
    (card) =>
      isEligibleForKnownQuiz(card) &&
      isCardEligible(
        { cardType: card.cardType, subjectKey: card.subjectKey },
        {
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: true,
          cryCardsEnabled: true,
          alternateFormsEnabled,
        },
      ),
  );
}

/**
 * Apply a simulated Easy grade to every card whose id is in `selectedIds`.
 * Returns a new array; the input is not mutated.
 *
 * - Skips cards that are not eligible (no regression of an in-progress card).
 * - Cards not in `selectedIds` are returned unchanged.
 * - The graded state comes from `nextReview(state, 5, now, options)` — the
 *   same chokepoint the live review flow uses, so retention target and FSRS
 *   weights are honoured.
 */
export function applyKnownGrades(
  cards: readonly ReviewableCard[],
  selectedIds: ReadonlySet<number>,
  now: Date,
  options: ApplyKnownGradesOptions = {},
): { cards: ReviewableCard[]; gradedIds: number[] } {
  const gradedIds: number[] = [];
  const next = cards.map((card) => {
    if (!selectedIds.has(card.id)) return card;
    if (!isEligibleForKnownQuiz(card)) return card;
    const graded = nextReview(card.state, 5, now, options);
    gradedIds.push(card.id);
    return { ...card, state: graded };
  });
  return { cards: next, gradedIds };
}

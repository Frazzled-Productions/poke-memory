import { describe, it, expect } from "vitest";
import {
  reconcileHiddenState,
  MAX_HIDDEN_SHIFT_DAYS,
} from "@/lib/review/filters";
import { EMPTY_SCOPE, type PracticeScope } from "@/lib/review/scope";
import type {
  NameReviewCard,
  ReverseReviewCard,
  ReviewableCard,
} from "@/lib/review/session";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import { initialReviewState } from "@/lib/srs/scheduler";

const NOW = new Date("2026-05-09T12:00:00Z");

// ─── fixtures ────────────────────────────────────────────────────────────

function makeSeed(id: number, types: string[]): SeedPokemon {
  return {
    id,
    name: "pkmn-" + id,
    spriteUrl: "",
    types,
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "test",
    flavorTexts: ["test"],
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: "Generic",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
  };
}

// Canonical-ish fixtures by Pokédex id — types match the games.
const BULBASAUR = makeSeed(1, ["grass", "poison"]);     // Gen I
const CHIKORITA = makeSeed(152, ["grass"]);             // Gen II

// Common scopes used across cases. Naming reads at the call site: "Gen I"
// is in-scope for Bulbasaur, "Gen II" is in-scope for Chikorita and
// out-of-scope for Bulbasaur.
const SCOPE_GEN_I: PracticeScope = { gens: [1], types: [], presets: [] };
const SCOPE_GEN_II: PracticeScope = { gens: [2], types: [], presets: [] };

function nameCardOf(seed: SeedPokemon, state: Partial<ReturnType<typeof initialReviewState>> = {}): NameReviewCard {
  return {
    ...seed,
    cardType: "name",
    state: { ...initialReviewState(NOW), ...state },
  };
}

function reverseCardOf(seed: SeedPokemon, state: Partial<ReturnType<typeof initialReviewState>> = {}): ReverseReviewCard {
  return {
    ...seed,
    id: REVERSE_ID_OFFSET + seed.id,
    pokemonId: seed.id,
    cardType: "reverse",
    state: { ...initialReviewState(NOW), ...state },
  };
}

// ─── reconcileHiddenState ────────────────────────────────────────────────

describe("reconcileHiddenState", () => {
  const TODAY = "2026-05-09";

  it("stamps hiddenSince on a graduated card that just went out of scope", () => {
    // Bulbasaur is Gen I; Gen II scope excludes it.
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-04-01",
        lastReview: "2026-05-01",
        dueDate: "2026-05-15",
        reps: 2,
      }),
    ];
    reconcileHiddenState(cards, SCOPE_GEN_II, TODAY);
    expect(cards[0].state.hiddenSince).toBe(TODAY);
    expect(cards[0].state.dueDate).toBe("2026-05-15"); // unchanged on hide
  });

  it("clears hiddenSince and shifts dueDate forward by the hidden duration when a card re-enters scope", () => {
    // Card was hidden 7 days ago; today its scope matches again.
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-04-01",
        lastReview: "2026-05-01",
        dueDate: "2026-05-10",
        reps: 2,
        hiddenSince: "2026-05-02",
      }),
    ];
    reconcileHiddenState(cards, SCOPE_GEN_I, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();
    expect(cards[0].state.dueDate).toBe("2026-05-17"); // 2026-05-10 + 7 days
  });

  it("caps the shift at MAX_HIDDEN_SHIFT_DAYS (365)", () => {
    // hiddenSince two years ago — shift must clamp to 365.
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2024-01-01",
        lastReview: "2024-01-15",
        dueDate: "2024-02-01",
        reps: 2,
        hiddenSince: "2024-05-01",
      }),
    ];
    reconcileHiddenState(cards, SCOPE_GEN_I, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();
    // 2024-02-01 + 365 days = 2025-01-31 (UTC math).
    expect(cards[0].state.dueDate).toBe("2025-01-31");
    expect(MAX_HIDDEN_SHIFT_DAYS).toBe(365);
  });

  it("clears hiddenSince without shifting dueDate when today === hiddenSince (zero-day shift)", () => {
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-04-01",
        lastReview: "2026-05-01",
        dueDate: "2026-05-15",
        reps: 2,
        hiddenSince: TODAY,
      }),
    ];
    reconcileHiddenState(cards, SCOPE_GEN_I, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();
    expect(cards[0].state.dueDate).toBe("2026-05-15");
  });

  it("clamps a future-dated hiddenSince (clock skew) to a zero-day shift, still clearing the stamp", () => {
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-04-01",
        lastReview: "2026-05-01",
        dueDate: "2026-05-15",
        reps: 2,
        hiddenSince: "2026-06-01", // > today
      }),
    ];
    reconcileHiddenState(cards, SCOPE_GEN_I, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();
    expect(cards[0].state.dueDate).toBe("2026-05-15"); // no negative shift
  });

  it("skips new cards (firstSeen === null) — no schedule to shift", () => {
    // New card, out-of-scope: leave hiddenSince null. We don't snooze a
    // card the user has never seen.
    const cards: ReviewableCard[] = [nameCardOf(BULBASAUR)];
    reconcileHiddenState(cards, SCOPE_GEN_II, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();

    // New card, in-scope: equally untouched.
    const fresh: ReviewableCard[] = [nameCardOf(BULBASAUR)];
    reconcileHiddenState(fresh, SCOPE_GEN_I, TODAY);
    expect(fresh[0].state.hiddenSince).toBeNull();
  });

  it("skips learning-step cards entirely (in-step countdown owns timing)", () => {
    // Out-of-scope + learningStep set — must NOT receive a hiddenSince stamp.
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-05-01",
        lastReview: null,
        dueDate: "2026-05-01",
        learningStep: 0,
        stepStartedAt: NOW.getTime(),
      }),
    ];
    reconcileHiddenState(cards, SCOPE_GEN_II, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();

    // In-scope + learningStep set + a stale hiddenSince — also skipped:
    // we never shift dueDate on an in-step card.
    const cards2: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-05-01",
        lastReview: null,
        dueDate: "2026-05-01",
        learningStep: 0,
        stepStartedAt: NOW.getTime(),
        hiddenSince: "2026-05-01",
      }),
    ];
    reconcileHiddenState(cards2, SCOPE_GEN_I, TODAY);
    expect(cards2[0].state.hiddenSince).toBe("2026-05-01");
    expect(cards2[0].state.dueDate).toBe("2026-05-01");
  });

  it("no-ops when a graduated card stays in scope and has no hiddenSince", () => {
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-04-01",
        lastReview: "2026-05-01",
        dueDate: "2026-05-15",
        reps: 2,
      }),
    ];
    reconcileHiddenState(cards, SCOPE_GEN_I, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();
    expect(cards[0].state.dueDate).toBe("2026-05-15");
  });

  it("empty scope never sets hiddenSince — only the un-hide branch can fire", () => {
    // Graduated card with no prior hide stamp; empty scope keeps it null.
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-04-01",
        lastReview: "2026-05-01",
        dueDate: "2026-05-15",
        reps: 2,
      }),
    ];
    reconcileHiddenState(cards, EMPTY_SCOPE, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();
  });

  it("empty scope clears a stale hiddenSince and applies the dueDate shift (user-cleared-scope path)", () => {
    // The user previously hid Bulbasaur for 7 days, then manually cleared
    // their scope. Running reconcile against EMPTY_SCOPE should treat the
    // card as in-scope and apply the shift, cleaning up the stale stamp.
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, {
        firstSeen: "2026-04-01",
        lastReview: "2026-05-01",
        dueDate: "2026-05-10",
        reps: 2,
        hiddenSince: "2026-05-02",
      }),
    ];
    reconcileHiddenState(cards, EMPTY_SCOPE, TODAY);
    expect(cards[0].state.hiddenSince).toBeNull();
    expect(cards[0].state.dueDate).toBe("2026-05-17");
  });

  it("dispatches via cardMatchesScope for reverse cards (species id resolution lives in scope.ts)", () => {
    // Bulbasaur is Gen I; SCOPE_GEN_II excludes it. The reverse card's
    // namespaced id (REVERSE_ID_OFFSET + 1) does NOT confuse the scope
    // match — `cardMatchesScope` routes evolution cards by pokemonId; the
    // name-card path uses `card.id`, and for reverse/cry that pre-existing
    // behavior is preserved (regression guard against accidental rewiring).
    const reverse = reverseCardOf(BULBASAUR, {
      firstSeen: "2026-04-01",
      lastReview: "2026-05-01",
      dueDate: "2026-05-15",
      reps: 2,
    });
    reconcileHiddenState([reverse], SCOPE_GEN_II, TODAY);
    // Pre-existing behavior of cardMatchesScope on reverse: pokemonId is
    // taken from card.id (which is namespaced). generationOf(namespaced id)
    // returns 0 — so the card is out of scope under any gens filter that
    // doesn't include 0, and ends up hidden.
    expect(reverse.state.hiddenSince).toBe(TODAY);
  });

  it("returns the mutated input array for chaining", () => {
    const cards: ReviewableCard[] = [
      nameCardOf(BULBASAUR, { firstSeen: "2026-04-01", lastReview: "2026-05-01" }),
    ];
    const returned = reconcileHiddenState(cards, SCOPE_GEN_II, TODAY);
    expect(returned).toBe(cards);
  });
});

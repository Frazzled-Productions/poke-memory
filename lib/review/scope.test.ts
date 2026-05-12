import { describe, it, expect, beforeEach } from "vitest";
import {
  cardMatchesScope,
  isScopeEmpty,
  EMPTY_SCOPE,
  loadScope,
  saveScope,
  scopeLabel,
} from "./scope";
import type { NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

function state(): ReviewState {
  return {
    stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0,
    reps: 0, lapses: 0, fsrsState: "new",
    dueDate: "2026-05-12", lastReview: null, firstSeen: null,
    learningStep: null, stepStartedAt: null,
  };
}

function nameCard(id: number, types: string[] = ["normal"]): NameReviewCard {
  return {
    id, name: `P${id}`, spriteUrl: "", types,
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "", flavorTexts: [""], evolutionChain: [],
    height: 10, weight: 100, baseExperience: 64, genus: "",
    generation: "generation-i", captureRate: 45, baseHappiness: 50,
    growthRate: "medium", habitat: null, genderRate: 0,
    isLegendary: false, isMythical: false, cryUrl: null,
    cardType: "name", state: state(),
  };
}

describe("cardMatchesScope", () => {
  it("empty scope matches every card", () => {
    expect(cardMatchesScope(nameCard(1), EMPTY_SCOPE)).toBe(true);
    expect(cardMatchesScope(nameCard(1000), EMPTY_SCOPE)).toBe(true);
  });

  it("gen filter matches cards in the listed generation", () => {
    const scope = { gens: [1], types: [], presets: [] };
    expect(cardMatchesScope(nameCard(1), scope)).toBe(true); // gen 1
    expect(cardMatchesScope(nameCard(152), scope)).toBe(false); // gen 2
  });

  it("type filter matches cards with any listed type", () => {
    const scope = { gens: [], types: ["fire"], presets: [] };
    expect(cardMatchesScope(nameCard(1, ["fire", "flying"]), scope)).toBe(true);
    expect(cardMatchesScope(nameCard(1, ["water"]), scope)).toBe(false);
  });

  it("starters preset matches Bulbasaur (1) and Snivy (495)", () => {
    const scope = { gens: [], types: [], presets: ["starters" as const] };
    expect(cardMatchesScope(nameCard(1), scope)).toBe(true);
    expect(cardMatchesScope(nameCard(495), scope)).toBe(true);
    expect(cardMatchesScope(nameCard(2), scope)).toBe(false); // Ivysaur is not a starter
  });

  it("filters are OR'd: passing any active category passes the card", () => {
    const scope = { gens: [1], types: ["water"], presets: [] };
    expect(cardMatchesScope(nameCard(1, ["grass"]), scope)).toBe(true); // gen match
    expect(cardMatchesScope(nameCard(500, ["water"]), scope)).toBe(true); // type match
    expect(cardMatchesScope(nameCard(500, ["grass"]), scope)).toBe(false); // neither
  });
});

describe("isScopeEmpty", () => {
  it("returns true for the canonical empty scope", () => {
    expect(isScopeEmpty(EMPTY_SCOPE)).toBe(true);
  });
  it("returns false once any filter is active", () => {
    expect(isScopeEmpty({ gens: [1], types: [], presets: [] })).toBe(false);
    expect(isScopeEmpty({ gens: [], types: ["fire"], presets: [] })).toBe(false);
    expect(isScopeEmpty({ gens: [], types: [], presets: ["starters"] })).toBe(false);
  });
});

describe("scopeLabel", () => {
  it("default label", () => {
    expect(scopeLabel(EMPTY_SCOPE)).toBe("All Pokémon");
  });
  it("combines categories with bullet separators", () => {
    expect(
      scopeLabel({ gens: [1], types: ["fire"], presets: ["starters"] }),
    ).toBe("Gen 1 · Fire · Starters");
  });
});

describe("loadScope / saveScope round-trip", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
    };
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: ls },
      writable: true,
    });
  });

  it("returns EMPTY_SCOPE when nothing is stored", () => {
    expect(loadScope()).toEqual(EMPTY_SCOPE);
  });

  it("survives a save → load round-trip", () => {
    const scope = { gens: [1, 3], types: ["fire"], presets: ["starters" as const] };
    saveScope(scope);
    expect(loadScope()).toEqual(scope);
  });

  it("saving the empty scope clears the key", () => {
    saveScope({ gens: [1], types: [], presets: [] });
    saveScope(EMPTY_SCOPE);
    expect(loadScope()).toEqual(EMPTY_SCOPE);
  });
});

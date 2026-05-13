import { describe, it, expect } from "vitest";
import { assignAnchors } from "./assign";
import type { HabitatZone } from "./zones";
import type { ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeState(firstSeen: string | null = null): ReviewState {
  return {
    stability: 5,
    difficulty: 3,
    elapsedDays: 0,
    scheduledDays: 21,
    reps: 3,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-06-01",
    lastReview: firstSeen ?? "2026-05-01",
    firstSeen,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

function makeCard(id: number, firstSeen: string | null = "2026-04-01"): ReviewableCard {
  return {
    id,
    cardType: "name",
    subjectKey: String(id),
    name: `Pokemon ${id}`,
    spriteUrl: `/sprites/${id}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "Test.",
    flavorTexts: ["Test."],
    evolutionChain: [],
    height: null,
    weight: null,
    baseExperience: null,
    genus: null,
    generation: null,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: makeState(firstSeen),
  } as ReviewableCard;
}

/** A small zone with 2 sub-regions and a handful of slots for easy counting. */
const tinyZone: HabitatZone = {
  habitat: "test",
  label: "Test Zone",
  subRegions: [
    {
      id: "sub-a",
      name: "Sub A",
      anchorSlots: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.3 },
        { x: 0.5, y: 0.5 },
      ],
    },
    {
      id: "sub-b",
      name: "Sub B",
      anchorSlots: [
        { x: 0.7, y: 0.1 },
        { x: 0.9, y: 0.3 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assignAnchors", () => {
  it("returns empty array for empty card input", () => {
    expect(assignAnchors([], tinyZone)).toHaveLength(0);
  });

  it("returns one assignment per card", () => {
    const cards = [makeCard(1), makeCard(2), makeCard(3)];
    const result = assignAnchors(cards, tinyZone);
    expect(result).toHaveLength(3);
  });

  it("assigns each card an anchor and sub-region reference", () => {
    const cards = [makeCard(1)];
    const [assignment] = assignAnchors(cards, tinyZone);
    expect(assignment.card).toBe(cards[0]);
    expect(assignment.subRegion).toBeDefined();
    expect(assignment.anchor).toBeDefined();
    expect(typeof assignment.anchor.x).toBe("number");
    expect(typeof assignment.anchor.y).toBe("number");
  });

  it("fills sub-regions sequentially in definition order", () => {
    // 5 slots total (3 in sub-a, 2 in sub-b). First 3 go to sub-a.
    const cards = [makeCard(1), makeCard(2), makeCard(3)];
    const result = assignAnchors(cards, tinyZone);
    expect(result[0].subRegion.id).toBe("sub-a");
    expect(result[1].subRegion.id).toBe("sub-a");
    expect(result[2].subRegion.id).toBe("sub-a");
  });

  it("transitions to next sub-region once first is full", () => {
    // 5 slots: sub-a gets first 3, sub-b gets 4th and 5th.
    const cards = [1, 2, 3, 4, 5].map((id) => makeCard(id));
    const result = assignAnchors(cards, tinyZone);
    expect(result[3].subRegion.id).toBe("sub-b");
    expect(result[4].subRegion.id).toBe("sub-b");
  });

  it("wraps on overflow: 6th card maps to slot 0 (sub-a first slot)", () => {
    // 5 total slots; 6th card wraps to index 0.
    const cards = [1, 2, 3, 4, 5, 6].map((id) => makeCard(id));
    const result = assignAnchors(cards, tinyZone);
    expect(result[5].subRegion.id).toBe("sub-a");
    expect(result[5].anchor).toEqual(tinyZone.subRegions[0].anchorSlots[0]);
  });

  it("sorts by firstSeen ASC before assigning", () => {
    // Card 99 has an earlier firstSeen — should get slot 0.
    const early = makeCard(99, "2026-01-01");
    const late = makeCard(1, "2026-04-01");
    const result = assignAnchors([late, early], tinyZone);
    expect(result[0].card.id).toBe(99);
    expect(result[1].card.id).toBe(1);
  });

  it("tie-breaks by card id when firstSeen is the same", () => {
    const sameDate = "2026-04-01";
    const cardA = makeCard(5, sameDate);
    const cardB = makeCard(3, sameDate);
    const cardC = makeCard(7, sameDate);
    const result = assignAnchors([cardC, cardA, cardB], tinyZone);
    expect(result.map((r) => r.card.id)).toEqual([3, 5, 7]);
  });

  it("null firstSeen sorts last", () => {
    const withDate = makeCard(1, "2026-04-01");
    const noDate = makeCard(2, null);
    const result = assignAnchors([noDate, withDate], tinyZone);
    expect(result[0].card.id).toBe(1);
    expect(result[1].card.id).toBe(2);
  });

  it("does not mutate the input array", () => {
    const cards = [makeCard(3, "2026-04-03"), makeCard(1, "2026-04-01")];
    const originalOrder = cards.map((c) => c.id);
    assignAnchors(cards, tinyZone);
    expect(cards.map((c) => c.id)).toEqual(originalOrder);
  });

  it("returns empty array when zone has no sub-regions", () => {
    const emptyZone: HabitatZone = {
      habitat: "void",
      label: "Void",
      subRegions: [],
    };
    expect(assignAnchors([makeCard(1)], emptyZone)).toHaveLength(0);
  });
});

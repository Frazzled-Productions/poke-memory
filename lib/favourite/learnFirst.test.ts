import { describe, it, expect } from "vitest";
import { learnFirstSpeciesIds } from "./learnFirst";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { ReviewableCard } from "@/lib/review/session";

function nameCard(id: number, firstSeen: string | null, locale = "en"): ReviewableCard {
  const seed = SEED_POKEMON.find((p) => p.id === id)!;
  return {
    ...seed,
    cardType: "name",
    subjectKey: String(id),
    locale,
    state: { ...initialReviewState(new Date("2026-01-01")), firstSeen },
  } as ReviewableCard;
}

describe("learnFirstSpeciesIds (#2187)", () => {
  it("Yes: Haunter's line is Gastly, Haunter, Gengar in chain order", () => {
    expect(learnFirstSpeciesIds(93, [], "en")).toEqual([92, 93, 94]);
  });

  it("leaves out species already introduced in the active locale", () => {
    const cards = [nameCard(92, "2026-01-02"), nameCard(93, null)];
    expect(learnFirstSpeciesIds(93, cards, "en")).toEqual([93, 94]);
  });

  it("counts an introduction only in the active locale", () => {
    const cards = [nameCard(92, "2026-01-02", "ja")];
    expect(learnFirstSpeciesIds(93, cards, "en")).toEqual([92, 93, 94]);
  });

  it("a species with no evolutions is its own line", () => {
    expect(learnFirstSpeciesIds(128, [], "en")).toEqual([128]);
  });
});

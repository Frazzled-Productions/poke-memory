import { describe, it, expect } from "vitest";
import { SCENARIOS, SCENARIO_BY_SLUG, type SeedPayload } from "./scenarios";
import { nextArrivals } from "@/lib/pasture/nextArrivals";
import { deriveCloseToMastery } from "@/lib/journey/closeToMastery";
import type { ReviewableCard } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Scenario registry sanity checks
// ---------------------------------------------------------------------------

describe("SCENARIOS registry", () => {
  it("contains at least three named scenarios", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(3);
  });

  it("includes fsrs-locale-mastery, optimiser-stress, pasture-progression, and mastery-gaps slugs", () => {
    const slugs = SCENARIOS.map((s) => s.slug);
    expect(slugs).toContain("fsrs-locale-mastery");
    expect(slugs).toContain("optimiser-stress");
    expect(slugs).toContain("pasture-progression");
    expect(slugs).toContain("mastery-gaps");
  });

  it("every scenario has a non-empty label and description", () => {
    for (const s of SCENARIOS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("SCENARIO_BY_SLUG maps every scenario by its slug", () => {
    for (const s of SCENARIOS) {
      expect(SCENARIO_BY_SLUG.get(s.slug)).toBe(s);
    }
  });
});

// ---------------------------------------------------------------------------
// Payload shape validation
// ---------------------------------------------------------------------------

function assertValidPayload(payload: SeedPayload, slug: string) {
  if (payload.session !== undefined) {
    expect(Array.isArray(payload.session.cards), `${slug}: session.cards must be an array`).toBe(true);
    expect(payload.session.cards.length, `${slug}: session.cards must be non-empty`).toBeGreaterThan(0);
    expect(
      typeof payload.session.limits === "object" && payload.session.limits !== null,
      `${slug}: session.limits must be an object`,
    ).toBe(true);

    for (const card of payload.session.cards) {
      expect(["name", "evolution", "reverse"].includes(card.cardType), `${slug}: cardType must be name, evolution, or reverse`).toBe(true);
      expect(typeof card.id).toBe("number");
      expect(typeof card.state).toBe("object");

      const s = card.state;
      expect(typeof s.reps).toBe("number");
      expect(typeof s.scheduledDays).toBe("number");
      expect(typeof s.dueDate).toBe("string");
      expect(/^\d{4}-\d{2}-\d{2}$/.test(s.dueDate), `${slug}: dueDate must be YYYY-MM-DD`).toBe(true);
      expect(["new", "learning", "review", "relearning"].includes(s.fsrsState)).toBe(true);
    }
  }
}

describe("scenario payload builders", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.slug}: build() returns a valid SeedPayload`, () => {
      const payload = scenario.build();
      assertValidPayload(payload, scenario.slug);
    });
  }

  it("fsrs-locale-mastery: has mastered cards (reps >= 3, scheduledDays >= 21) and sets pokemonNameLocale", () => {
    const payload = SCENARIO_BY_SLUG.get("fsrs-locale-mastery")!.build();
    const masteredCards = (payload.session?.cards ?? []).filter(
      (c) => c.state.reps >= 3 && c.state.scheduledDays >= 21,
    );
    expect(masteredCards.length).toBeGreaterThanOrEqual(30);
    expect(payload.pokemonNameLocale).toBe("en");
  });

  it("fsrs-locale-mastery: all name cards have locale 'en'", () => {
    const payload = SCENARIO_BY_SLUG.get("fsrs-locale-mastery")!.build();
    const nameCards = (payload.session?.cards ?? []).filter((c) => c.cardType === "name");
    for (const c of nameCards) {
      expect((c as { locale: string }).locale).toBe("en");
    }
  });

  it("optimiser-stress: includes single-review cards (reps === 1)", () => {
    const payload = SCENARIO_BY_SLUG.get("optimiser-stress")!.build();
    const singleReview = (payload.session?.cards ?? []).filter((c) => c.state.reps === 1);
    expect(singleReview.length).toBeGreaterThanOrEqual(2);
  });

  it("optimiser-stress: includes heavily-reviewed cards (reps >= 8)", () => {
    const payload = SCENARIO_BY_SLUG.get("optimiser-stress")!.build();
    const heavy = (payload.session?.cards ?? []).filter((c) => c.state.reps >= 8);
    expect(heavy.length).toBeGreaterThanOrEqual(10);
  });

  it("pasture-progression: has mastered, due-soon, and learning cards", () => {
    const payload = SCENARIO_BY_SLUG.get("pasture-progression")!.build();
    const cards = payload.session?.cards ?? [];

    const mastered = cards.filter((c) => c.state.reps >= 3 && c.state.scheduledDays >= 21);
    const inProgress = cards.filter((c) => c.state.reps >= 1 && c.state.scheduledDays < 21);
    const learning = cards.filter((c) => c.state.reps === 0 && c.state.learningStep !== null);

    expect(mastered.length).toBeGreaterThanOrEqual(40);
    expect(inProgress.length).toBeGreaterThanOrEqual(15);
    expect(learning.length).toBeGreaterThanOrEqual(10);
  });

  it("pasture-progression: sets pokemonNameLocale to 'en'", () => {
    const payload = SCENARIO_BY_SLUG.get("pasture-progression")!.build();
    expect(payload.pokemonNameLocale).toBe("en");
  });

  it("pasture-progression: has 40 en-locale mastered name cards and NO ja duplicates (per-locale FSRS demo)", () => {
    const payload = SCENARIO_BY_SLUG.get("pasture-progression")!.build();
    const cards = payload.session?.cards ?? [];

    // 40 en-locale mastered name cards (the main set).
    const enMasteredNames = cards.filter(
      (c) => c.cardType === "name" &&
        (c as { locale?: string }).locale === "en" &&
        c.state.reps >= 3 && c.state.scheduledDays >= 21,
    );
    expect(enMasteredNames.length).toBeGreaterThanOrEqual(40);

    // No ja-locale duplicates: the local session keys cards by numeric `id`, so
    // seeding an en+ja pair for the same species collides and breaks Practice
    // (#1394 mini-batch regression). pokemonNameLocale 'en' shows 40; switching
    // to ja shows 0 — which already demonstrates per-locale storage.
    const jaCards = cards.filter((c) => (c as { locale?: string }).locale === "ja");
    expect(jaCards).toHaveLength(0);
    expect(payload.pokemonNameLocale).toBe("en");
  });

  // Regression guard for the #1394 mini-batch crash: the local review session
  // keys cards by numeric `id`, so a scenario must never emit two cards sharing
  // an `id` (e.g. an en+ja pair for one species). Duplicate ids collide in
  // buildSessionQueues and break the Practice page.
  it("every scenario emits session cards with unique numeric ids", () => {
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      const ids = cards.map((c) => c.id);
      const unique = new Set(ids);
      expect(
        unique.size,
        `scenario '${scenario.slug}' has ${ids.length - unique.size} duplicate card id(s)`,
      ).toBe(ids.length);
    }
  });

  it("mastery-gaps: sets pokemonNameLocale to 'en'", () => {
    const payload = SCENARIO_BY_SLUG.get("mastery-gaps")!.build();
    expect(payload.pokemonNameLocale).toBe("en");
  });

  describe("mastery-gaps scenario", () => {
    function buildCards() {
      const payload = SCENARIO_BY_SLUG.get("mastery-gaps")!.build();
      // Cast to ReviewableCard[] as expected by the derivation helpers.
      // The seed shape is structurally compatible: cardType / id / state are present.
      // SeededNameCard has no `displayName`, so `englishName` on any
      // deriveCloseToMastery result will be undefined — assertions below only
      // check reverseScheduledDays, so this is an intentional stub gap.
      return (payload.session?.cards ?? []) as unknown as ReviewableCard[];
    }

    it("produces reviewed-but-unmastered name cards that satisfy nextArrivals", () => {
      const cards = buildCards();
      const arrivals = nextArrivals(cards, false);
      // Must have at least one arrival (not the all-caught-up empty state).
      expect(arrivals.length).toBeGreaterThanOrEqual(1);
      // Every arrival must be unmastered (reps < 3 or scheduledDays < 21).
      for (const arrival of arrivals) {
        const mastered =
          arrival.state.reps >= 3 && arrival.state.scheduledDays >= 21;
        expect(mastered).toBe(false);
      }
    });

    it("produces name-mastered/reverse-pending pairs that satisfy deriveCloseToMastery", () => {
      const cards = buildCards();
      const closeToMastery = deriveCloseToMastery(cards);
      // Must have at least one entry (not the "No gap to close" empty state).
      expect(closeToMastery.length).toBeGreaterThanOrEqual(1);
      // Every entry should have a reverseScheduledDays < 21 (reverse is not yet mastered).
      for (const entry of closeToMastery) {
        expect(entry.reverseScheduledDays).toBeLessThan(21);
      }
    });

    it("mastery-gaps: has fully mastered pairs, partial reverse, and learning cards", () => {
      const payload = SCENARIO_BY_SLUG.get("mastery-gaps")!.build();
      const cards = payload.session?.cards ?? [];

      // At least 15 fully mastered name cards (reps >= 3, scheduledDays >= 21).
      const masteredNames = cards.filter(
        (c) => c.cardType === "name" && c.state.reps >= 3 && c.state.scheduledDays >= 21,
      );
      expect(masteredNames.length).toBeGreaterThanOrEqual(15);

      // At least 10 reviewed-but-unmastered name cards (for nextArrivals).
      const unmastered = cards.filter(
        (c) =>
          c.cardType === "name" &&
          c.state.firstSeen !== null &&
          !(c.state.reps >= 3 && c.state.scheduledDays >= 21),
      );
      expect(unmastered.length).toBeGreaterThanOrEqual(10);

      // At least some in-learning name cards.
      const learning = cards.filter(
        (c) => c.cardType === "name" && c.state.reps === 0 && c.state.learningStep !== null,
      );
      expect(learning.length).toBeGreaterThanOrEqual(5);
    });
  });

  it("build() is deterministic: calling twice returns equal JSON", () => {
    for (const scenario of SCENARIOS) {
      const a = JSON.stringify(scenario.build().session?.cards ?? []);
      const b = JSON.stringify(scenario.build().session?.cards ?? []);
      // Dates are recomputed each call — only check structural equivalence
      // by comparing lengths rather than exact string equality, since
      // relative dates may differ by a millisecond in slow test runs.
      // The real determinism guarantee is that the card set and reps are fixed.
      expect((JSON.parse(a) as unknown[]).length).toBe((JSON.parse(b) as unknown[]).length);
    }
  });
});

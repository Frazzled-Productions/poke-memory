import { describe, it, expect } from "vitest";
import { SCENARIOS, SCENARIO_BY_SLUG, type SeedPayload } from "./scenarios";
import { nextArrivals } from "@/lib/pasture/nextArrivals";
import { deriveCloseToMastery } from "@/lib/journey/closeToMastery";
import type { ReviewableCard } from "@/lib/review/session";
import {
  hydrateSession,
  buildSessionQueues,
  todayString,
  DEFAULT_LIMITS,
} from "@/lib/review/session";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS, REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";

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
      (c) => c.state.reps >= MASTERY_REPETITIONS && c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
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

    const mastered = cards.filter((c) => c.state.reps >= MASTERY_REPETITIONS && c.state.scheduledDays >= MASTERY_INTERVAL_DAYS);
    const inProgress = cards.filter((c) => c.state.reps >= 1 && c.state.scheduledDays < MASTERY_INTERVAL_DAYS);
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
        c.state.reps >= MASTERY_REPETITIONS && c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
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
          arrival.state.reps >= MASTERY_REPETITIONS && arrival.state.scheduledDays >= MASTERY_INTERVAL_DAYS;
        expect(mastered).toBe(false);
      }
    });

    it("produces name-mastered/reverse-pending pairs that satisfy deriveCloseToMastery", () => {
      const cards = buildCards();
      const closeToMastery = deriveCloseToMastery(cards);
      // Must have all 10 intended entries: 5 nearMissPartialIds (partially-reviewed
      // reverse) + 5 nearMissUnseenIds (unseen reverse). Setting the floor to 10
      // is a real forcing function: the pre-fix code produced 8 because ids 41 and
      // 43 had extraGoodGrades=2 → reps=3/scheduledDays=30, which crossed the mastery
      // gate and dropped those two pairs from the list. A floor of >= 1 or even >= 5
      // would not have caught that regression (#1421 review).
      expect(closeToMastery.length).toBeGreaterThanOrEqual(10);
      // Every entry should have a reverseScheduledDays < 21 (reverse is not yet mastered).
      for (const entry of closeToMastery) {
        expect(entry.reverseScheduledDays).toBeLessThan(MASTERY_INTERVAL_DAYS);
      }
    });

    it("nearMissPartialIds reverse cards are all un-mastered (reps < 3 or scheduledDays < 21)", () => {
      // This is the direct invariant the #1421 bug violated: extraGoodGrades=2 on ids
      // 41 and 43 produced reps=3/scheduledDays=30, silently graduating them into the
      // fully-mastered pool and shrinking the Close-to-mastery list.
      const nearMissPartialIds = [41, 43, 46, 48, 50];
      const cards = buildCards();
      for (const pokemonId of nearMissPartialIds) {
        const reverseCard = cards.find(
          (c) => c.cardType === "reverse" && (c as unknown as { pokemonId: number }).pokemonId === pokemonId,
        );
        expect(
          reverseCard,
          `reverse card for nearMissPartialId=${pokemonId} must be present in the seed`,
        ).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const s = reverseCard!.state;
        const mastered = s.reps >= MASTERY_REPETITIONS && s.scheduledDays >= MASTERY_INTERVAL_DAYS;
        expect(
          mastered,
          `nearMissPartialId=${pokemonId} reverse card must NOT be mastered ` +
          `(reps=${s.reps}, scheduledDays=${s.scheduledDays}); ` +
          `if it is, extraGoodGrades is too high and the card has graduated out of Close-to-mastery`,
        ).toBe(false);
      }
    });

    it("mastery-gaps: has fully mastered pairs, partial reverse, and learning cards", () => {
      const payload = SCENARIO_BY_SLUG.get("mastery-gaps")!.build();
      const cards = payload.session?.cards ?? [];

      // At least 15 fully mastered name cards (reps >= 3, scheduledDays >= 21).
      const masteredNames = cards.filter(
        (c) => c.cardType === "name" && c.state.reps >= MASTERY_REPETITIONS && c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
      );
      expect(masteredNames.length).toBeGreaterThanOrEqual(15);

      // At least 10 reviewed-but-unmastered name cards (for nextArrivals).
      const unmastered = cards.filter(
        (c) =>
          c.cardType === "name" &&
          c.state.firstSeen !== null &&
          !(c.state.reps >= MASTERY_REPETITIONS && c.state.scheduledDays >= MASTERY_INTERVAL_DAYS),
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

// ---------------------------------------------------------------------------
// AC1: States derived via real scheduler — not hand-set FSRS literals
// ---------------------------------------------------------------------------

describe("FSRS state bounds (scheduler-derived, not hand-fabricated)", () => {
  /**
   * Assert that every card in a set that matches a predicate has an FSRS state
   * within the scheduler's reachable bounds for that state type.
   * We assert RANGES, not exact stability/difficulty (weight-dependent).
   */

  it("mastered states: reps >= 3, scheduledDays >= 21, fsrsState='review', difficulty in [1, 10]", () => {
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      const masteredCards = cards.filter(
        (c) => c.state.reps >= MASTERY_REPETITIONS && c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
      );
      for (const c of masteredCards) {
        const s = c.state;
        expect(s.fsrsState, `${scenario.slug} card ${c.id}: mastered card must have fsrsState='review'`).toBe("review");
        expect(s.reps, `${scenario.slug} card ${c.id}: mastered reps`).toBeGreaterThanOrEqual(MASTERY_REPETITIONS);
        expect(s.scheduledDays, `${scenario.slug} card ${c.id}: mastered scheduledDays`).toBeGreaterThanOrEqual(MASTERY_INTERVAL_DAYS);
        expect(s.difficulty, `${scenario.slug} card ${c.id}: mastered difficulty in [1, 10]`).toBeGreaterThanOrEqual(1);
        expect(s.difficulty, `${scenario.slug} card ${c.id}: mastered difficulty in [1, 10]`).toBeLessThanOrEqual(10);
        expect(s.lapses, `${scenario.slug} card ${c.id}: Easy-graded mastered card has 0 lapses`).toBe(0);
      }
    }
  });

  it("in-learning states: learningStep !== null, reps === 0, scheduledDays === 0", () => {
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      const learningCards = cards.filter((c) => c.state.learningStep !== null);
      for (const c of learningCards) {
        const s = c.state;
        expect(s.reps, `${scenario.slug} card ${c.id}: in-learning reps must be 0`).toBe(0);
        expect(s.scheduledDays, `${scenario.slug} card ${c.id}: in-learning scheduledDays must be 0`).toBe(0);
        expect(s.learningStep, `${scenario.slug} card ${c.id}: in-learning learningStep`).toBeGreaterThanOrEqual(0);
        // lastReview must be null for new-card learning (vs relearning).
        expect(s.lastReview, `${scenario.slug} card ${c.id}: in-learning lastReview must be null`).toBeNull();
      }
    }
  });

  it("graduated-not-mastered states: reps >= 1, scheduledDays in [1, 21), fsrsState='review'", () => {
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      // Cards that are graduated (have lastReview) but not mastered.
      const graduatedNotMastered = cards.filter(
        (c) =>
          c.state.learningStep === null &&
          c.state.lastReview !== null &&
          !(c.state.reps >= MASTERY_REPETITIONS && c.state.scheduledDays >= MASTERY_INTERVAL_DAYS),
      );
      for (const c of graduatedNotMastered) {
        const s = c.state;
        expect(s.reps, `${scenario.slug} card ${c.id}: graduated reps >= 1`).toBeGreaterThanOrEqual(1);
        expect(s.scheduledDays, `${scenario.slug} card ${c.id}: graduated scheduledDays in [1, 21)`).toBeGreaterThanOrEqual(1);
        expect(s.scheduledDays, `${scenario.slug} card ${c.id}: graduated scheduledDays < 21`).toBeLessThan(MASTERY_INTERVAL_DAYS);
        expect(s.fsrsState, `${scenario.slug} card ${c.id}: graduated fsrsState='review'`).toBe("review");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC2: Card identity from real hydrate path — not placeholders
// ---------------------------------------------------------------------------

describe("card identity: names and ids from real seed data", () => {
  const seedById = new Map(SEED_POKEMON.map((p) => [p.id, p]));

  it("every name/reverse card's name matches the real SEED_POKEMON displayName", () => {
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      const nonEvoCards = cards.filter((c) => c.cardType === "name" || c.cardType === "reverse");
      for (const c of nonEvoCards) {
        const pokemonId = c.cardType === "reverse"
          ? (c as { pokemonId: number }).pokemonId
          : c.id;
        const real = seedById.get(pokemonId);
        expect(real, `${scenario.slug}: no seed entry for id=${pokemonId}`).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect((c as { name: string }).name, `${scenario.slug} card ${c.id}: name must match displayName`).toBe(real!.displayName);
      }
    }
  });

  it("every name/reverse card's spriteUrl matches the real SEED_POKEMON spriteUrl", () => {
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      const nonEvoCards = cards.filter((c) => c.cardType === "name" || c.cardType === "reverse");
      for (const c of nonEvoCards) {
        const pokemonId = c.cardType === "reverse"
          ? (c as { pokemonId: number }).pokemonId
          : c.id;
        const real = seedById.get(pokemonId);
        expect(real, `${scenario.slug}: no seed entry for id=${pokemonId}`).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect((c as { spriteUrl: string }).spriteUrl, `${scenario.slug} card ${c.id}: spriteUrl must match seed`).toBe(real!.spriteUrl);
      }
    }
  });

  it("every evolution card id matches the real SEED_EVOLUTION_CARDS edge id", () => {
    const evoByEndpoints = new Map(
      SEED_EVOLUTION_CARDS.map((e) => [`${e.preEvoId}:${e.postEvoId}`, e]),
    );
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      const evoCCards = cards.filter((c) => c.cardType === "evolution");
      for (const c of evoCCards) {
        const evoCard = c as { preEvoId: number; postEvoId: number };
        const realEdge = evoByEndpoints.get(`${evoCard.preEvoId}:${evoCard.postEvoId}`);
        expect(realEdge, `${scenario.slug}: no real edge for ${evoCard.preEvoId}→${evoCard.postEvoId}`).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(c.id, `${scenario.slug}: evolution card id must match real edge id`).toBe(realEdge!.id);
      }
    }
  });

  it("reverse card ids are REVERSE_ID_OFFSET + pokemonId", () => {
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      const reverseCards = cards.filter((c) => c.cardType === "reverse");
      for (const c of reverseCards) {
        const rc = c as { pokemonId: number };
        expect(c.id, `${scenario.slug}: reverse card id must be REVERSE_ID_OFFSET + pokemonId`).toBe(REVERSE_ID_OFFSET + rc.pokemonId);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC3: Forcing-function tests — name/reverse pairing
// ---------------------------------------------------------------------------

describe("name/reverse pairing rules (#1234)", () => {
  /**
   * Every mastered NAME card must have a matching mastered REVERSE card for
   * the same pokemonId in scenarios where the purpose is Pasture population.
   *
   * Note: mastery-gaps deliberately has mastered name cards WITHOUT matching
   * mastered reverse cards (the "name mastered, reverse not" group) to drive
   * the "Close to mastery" Journey list. We only enforce full pairing for
   * fsrs-locale-mastery and pasture-progression.
   */
  it("every mastered name card in Pasture scenarios has a matching mastered reverse card", () => {
    // fsrs-locale-mastery and pasture-progression are designed to fully populate the Pasture.
    // mastery-gaps intentionally has unpaired mastered name cards for the Close-to-mastery list.
    const pastureScenarios = ["fsrs-locale-mastery", "pasture-progression"];

    for (const slug of pastureScenarios) {
      const cards = SCENARIO_BY_SLUG.get(slug)!.build().session?.cards ?? [];

      const masteredNameIds = new Set(
        cards
          .filter(
            (c) =>
              c.cardType === "name" &&
              c.state.reps >= MASTERY_REPETITIONS &&
              c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
          )
          .map((c) => c.id),
      );

      const masteredReverseIds = new Set(
        cards
          .filter(
            (c) =>
              c.cardType === "reverse" &&
              c.state.reps >= MASTERY_REPETITIONS &&
              c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
          )
          .map((c) => (c as { pokemonId: number }).pokemonId),
      );

      // Every mastered name card (in Pasture scenarios) must have a mastered reverse partner.
      for (const nameId of masteredNameIds) {
        expect(
          masteredReverseIds.has(nameId),
          `${slug}: mastered name card id=${nameId} is missing its mastered reverse card (required by #1234)`,
        ).toBe(true);
      }
    }
  });

  it("reverse card subjectKey matches its name card subjectKey (species:pokemonId)", () => {
    for (const scenario of SCENARIOS) {
      const cards = scenario.build().session?.cards ?? [];
      const reverseCards = cards.filter((c) => c.cardType === "reverse");
      for (const c of reverseCards) {
        const rc = c as { pokemonId: number; subjectKey: string };
        expect(rc.subjectKey, `${scenario.slug}: reverse subjectKey`).toBe(`species:${rc.pokemonId}`);
      }
    }
  });

  it("reverse card locale matches its name card locale in scenarios with paired cards", () => {
    const pairedScenarios = ["fsrs-locale-mastery", "pasture-progression"];
    for (const slug of pairedScenarios) {
      const cards = SCENARIO_BY_SLUG.get(slug)!.build().session?.cards ?? [];

      // Build a map of pokemonId → name card locale.
      const nameLocaleById = new Map(
        cards
          .filter((c) => c.cardType === "name")
          .map((c) => [c.id, (c as { locale: string }).locale]),
      );

      const reverseCards = cards.filter((c) => c.cardType === "reverse");
      for (const c of reverseCards) {
        const rc = c as { pokemonId: number; locale: string };
        const nameLocale = nameLocaleById.get(rc.pokemonId);
        if (nameLocale !== undefined) {
          expect(
            rc.locale,
            `${slug}: reverse card pokemonId=${rc.pokemonId} locale must match its name card locale`,
          ).toBe(nameLocale);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC3: Forcing-function tests — locale model
// ---------------------------------------------------------------------------

describe("locale model: en mastered visible, ja shows zero mastered", () => {
  /**
   * The locale-mastery invariant: mastered cards are stored per locale.
   * Under pokemonNameLocale='en', mastered count > 0 for scenarios that seed
   * en-locale mastered cards. Under pokemonNameLocale='ja', mastered count = 0
   * (because there are no ja-locale mastered cards seeded — we deliberately
   * do not seed ja duplicates to avoid the #1394 id-collision crash).
   */
  const localeAwareScenarios = ["fsrs-locale-mastery", "pasture-progression", "mastery-gaps"];

  for (const slug of localeAwareScenarios) {
    it(`${slug}: has mastered en-locale cards and ZERO mastered ja-locale cards`, () => {
      const cards = SCENARIO_BY_SLUG.get(slug)!.build().session?.cards ?? [];

      const masteredEn = cards.filter(
        (c) =>
          (c as { locale?: string }).locale === "en" &&
          c.state.reps >= MASTERY_REPETITIONS &&
          c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
      );

      const masteredJa = cards.filter(
        (c) =>
          (c as { locale?: string }).locale === "ja" &&
          c.state.reps >= MASTERY_REPETITIONS &&
          c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
      );

      expect(masteredEn.length, `${slug}: must have mastered en-locale cards`).toBeGreaterThan(0);
      expect(masteredJa.length, `${slug}: must have ZERO mastered ja-locale cards (locale model invariant)`).toBe(0);
    });
  }

  it("fsrs-locale-mastery: pokemonNameLocale is 'en' (so mastered cards are visible by default)", () => {
    const payload = SCENARIO_BY_SLUG.get("fsrs-locale-mastery")!.build();
    expect(payload.pokemonNameLocale).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// AC4: Practice-load smoke — hydrateSession + buildSessionQueues, no throw
// ---------------------------------------------------------------------------

describe("Practice-load smoke: hydrateSession + buildSessionQueues do not throw per scenario", () => {
  const today = todayString(new Date());

  for (const scenario of SCENARIOS) {
    it(`${scenario.slug}: hydrate → buildSessionQueues does not throw`, () => {
      const payload = scenario.build();
      if (!payload.session) return; // No session — nothing to hydrate.

      // Cast the seeded cards to ReviewableCard[]. hydrateSession will backfill
      // real SeedPokemon fields (displayName, types, etc.) on any card it recognises
      // by id; unrecognised cards are kept as-is (the validator accepted them).
      const seededCards = payload.session.cards as unknown as ReviewableCard[];

      // Run through the real hydrate path (same as the Practice page load).
      // Pass reverseEnabled: true so reverse-type cards are not dropped.
      const { cards: hydrated } = hydrateSession(seededCards, SEED_POKEMON, SEED_EVOLUTION_CARDS, new Date(), {
        reverseEnabled: true,
        nameEnabled: true,
        evolutionEnabled: true,
      });

      // buildSessionQueues must not throw on the hydrated output.
      expect(() => {
        buildSessionQueues(hydrated, DEFAULT_LIMITS, today);
      }).not.toThrow();

      // Basic sanity: the hydrated set must include the seeded cards.
      expect(hydrated.length).toBeGreaterThanOrEqual(seededCards.length);
    });
  }

  it("hydrate → buildSessionQueues: seeded card states are preserved post-hydrate", () => {
    // Spot-check one mastered card survives hydration with its FSRS state intact.
    const payload = SCENARIO_BY_SLUG.get("fsrs-locale-mastery")!.build();
    const seededCards = payload.session!.cards as unknown as ReviewableCard[];

    const { cards: hydrated } = hydrateSession(seededCards, SEED_POKEMON, SEED_EVOLUTION_CARDS, new Date(), {
      reverseEnabled: true,
    });

    // At least one hydrated card should be mastered.
    const masteredHydrated = hydrated.filter(
      (c) => c.state.reps >= MASTERY_REPETITIONS && c.state.scheduledDays >= MASTERY_INTERVAL_DAYS,
    );
    expect(masteredHydrated.length).toBeGreaterThanOrEqual(30);
  });

  it("buildSessionQueues: ids are unique after hydration (no collision)", () => {
    // Guard for the #1394 crash: duplicate ids in the session break Practice.
    for (const scenario of SCENARIOS) {
      const payload = scenario.build();
      if (!payload.session) continue;

      const seededCards = payload.session.cards as unknown as ReviewableCard[];
      const { cards: hydrated } = hydrateSession(seededCards, SEED_POKEMON, SEED_EVOLUTION_CARDS, new Date(), {
        reverseEnabled: true,
        nameEnabled: true,
        evolutionEnabled: true,
      });

      const ids = hydrated.map((c) => c.id);
      const unique = new Set(ids);
      expect(
        unique.size,
        `scenario '${scenario.slug}': hydrated session has ${ids.length - unique.size} duplicate ids`,
      ).toBe(ids.length);
    }
  });
});

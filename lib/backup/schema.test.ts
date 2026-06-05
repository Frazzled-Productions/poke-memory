import { describe, it, expect } from "vitest";
import { isBackupFile, BACKUP_VERSION } from "./schema";

// ---------------------------------------------------------------------------
// Minimal valid fixture
// ---------------------------------------------------------------------------

/** A minimal object that satisfies isBackupFile. */
function validBackup(): Record<string, unknown> {
  return {
    version: BACKUP_VERSION,
    exportedAt: "2026-05-01T12:00:00.000Z",
    cards: [
      {
        id: 1,
        state: { dueDate: "2026-05-02" },
        // no cardType → treated as default (name card)
      },
    ],
    limits: {
      name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    },
    settings: {
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
    },
  };
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("isBackupFile - valid inputs", () => {
  it("accepts a minimal valid backup object", () => {
    expect(isBackupFile(validBackup())).toBe(true);
  });

  it("accepts a backup with an empty cards array", () => {
    const b = { ...validBackup(), cards: [] };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a name card (no cardType field)", () => {
    const b = {
      ...validBackup(),
      cards: [{ id: 1, state: { dueDate: "2026-05-02" } }],
    };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a card with explicit cardType 'name'", () => {
    const b = {
      ...validBackup(),
      cards: [{ id: 1, cardType: "name", state: { dueDate: "2026-05-02" } }],
    };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a card with cardType 'reverse'", () => {
    const b = {
      ...validBackup(),
      cards: [{ id: 1, cardType: "reverse", state: { dueDate: "2026-05-02" } }],
    };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a card with cardType 'cry'", () => {
    const b = {
      ...validBackup(),
      cards: [{ id: 1, cardType: "cry", state: { dueDate: "2026-05-02" } }],
    };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a card with cardType 'reverse-evolution'", () => {
    const b = {
      ...validBackup(),
      cards: [{ id: 1, cardType: "reverse-evolution", state: { dueDate: "2026-05-02" } }],
    };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a new-edge evolution card with postEvoId", () => {
    const b = {
      ...validBackup(),
      cards: [{ id: 1, cardType: "evolution", postEvoId: 2, state: { dueDate: "2026-05-02" } }],
    };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a legacy evolution card with evolvesInto array", () => {
    const b = {
      ...validBackup(),
      cards: [
        {
          id: 1,
          cardType: "evolution",
          evolvesInto: [{ name: "Charmeleon", spriteUrl: "/sprites/5.png" }],
          state: { dueDate: "2026-05-02" },
        },
      ],
    };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a legacy evolution card with evolvesIntoNames string array", () => {
    const b = {
      ...validBackup(),
      cards: [
        {
          id: 1,
          cardType: "evolution",
          evolvesIntoNames: ["Charmeleon"],
          state: { dueDate: "2026-05-02" },
        },
      ],
    };
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a limits object without a 'reverse' key (backward-compatible)", () => {
    const b = validBackup();
    // Ensure 'reverse' is absent
    delete (b.limits as Record<string, unknown>)["reverse"];
    expect(isBackupFile(b)).toBe(true);
  });

  it("accepts a limits object that includes an optional 'reverse' key", () => {
    const b = validBackup();
    (b.limits as Record<string, unknown>)["reverse"] = { maxNewPerDay: 10, maxReviewsPerDay: 100 };
    expect(isBackupFile(b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Top-level rejection - wrong type for the root value
// ---------------------------------------------------------------------------

describe("isBackupFile - rejects non-object roots", () => {
  it("rejects null", () => {
    expect(isBackupFile(null)).toBe(false);
  });

  it("rejects a string", () => {
    expect(isBackupFile("{}")).toBe(false);
  });

  it("rejects a number", () => {
    expect(isBackupFile(42)).toBe(false);
  });

  it("rejects an array", () => {
    expect(isBackupFile([])).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isBackupFile(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tampered / wrong version
// ---------------------------------------------------------------------------

describe("isBackupFile - version field", () => {
  it("rejects when version is missing", () => {
    const b = validBackup();
    delete b["version"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects version: 0 (below current)", () => {
    expect(isBackupFile({ ...validBackup(), version: 0 })).toBe(false);
  });

  it("rejects version: 2 (future version)", () => {
    expect(isBackupFile({ ...validBackup(), version: 2 })).toBe(false);
  });

  it("rejects version as a string '1'", () => {
    expect(isBackupFile({ ...validBackup(), version: "1" })).toBe(false);
  });

  it("rejects version as null", () => {
    expect(isBackupFile({ ...validBackup(), version: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exportedAt field
// ---------------------------------------------------------------------------

describe("isBackupFile - exportedAt field", () => {
  it("rejects when exportedAt is missing", () => {
    const b = validBackup();
    delete b["exportedAt"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when exportedAt is a number", () => {
    expect(isBackupFile({ ...validBackup(), exportedAt: 123456 })).toBe(false);
  });

  it("rejects when exportedAt is null", () => {
    expect(isBackupFile({ ...validBackup(), exportedAt: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cards array
// ---------------------------------------------------------------------------

describe("isBackupFile - cards array", () => {
  it("rejects when cards is missing", () => {
    const b = validBackup();
    delete b["cards"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when cards is not an array", () => {
    expect(isBackupFile({ ...validBackup(), cards: {} })).toBe(false);
  });

  it("rejects a card with a non-numeric id", () => {
    const b = { ...validBackup(), cards: [{ id: "1", state: { dueDate: "2026-05-02" } }] };
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects a card without a state object", () => {
    const b = { ...validBackup(), cards: [{ id: 1 }] };
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects a card whose state.dueDate is not a string", () => {
    const b = { ...validBackup(), cards: [{ id: 1, state: { dueDate: 12345 } }] };
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects a card whose state is null", () => {
    const b = { ...validBackup(), cards: [{ id: 1, state: null }] };
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects an unknown cardType value", () => {
    const b = {
      ...validBackup(),
      cards: [{ id: 1, cardType: "unknown-type", state: { dueDate: "2026-05-02" } }],
    };
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects an evolution card with no postEvoId, evolvesInto, or evolvesIntoNames", () => {
    const b = {
      ...validBackup(),
      cards: [{ id: 1, cardType: "evolution", state: { dueDate: "2026-05-02" } }],
    };
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects an evolution card where evolvesInto entries are missing required fields", () => {
    const b = {
      ...validBackup(),
      cards: [
        {
          id: 1,
          cardType: "evolution",
          evolvesInto: [{ name: "Charmeleon" }], // missing spriteUrl
          state: { dueDate: "2026-05-02" },
        },
      ],
    };
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects an evolution card where evolvesIntoNames contains a non-string", () => {
    const b = {
      ...validBackup(),
      cards: [
        {
          id: 1,
          cardType: "evolution",
          evolvesIntoNames: [42],
          state: { dueDate: "2026-05-02" },
        },
      ],
    };
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when a card in the array is a primitive", () => {
    const b = { ...validBackup(), cards: [null] };
    expect(isBackupFile(b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// limits object
// ---------------------------------------------------------------------------

describe("isBackupFile - limits object", () => {
  it("rejects when limits is missing", () => {
    const b = validBackup();
    delete b["limits"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when limits is not an object", () => {
    expect(isBackupFile({ ...validBackup(), limits: [] })).toBe(false);
  });

  it("rejects when limits.name is missing", () => {
    const b = validBackup();
    delete (b.limits as Record<string, unknown>)["name"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when limits.evolution is missing", () => {
    const b = validBackup();
    delete (b.limits as Record<string, unknown>)["evolution"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when limits.name.maxNewPerDay is not a number", () => {
    const b = validBackup();
    ((b.limits as Record<string, unknown>)["name"] as Record<string, unknown>)["maxNewPerDay"] = "10";
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when limits.name.maxReviewsPerDay is missing", () => {
    const b = validBackup();
    delete ((b.limits as Record<string, unknown>)["name"] as Record<string, unknown>)["maxReviewsPerDay"];
    expect(isBackupFile(b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// settings object
// ---------------------------------------------------------------------------

describe("isBackupFile - settings object", () => {
  it("rejects when settings is missing", () => {
    const b = validBackup();
    delete b["settings"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when settings is not an object", () => {
    expect(isBackupFile({ ...validBackup(), settings: "invalid" })).toBe(false);
  });

  it("rejects when masteryRepetitions is missing", () => {
    const b = validBackup();
    delete (b.settings as Record<string, unknown>)["masteryRepetitions"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when maxNewPerDay is not a number", () => {
    const b = validBackup();
    (b.settings as Record<string, unknown>)["maxNewPerDay"] = null;
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when maxReviewsPerDay is missing", () => {
    const b = validBackup();
    delete (b.settings as Record<string, unknown>)["maxReviewsPerDay"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when maxNewEvolutionPerDay is missing", () => {
    const b = validBackup();
    delete (b.settings as Record<string, unknown>)["maxNewEvolutionPerDay"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("rejects when maxReviewsEvolutionPerDay is missing", () => {
    const b = validBackup();
    delete (b.settings as Record<string, unknown>)["maxReviewsEvolutionPerDay"];
    expect(isBackupFile(b)).toBe(false);
  });

  it("accepts settings without optional direction-related fields", () => {
    // reverseCardsEnabled and nameCardsEnabled were removed in #1234 - they are
    // no longer in UserSettings. Old backup files may still carry these fields;
    // isBackupFile tolerates extra unknown fields because isSettingsShaped only
    // checks the required numeric fields.
    const b = validBackup();
    // Simulate an old export that still has stale fields.
    (b.settings as Record<string, unknown>)["reverseCardsEnabled"] = false;
    (b.settings as Record<string, unknown>)["nameCardsEnabled"] = true;
    expect(isBackupFile(b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple cards - one invalid card invalidates the whole file
// ---------------------------------------------------------------------------

describe("isBackupFile - partial card corruption", () => {
  it("rejects when the second card in the array is malformed", () => {
    const b = {
      ...validBackup(),
      cards: [
        { id: 1, state: { dueDate: "2026-05-02" } },
        { id: "bad", state: { dueDate: "2026-05-02" } }, // id must be a number
      ],
    };
    expect(isBackupFile(b)).toBe(false);
  });

  it("accepts a multi-card backup where all cards are valid", () => {
    const b = {
      ...validBackup(),
      cards: [
        { id: 1, state: { dueDate: "2026-05-02" } },
        { id: 2, cardType: "reverse", state: { dueDate: "2026-05-03" } },
        { id: 3, cardType: "evolution", postEvoId: 5, state: { dueDate: "2026-05-04" } },
      ],
    };
    expect(isBackupFile(b)).toBe(true);
  });
});

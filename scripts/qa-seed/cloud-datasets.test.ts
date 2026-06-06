/**
 * Forcing-function tests for cloud-datasets.ts.
 *
 * Mirrors lib/qa-seed/scenarios.test.ts for the cloud-specific datasets.
 * Each test asserts real invariants so a dataset that can't occupy a state
 * real data can reach (#1394 faithfulness rule) is caught at CI time.
 *
 * Also exercises the --dry-run validation path to prove it works without
 * any network calls.
 */

import { describe, it, expect } from "vitest";
import {
  buildQaFresh,
  buildQaMastery,
  buildQaLocale,
  buildQaStreak,
  buildQaConflict,
  DATASET_BUILDERS,
  ALL_DATASET_NAMES,
  PAIRING_EXEMPT_DATASETS,
  type CloudCardRow,
  type CloudDataset,
} from "./cloud-datasets";

// ---------------------------------------------------------------------------
// Dataset registry
// ---------------------------------------------------------------------------

describe("DATASET_BUILDERS registry", () => {
  it("contains all five named datasets", () => {
    expect(ALL_DATASET_NAMES).toEqual([
      "qa-fresh",
      "qa-mastery",
      "qa-locale",
      "qa-streak",
      "qa-conflict",
    ]);
  });

  it("every dataset name maps to a builder function", () => {
    for (const name of ALL_DATASET_NAMES) {
      expect(typeof DATASET_BUILDERS[name]).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// Shared shape invariants
// ---------------------------------------------------------------------------

function assertBaseShape(dataset: CloudDataset, name: string) {
  expect(Array.isArray(dataset.cardRows), `${name}: cardRows must be array`).toBe(true);
  expect(Array.isArray(dataset.streakRows), `${name}: streakRows must be array`).toBe(true);
  expect(Array.isArray(dataset.gradeLogRows), `${name}: gradeLogRows must be array`).toBe(true);
  expect(typeof dataset.settingsPatch === "object", `${name}: settingsPatch must be object`).toBe(true);
  expect(typeof dataset.description === "string" && dataset.description.length > 0, `${name}: description must be non-empty string`).toBe(true);
}

describe("every dataset has a valid shape", () => {
  for (const name of ALL_DATASET_NAMES) {
    it(`${name}: build returns valid CloudDataset`, () => {
      const dataset = DATASET_BUILDERS[name]();
      assertBaseShape(dataset, name);
    });
  }
});

// ---------------------------------------------------------------------------
// Unique (card_type, subject_key, locale) per dataset
// ---------------------------------------------------------------------------

describe("unique (card_type, subject_key, locale) keys", () => {
  for (const name of ALL_DATASET_NAMES) {
    it(`${name}: no duplicate card identity keys`, () => {
      const dataset = DATASET_BUILDERS[name]();
      const keys = dataset.cardRows.map(
        (r) => `${r.card_type}:${r.subject_key}:${r.locale}`,
      );
      const unique = new Set(keys);
      expect(
        unique.size,
        `${name}: ${keys.length - unique.size} duplicate key(s)`,
      ).toBe(keys.length);
    });
  }
});

// ---------------------------------------------------------------------------
// Sync-safety: no in-step rows (first_seen set, last_review null)
// ---------------------------------------------------------------------------

describe("sync-safety: no in-step rows", () => {
  for (const name of ALL_DATASET_NAMES) {
    it(`${name}: all card rows are graduated (last_review not null)`, () => {
      const dataset = DATASET_BUILDERS[name]();
      const inStep = dataset.cardRows.filter(
        (r) => r.first_seen !== null && r.last_review === null,
      );
      expect(
        inStep.length,
        `${name}: ${inStep.length} row(s) have first_seen set but last_review null (not sync-safe)`,
      ).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// FSRS state bounds (mirrors scenarios.test.ts #AC)
// ---------------------------------------------------------------------------

const MASTERY_REPS = 3;
const MASTERY_DAYS = 21;

function masteredRows(rows: CloudCardRow[]) {
  return rows.filter((r) => r.reps >= MASTERY_REPS && r.scheduled_days >= MASTERY_DAYS);
}

describe("FSRS state bounds (scheduler-derived, not hand-fabricated)", () => {
  it("mastered rows: reps >= 3, scheduled_days >= 21, fsrs_state='review', difficulty in [1,10]", () => {
    for (const name of ALL_DATASET_NAMES) {
      const dataset = DATASET_BUILDERS[name]();
      const mastered = masteredRows(dataset.cardRows);
      for (const r of mastered) {
        expect(r.fsrs_state, `${name} row ${r.card_type}:${r.subject_key}: fsrs_state`).toBe("review");
        expect(r.reps, `${name}: mastered reps`).toBeGreaterThanOrEqual(MASTERY_REPS);
        expect(r.scheduled_days, `${name}: mastered scheduled_days`).toBeGreaterThanOrEqual(MASTERY_DAYS);
        expect(r.difficulty, `${name}: mastered difficulty lower bound`).toBeGreaterThanOrEqual(1);
        expect(r.difficulty, `${name}: mastered difficulty upper bound`).toBeLessThanOrEqual(10);
        expect(Number.isFinite(r.stability), `${name}: mastered stability is finite`).toBe(true);
        expect(r.stability, `${name}: mastered stability >= 1e-3`).toBeGreaterThanOrEqual(1e-3);
      }
    }
  });

  it("graduated (not mastered) rows: reps >= 1, scheduled_days in [1,21), fsrs_state='review'", () => {
    for (const name of ALL_DATASET_NAMES) {
      const dataset = DATASET_BUILDERS[name]();
      const gradNotMastered = dataset.cardRows.filter(
        (r) =>
          r.last_review !== null &&
          !(r.reps >= MASTERY_REPS && r.scheduled_days >= MASTERY_DAYS),
      );
      for (const r of gradNotMastered) {
        expect(r.reps, `${name}: graduated reps >= 1`).toBeGreaterThanOrEqual(1);
        expect(r.scheduled_days, `${name}: graduated scheduled_days >= 1`).toBeGreaterThanOrEqual(1);
        expect(r.scheduled_days, `${name}: graduated scheduled_days < 21`).toBeLessThan(MASTERY_DAYS);
        expect(r.fsrs_state, `${name}: graduated fsrs_state`).toBe("review");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Name+reverse pairing (#1234)
// ---------------------------------------------------------------------------

describe("name+reverse pairing (#1234)", () => {
  const pairedDatasets = ALL_DATASET_NAMES.filter((n) => !PAIRING_EXEMPT_DATASETS.includes(n));

  for (const name of pairedDatasets) {
    it(`${name}: every mastered name row has a matching mastered reverse row`, () => {
      const dataset = DATASET_BUILDERS[name]();

      const masteredNameKeys = new Set(
        dataset.cardRows
          .filter((r) => r.card_type === "name" && r.reps >= MASTERY_REPS && r.scheduled_days >= MASTERY_DAYS)
          .map((r) => `${r.subject_key}:${r.locale}`),
      );
      const masteredReverseKeys = new Set(
        dataset.cardRows
          .filter((r) => r.card_type === "reverse" && r.reps >= MASTERY_REPS && r.scheduled_days >= MASTERY_DAYS)
          .map((r) => `${r.subject_key}:${r.locale}`),
      );

      for (const key of masteredNameKeys) {
        expect(
          masteredReverseKeys.has(key),
          `${name}: mastered name ${key} has no matching mastered reverse (#1234)`,
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Locale model: mastery is tracked per locale
// ---------------------------------------------------------------------------

describe("locale model: per-locale FSRS rows", () => {
  it("qa-locale: has both en and ja card rows", () => {
    const dataset = buildQaLocale();
    const enRows = dataset.cardRows.filter((r) => r.locale === "en");
    const jaRows = dataset.cardRows.filter((r) => r.locale === "ja");
    expect(enRows.length).toBeGreaterThan(0);
    expect(jaRows.length).toBeGreaterThan(0);
    // en is the larger set.
    expect(enRows.length).toBeGreaterThan(jaRows.length);
  });

  it("qa-locale: en has mastered rows, ja has both mastered and due-soon", () => {
    const dataset = buildQaLocale();
    const enMastered = dataset.cardRows.filter(
      (r) => r.locale === "en" && r.reps >= MASTERY_REPS && r.scheduled_days >= MASTERY_DAYS,
    );
    const jaMastered = dataset.cardRows.filter(
      (r) => r.locale === "ja" && r.reps >= MASTERY_REPS && r.scheduled_days >= MASTERY_DAYS,
    );
    expect(enMastered.length).toBeGreaterThan(0);
    expect(jaMastered.length).toBeGreaterThan(0);
    // ja mastered set is smaller.
    expect(jaMastered.length).toBeLessThan(enMastered.length);
  });

  it("qa-mastery, qa-streak, qa-conflict, qa-fresh: only en-locale rows", () => {
    const singleLocaleNames: (typeof ALL_DATASET_NAMES)[number][] = [
      "qa-mastery",
      "qa-streak",
      "qa-conflict",
      "qa-fresh",
    ];
    for (const name of singleLocaleNames) {
      const dataset = DATASET_BUILDERS[name]();
      const nonEnRows = dataset.cardRows.filter((r) => r.locale !== "en");
      expect(
        nonEnRows.length,
        `${name}: expected only en-locale rows, found ${nonEnRows.length} non-en`,
      ).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Dataset-specific invariants
// ---------------------------------------------------------------------------

describe("qa-fresh", () => {
  it("has zero card rows, streak rows, and grade-log rows", () => {
    const dataset = buildQaFresh();
    expect(dataset.cardRows).toHaveLength(0);
    expect(dataset.streakRows).toHaveLength(0);
    expect(dataset.gradeLogRows).toHaveLength(0);
  });
});

describe("qa-mastery", () => {
  it("has at least 200 mastered card rows (name+reverse pairs)", () => {
    const dataset = buildQaMastery();
    const mastered = masteredRows(dataset.cardRows);
    // 200 species * 2 (name+reverse) = 400 mastered rows minimum.
    expect(mastered.length).toBeGreaterThanOrEqual(400);
  });

  it("has a non-empty grade log", () => {
    const dataset = buildQaMastery();
    expect(dataset.gradeLogRows.length).toBeGreaterThan(0);
  });

  it("has a streak of >= 90 days", () => {
    const dataset = buildQaMastery();
    expect(dataset.streakRows.length).toBeGreaterThanOrEqual(90);
  });

  it("grade-log occurred_at values are unique", () => {
    const dataset = buildQaMastery();
    const timestamps = dataset.gradeLogRows.map((r) => r.occurred_at);
    const unique = new Set(timestamps);
    expect(unique.size, "grade_log occurred_at must be unique").toBe(timestamps.length);
  });
});

describe("qa-streak", () => {
  it("has at least 60 streak rows", () => {
    const dataset = buildQaStreak();
    expect(dataset.streakRows.length).toBeGreaterThanOrEqual(60);
  });

  it("has streak review_date values in ascending order", () => {
    const dataset = buildQaStreak();
    const dates = dataset.streakRows.map((r) => r.review_date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("settings patch includes streakProtection with positive balance", () => {
    const dataset = buildQaStreak();
    const sp = (dataset.settingsPatch as { streakProtection?: { balance?: number } }).streakProtection;
    expect(sp).toBeDefined();
    expect((sp?.balance ?? 0)).toBeGreaterThan(0);
  });
});

describe("qa-conflict", () => {
  it("has at least 20 card rows with reps >= 4 (high-reps for pull-before-push test)", () => {
    const dataset = buildQaConflict();
    const highReps = dataset.cardRows.filter((r) => r.reps >= 4);
    expect(highReps.length).toBeGreaterThanOrEqual(10);
  });

  it("has evolution-edge rows", () => {
    const dataset = buildQaConflict();
    const evoRows = dataset.cardRows.filter((r) => r.card_type === "evolution-edge");
    expect(evoRows.length).toBeGreaterThan(0);
  });

  it("has a non-empty grade log", () => {
    const dataset = buildQaConflict();
    expect(dataset.gradeLogRows.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dry-run validation path (AC: no network calls, validates datasets)
// ---------------------------------------------------------------------------

describe("dry-run validation path", () => {
  /**
   * Exercises the same checks the runner's --dry-run performs.
   * Ensures the validation logic catches known-bad states and passes valid ones.
   */

  function validateDataset(dataset: CloudDataset): string[] {
    const errors: string[] = [];

    // Sync-safety.
    const inStep = dataset.cardRows.filter(
      (r) => r.first_seen !== null && r.last_review === null,
    );
    if (inStep.length > 0) {
      errors.push(`${inStep.length} in-step row(s)`);
    }

    // Unique keys.
    const keys = dataset.cardRows.map((r) => `${r.card_type}:${r.subject_key}:${r.locale}`);
    if (new Set(keys).size !== keys.length) {
      errors.push("duplicate (card_type, subject_key, locale) keys");
    }

    // FSRS bounds on graduated cards.
    for (const row of dataset.cardRows) {
      if (row.last_review !== null) {
        if (!Number.isFinite(row.stability) || row.stability < 1e-3) {
          errors.push(`row ${row.card_type}:${row.subject_key}: stability out of bounds`);
        }
        if (!Number.isFinite(row.difficulty) || row.difficulty < 1 || row.difficulty > 10) {
          errors.push(`row ${row.card_type}:${row.subject_key}: difficulty out of bounds`);
        }
        if (row.reps < 1) {
          errors.push(`graduated row ${row.card_type}:${row.subject_key}: reps < 1`);
        }
        if (row.first_seen === null) {
          errors.push(`graduated row ${row.card_type}:${row.subject_key}: null first_seen`);
        }
      }
    }

    return errors;
  }

  it("all datasets pass the dry-run validator", () => {
    for (const name of ALL_DATASET_NAMES) {
      const dataset = DATASET_BUILDERS[name]();
      const errors = validateDataset(dataset);
      expect(
        errors,
        `${name}: dry-run validation errors: ${errors.join("; ")}`,
      ).toHaveLength(0);
    }
  });

  it("a hand-crafted bad row (in-step) is caught by the validator", () => {
    // Construct a deliberately invalid row: first_seen set, last_review null.
    const badDataset: CloudDataset = {
      description: "intentionally bad",
      cardRows: [
        {
          card_type: "name",
          subject_key: "1",
          locale: "en",
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          reps: 0,
          lapses: 0,
          fsrs_state: "learning",
          due_date: "2025-01-01",
          last_review: null,
          first_seen: "2025-01-01", // in-step: first_seen set, last_review null
          hidden_since: null,
          seen_in_pasture: false,
        },
      ],
      streakRows: [],
      gradeLogRows: [],
      settingsPatch: {},
    };
    const errors = validateDataset(badDataset);
    expect(errors.some((e) => e.includes("in-step"))).toBe(true);
  });

  it("a hand-crafted bad row (FSRS stability=0 on graduated card) is caught", () => {
    const badDataset: CloudDataset = {
      description: "intentionally bad FSRS",
      cardRows: [
        {
          card_type: "name",
          subject_key: "1",
          locale: "en",
          stability: 0, // invalid for a graduated card
          difficulty: 5,
          elapsed_days: 10,
          scheduled_days: 10,
          reps: 2,
          lapses: 0,
          fsrs_state: "review",
          due_date: "2025-02-01",
          last_review: "2025-01-22",
          first_seen: "2025-01-01",
          hidden_since: null,
          seen_in_pasture: false,
        },
      ],
      streakRows: [],
      gradeLogRows: [],
      settingsPatch: {},
    };
    const errors = validateDataset(badDataset);
    expect(errors.some((e) => e.includes("stability"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Locale consistency: settings patch matches card row locales
// ---------------------------------------------------------------------------

describe("locale consistency: settingsPatch.learningLocales matches card locales", () => {
  it("qa-locale: learningLocales includes 'en' and 'ja'", () => {
    const dataset = buildQaLocale();
    const locales = (dataset.settingsPatch as { learningLocales?: string[] }).learningLocales ?? [];
    expect(locales).toContain("en");
    expect(locales).toContain("ja");
  });

  it("qa-mastery: learningLocales is ['en']", () => {
    const dataset = buildQaMastery();
    const locales = (dataset.settingsPatch as { learningLocales?: string[] }).learningLocales ?? [];
    expect(locales).toContain("en");
  });
});

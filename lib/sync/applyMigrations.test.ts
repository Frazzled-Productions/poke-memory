/**
 * Unit tests for applyMigrations helpers.
 *
 * Tests `numericPrefix` and the collision-detection path of
 * `sortAndValidateMigrationFiles` without hitting the filesystem or a live
 * Supabase branch.
 */

import { describe, it, expect } from "vitest";
import {
  numericPrefix,
  sortAndValidateMigrationFiles,
} from "./integration/applyMigrations";

// ---------------------------------------------------------------------------
// numericPrefix
// ---------------------------------------------------------------------------

describe("numericPrefix", () => {
  it("extracts leading integer from a standard migration filename", () => {
    expect(numericPrefix("001_initial_sync_schema.sql")).toBe(1);
    expect(numericPrefix("009_drop_legacy.sql")).toBe(9);
    expect(numericPrefix("010_card_reviews.sql")).toBe(10);
    expect(numericPrefix("100_something.sql")).toBe(100);
  });

  it("returns NaN for filenames without a numeric prefix", () => {
    expect(numericPrefix("no_prefix.sql")).toBeNaN();
    expect(numericPrefix("README.md")).toBeNaN();
    expect(numericPrefix("")).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// sortAndValidateMigrationFiles - collision detection
// ---------------------------------------------------------------------------

describe("sortAndValidateMigrationFiles", () => {
  it("throws on a new duplicate numeric prefix (not on the allow-list)", () => {
    expect(() =>
      sortAndValidateMigrationFiles([
        "001_initial.sql",
        "020_first.sql",
        "020_second.sql", // duplicate 020_ prefix - not allow-listed
        "021_later.sql",
      ]),
    ).toThrowError(/Duplicate migration prefix 20/);
  });

  it("allows the pre-existing 009_ duplicate (on the allow-list)", () => {
    // The two real 009_ files landed historically in alphabetical order; the
    // alphabetical fallback in the sort matches Supabase's applied sequence
    // (drop_legacy_per_pre_evo_evolution_rows before grade_log_card_id_and_card_types).
    expect(() =>
      sortAndValidateMigrationFiles([
        "001_initial.sql",
        "009_drop_legacy_per_pre_evo_evolution_rows.sql",
        "009_grade_log_card_id_and_card_types.sql",
        "010_card_reviews.sql",
      ]),
    ).not.toThrow();
  });

  it("does not throw when all numeric prefixes are unique", () => {
    expect(() =>
      sortAndValidateMigrationFiles([
        "003_settings.sql",
        "001_initial.sql",
        "002_trigger.sql",
      ]),
    ).not.toThrow();
  });

  it("sorts by numeric prefix, not alphabetical order", () => {
    const result = sortAndValidateMigrationFiles([
      "010_late.sql",
      "002_early.sql",
      "001_first.sql",
    ]);
    expect(result).toEqual(["001_first.sql", "002_early.sql", "010_late.sql"]);
  });

  it("sorts the allow-listed 009_ duplicates by lexicographic order (matches applied sequence)", () => {
    const result = sortAndValidateMigrationFiles([
      "009_grade_log_card_id_and_card_types.sql",
      "009_drop_legacy_per_pre_evo_evolution_rows.sql",
    ]);
    expect(result).toEqual([
      "009_drop_legacy_per_pre_evo_evolution_rows.sql",
      "009_grade_log_card_id_and_card_types.sql",
    ]);
  });
});

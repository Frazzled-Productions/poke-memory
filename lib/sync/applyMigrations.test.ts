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
// sortAndValidateMigrationFiles — collision detection
// ---------------------------------------------------------------------------

describe("sortAndValidateMigrationFiles", () => {
  it("throws when two migration files share the same numeric prefix", () => {
    expect(() =>
      sortAndValidateMigrationFiles([
        "001_initial.sql",
        "009_drop_legacy.sql",
        "009_grade_log_card_id.sql", // duplicate 009_ prefix
        "010_card_reviews.sql",
      ]),
    ).toThrowError(/Duplicate migration prefix 9/);
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
});

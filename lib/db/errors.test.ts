import { describe, expect, it } from "vitest";
import { DbError, isDbError, toDbError } from "./errors";
import { createSqliteD1 } from "./testing/sqliteD1";

describe("toDbError", () => {
  it.each([
    ["D1_ERROR: check_violation: card_reviews regression: reps cannot decrease: SQLITE_CONSTRAINT", "23514", "card_reviews regression: reps cannot decrease"],
    ["CHECK constraint failed: card_reviews_difficulty_range", "23514", "CHECK constraint failed: card_reviews_difficulty_range"],
    ["D1_ERROR: UNIQUE constraint failed: streak_days.user_id, streak_days.review_date: SQLITE_CONSTRAINT", "23505", "UNIQUE constraint failed: streak_days.user_id, streak_days.review_date"],
    ["FOREIGN KEY constraint failed", "23503", "FOREIGN KEY constraint failed"],
    ["NOT NULL constraint failed: grade_log.grade", "23502", "NOT NULL constraint failed: grade_log.grade"],
    ["D1_ERROR: no such column: nope: SQLITE_ERROR", "42703", "no such column: nope"],
    ["table card_reviews has no column named nope", "42703", "table card_reviews has no column named nope"],
    ["D1_ERROR: no such table: nope: SQLITE_ERROR", "42P01", "no such table: nope"],
    ["too many SQL variables", "54000", "too many SQL variables"],
    ["D1_ERROR: something else", "XX000", "something else"],
  ])("maps %j to %s", (raw, code, message) => {
    const err = toDbError(new Error(raw));
    expect(err).toBeInstanceOf(DbError);
    expect(err.toJSON()).toEqual({ code, message, details: null, hint: null });
  });

  it("passes a DbError through and accepts non-Error values", () => {
    const original = new DbError("42501", "nope", { details: "d", hint: "h" });
    expect(toDbError(original)).toBe(original);
    expect(original.toJSON()).toEqual({ code: "42501", message: "nope", details: "d", hint: "h" });
    expect(toDbError("plain string").code).toBe("XX000");
    expect(isDbError(original)).toBe(true);
    expect(isDbError(new Error("x"))).toBe(false);
  });

  it("maps real SQLite errors from the schema", async () => {
    const d1 = createSqliteD1();
    const codeOf = async (sql: string) => {
      try {
        await d1.prepare(sql).run();
        return "ok";
      } catch (err) {
        return toDbError(err).code;
      }
    };
    expect(await codeOf("INSERT INTO streak_days (user_id, review_date) VALUES ('x', '2020-01-01')")).toBe("23503");
    expect(await codeOf("INSERT INTO feedback (category, message) VALUES ('nope', 'x')")).toBe("23514");
    expect(await codeOf("INSERT INTO feedback (category) VALUES ('bug')")).toBe("23502");
    expect(await codeOf("SELECT nope FROM feedback")).toBe("42703");
    expect(await codeOf("SELECT * FROM nope")).toBe("42P01");
    d1.close();
  });
});

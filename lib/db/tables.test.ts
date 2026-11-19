import { afterAll, describe, expect, it } from "vitest";
import { DbError } from "./errors";
import { PROTECTED_TABLES, TABLES, columnType, getTable, type ColumnType } from "./tables";
import { createSqliteD1 } from "./testing/sqliteD1";

const d1 = createSqliteD1();
afterAll(() => d1.close());

type ColumnInfo = { name: string; type: string; pk: number };

function sqliteColumns(table: string): ColumnInfo[] {
  return d1.sqlite.prepare(`PRAGMA table_info("${table}")`).all() as ColumnInfo[];
}

const SQLITE_AFFINITY: Record<ColumnType, string> = {
  text: "TEXT",
  date: "TEXT",
  timestamp: "TEXT",
  json: "TEXT",
  int: "INTEGER",
  bool: "INTEGER",
  real: "REAL",
};

/** Column sets of every UNIQUE index (PRIMARY KEY and UNIQUE constraints). */
function uniqueKeys(table: string): string[][] {
  const indexes = d1.sqlite.prepare(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number }[];
  const keys = indexes
    .filter((i) => i.unique === 1)
    .map((i) =>
      (d1.sqlite.prepare(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]).map((c) => c.name),
    );
  const pk = sqliteColumns(table)
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  return [...keys, pk];
}

describe("tables.ts matches db/d1/migrations", () => {
  for (const def of Object.values(TABLES)) {
    it(`${def.name}: same columns and storage types`, () => {
      const actual = Object.fromEntries(sqliteColumns(def.name).map((c) => [c.name, c.type]));
      const expected = Object.fromEntries(
        Object.entries(def.columns).map(([name, type]) => [name, SQLITE_AFFINITY[type]]),
      );
      expect(actual).toEqual(expected);
    });

    it(`${def.name}: primary key and conflict keys are real unique keys that include the user column`, () => {
      const keys = uniqueKeys(def.name).map((k) => [...k].sort().join(","));
      expect(keys).toContain([...def.primaryKey].sort().join(","));
      for (const key of def.conflictKeys) {
        expect(key).toContain(def.userColumn);
        expect(keys).toContain([...key].sort().join(","));
      }
      expect(Object.keys(def.columns)).toContain(def.userColumn);
    });
  }

  it("every protected table exists", () => {
    for (const table of PROTECTED_TABLES) {
      expect([table, sqliteColumns(table).length > 0]).toEqual([table, true]);
    }
  });

  it("every scoped table is protected", () => {
    for (const table of Object.keys(TABLES)) expect(PROTECTED_TABLES).toContain(table);
  });

  it("the gateway tables are the five the browser used under RLS (design D5)", () => {
    expect(
      Object.values(TABLES)
        .filter((t) => t.gateway)
        .map((t) => t.name)
        .sort(),
    ).toEqual(["card_reviews", "grade_log", "push_subscriptions", "streak_days", "user_settings"]);
  });
});

describe("getTable / columnType", () => {
  it("refuses an unknown table with 42P01, including prototype keys", () => {
    for (const name of ["nope", "rate_limit_buckets", "user", "__proto__", "constructor"]) {
      expect(() => getTable(name)).toThrow(expect.objectContaining({ code: "42P01" }));
    }
  });

  it("refuses an unknown column with 42703", () => {
    const table = getTable("card_reviews");
    expect(columnType(table, "reps")).toBe("int");
    expect(() => columnType(table, "toString")).toThrow(DbError);
    expect(() => columnType(table, "password")).toThrow(expect.objectContaining({ code: "42703" }));
  });
});

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { compareCounts, countQuery, parseBackupHeader } from "./check-restore.mjs";

const BACKUP = `-- poke-memory D1 backup
-- created: 2026-11-20T02:00:03.120Z
-- rows user: 2
-- rows card_reviews: 3
-- rows feedback: 0

INSERT INTO "user" ("id") VALUES ('a');
-- rows grade_log: 99
`;

describe("parseBackupHeader", () => {
  it("reads every rows line in the header, including empty tables", () => {
    expect([...parseBackupHeader(BACKUP)]).toEqual([
      ["user", 2],
      ["card_reviews", 3],
      ["feedback", 0],
    ]);
  });

  it("stops at the first statement, so a comment in the data is not a count", () => {
    expect(parseBackupHeader(BACKUP).has("grade_log")).toBe(false);
  });

  it("refuses a file with no counts", () => {
    expect(() => parseBackupHeader("INSERT INTO t VALUES (1);\n")).toThrow(/no `-- rows/);
  });

  it("refuses a table named twice", () => {
    expect(() => parseBackupHeader("-- rows user: 1\n-- rows user: 2\n")).toThrow(/twice/);
  });
});

describe("compareCounts", () => {
  const expected = new Map([
    ["user", 2],
    ["card_reviews", 3],
  ]);

  it("passes when every count matches", () => {
    expect(compareCounts(expected, new Map([["user", 2], ["card_reviews", 3]]))).toEqual([]);
  });

  it("reports a short table and a missing table", () => {
    expect(compareCounts(expected, new Map([["user", 1]]))).toEqual([
      "user: header says 2, restored 1",
      "card_reviews: missing from the restored database",
    ]);
  });
});

describe("countQuery", () => {
  it("counts every table in one statement", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE "user" (id TEXT); CREATE TABLE card_reviews (id TEXT);
      INSERT INTO "user" VALUES ('a'), ('b'); INSERT INTO card_reviews VALUES ('x');`);
    expect({ ...db.prepare(countQuery(["user", "card_reviews"])).get() }).toEqual({ c0: 2, c1: 1 });
  });
});

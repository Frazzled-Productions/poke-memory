/**
 * Tests for GET /api/export on D1: authentication guard, CSV shape, Pokémon
 * name resolution, database error handling and two-user isolation, against
 * the D1 test database through forUser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

const { getCloudflareContext, requireAuth } = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth }));

// Minimal seed data so name resolution is deterministic in tests without
// pulling in the full generated.json.
vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [
    { id: 1,   displayName: "Bulbasaur" },
    { id: 25,  displayName: "Pikachu" },
    { id: 133, displayName: "Eevee" },
    { id: 134, displayName: "Vaporeon" },
  ],
  SEED_EVOLUTION_CARDS: [],
}));

import { GET } from "./route";
import { forUser } from "@/lib/db/scope";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { spyD1 } from "@/lib/db/testing/spyD1";

type GradeLogRow = {
  occurred_at: number;
  entry_date: string;
  card_type: string;
  grade: number;
  subject_key: string;
};

let d1: SqliteD1;
let alice: string;
let bob: string;
let sessionUser: string | null;
let occurred = 1_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
  sessionUser = alice;
  getCloudflareContext.mockResolvedValue({ env: { DB: d1 } });
  requireAuth.mockImplementation(async () =>
    sessionUser ? { user: { id: sessionUser } } : NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
});
afterEach(() => d1.close());

async function seedGradeLog(userId: string, partial: Partial<GradeLogRow>[]) {
  if (partial.length === 0) return;
  await forUser(d1, userId).insert(
    "grade_log",
    partial.map((r) => ({
      occurred_at: occurred++,
      entry_date: "2026-01-01",
      card_type: "name",
      grade: 4,
      subject_key: "1",
      locale: "en",
      ...r,
    })),
  );
}

const request = () => new Request("http://localhost/api/export");

/** Reads the response body text and splits into lines, stripping empty lines. */
async function csvLines(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split("\r\n").filter((l) => l !== "");
}

describe("GET /api/export", () => {
  it("returns 401 when the user is not authenticated", async () => {
    sessionUser = null;
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 503 when the database query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getCloudflareContext.mockResolvedValue({
      env: {
        DB: spyD1(d1, {
          before: () => {
            throw new Error("D1_ERROR: unavailable");
          },
        }),
      },
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  it("returns 503 when there is no D1 binding", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getCloudflareContext.mockResolvedValue({ env: {} });
    const response = await GET(request());
    expect(response.status).toBe(503);
  });

  it("returns a CSV with the correct Content-Type and a dated attachment filename", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="poke-memory-reviews-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
  });

  it("returns an empty CSV (header only) when there are no grade_log rows", async () => {
    const lines = await csvLines(await GET(request()));
    expect(lines).toEqual(["date,pokemon,card_type,grade,grade_label"]);
  });

  it("resolves species subject_key to a Pokémon display name", async () => {
    await seedGradeLog(alice, [{ card_type: "name", subject_key: "25", grade: 4, entry_date: "2026-03-10" }]);
    const lines = await csvLines(await GET(request()));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("2026-03-10,Pikachu,name,4,Good");
  });

  it("resolves evolution-edge subject_key to a 'From -> To' label", async () => {
    await seedGradeLog(alice, [{ card_type: "evolution-edge", subject_key: "133>>>134", grade: 5 }]);
    const lines = await csvLines(await GET(request()));
    expect(lines[1]).toBe("2026-01-01,Eevee -> Vaporeon,evolution,5,Easy");
  });

  it("maps reverse-evolution-edge card_type to 'reverse-evolution' in the CSV", async () => {
    await seedGradeLog(alice, [{ card_type: "reverse-evolution-edge", subject_key: "133>>>134", grade: 2 }]);
    const lines = await csvLines(await GET(request()));
    expect(lines[1]).toContain(",reverse-evolution,2,Hard");
  });

  it("falls back to subject_key verbatim for unknown species IDs", async () => {
    await seedGradeLog(alice, [{ card_type: "name", subject_key: "99999999" }]);
    const lines = await csvLines(await GET(request()));
    expect(lines[1]).toContain("99999999");
  });

  it("includes all four grade labels: Again, Hard, Good, Easy", async () => {
    await seedGradeLog(alice, [{ grade: 1 }, { grade: 2 }, { grade: 4 }, { grade: 5 }]);
    const lines = await csvLines(await GET(request()));
    expect(lines.slice(1).map((l) => l.split(",")[4])).toEqual(["Again", "Hard", "Good", "Easy"]);
  });

  it("orders rows by entry_date, then occurred_at", async () => {
    await seedGradeLog(alice, [
      { entry_date: "2026-02-01", occurred_at: 5, subject_key: "1" },
      { entry_date: "2026-01-01", occurred_at: 9, subject_key: "25" },
      { entry_date: "2026-01-01", occurred_at: 7, subject_key: "133" },
    ]);
    const lines = await csvLines(await GET(request()));
    expect(lines.slice(1).map((l) => l.split(",")[1])).toEqual(["Eevee", "Pikachu", "Bulbasaur"]);
  });

  it("exports every row, past the old 1000-row page size", async () => {
    await seedGradeLog(alice, Array.from({ length: 1205 }, () => ({})));
    const lines = await csvLines(await GET(request()));
    expect(lines).toHaveLength(1206);
  });

  it("sets Cache-Control: no-store on the response", async () => {
    const response = await GET(request());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("escapes a field value that contains a double-quote (RFC 4180)", async () => {
    await seedGradeLog(alice, [{ card_type: "name", subject_key: 'say "hello"' }]);
    const lines = await csvLines(await GET(request()));
    expect(lines[1]).toContain('"say ""hello"""');
  });

  it("escapes a field value that contains a carriage return (RFC 4180)", async () => {
    await seedGradeLog(alice, [{ card_type: "name", subject_key: "foo\rbar" }]);
    const lines = await csvLines(await GET(request()));
    expect(lines[1]).toContain('"foo\rbar"');
  });

  it("prepends a UTF-8 BOM to the CSV output", async () => {
    const bytes = new Uint8Array(await (await GET(request())).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("two users: each export holds only the session user's rows", async () => {
    await seedGradeLog(alice, [{ subject_key: "25" }]);
    await seedGradeLog(bob, [{ subject_key: "133" }, { subject_key: "134" }]);
    const aliceLines = await csvLines(await GET(request()));
    sessionUser = bob;
    const bobLines = await csvLines(await GET(request()));
    expect(aliceLines.slice(1).map((l) => l.split(",")[1])).toEqual(["Pikachu"]);
    expect(bobLines.slice(1).map((l) => l.split(",")[1])).toEqual(["Eevee", "Vaporeon"]);
  });
});

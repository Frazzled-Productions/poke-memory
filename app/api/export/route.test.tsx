/**
 * Tests for GET /api/export
 *
 * Verifies authentication guard, CSV shape, Pokémon name resolution,
 * and Supabase error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks - factories must not reference outer variables (hoisting rule).
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

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

// ---------------------------------------------------------------------------
// Import after mocks.
// ---------------------------------------------------------------------------
import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GradeLogRow = {
  occurred_at: number;
  entry_date: string;
  card_type: string;
  grade: number;
  subject_key: string | null;
};

function makeGradeLogRows(partial: Partial<GradeLogRow>[] = []): GradeLogRow[] {
  return partial.map((r, i) => ({
    occurred_at: 1_000_000 + i,
    entry_date: "2026-01-01",
    card_type: "name",
    grade: 4,
    subject_key: "1",
    ...r,
  }));
}

function makeSupabaseMock(overrides: {
  gradeLogData?: GradeLogRow[] | null;
  gradeLogError?: unknown;
  user?: { id: string } | null;
} = {}) {
  // The grade_log query chains: .select().eq().order().order()
  const innerOrderMock = vi.fn().mockResolvedValue({
    data: overrides.gradeLogData !== undefined ? overrides.gradeLogData : makeGradeLogRows(),
    error: overrides.gradeLogError ?? null,
  });

  const gradeLogChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnValue({
      order: innerOrderMock,
    }),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === "grade_log") return gradeLogChain;
    throw new Error(`Unexpected table: ${table}`);
  });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: overrides.user !== undefined ? overrides.user : { id: "user-test-123" } },
        error: overrides.user === null ? new Error("no session") : null,
      }),
    },
    from: fromMock,
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { client, fromMock, innerOrderMock };
}

/** Reads the response body text and splits into lines, stripping empty lines. */
async function csvLines(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split("\r\n").filter((l) => l !== "");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the user is not authenticated", async () => {
    makeSupabaseMock({ user: null });

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 503 when the Supabase query errors", async () => {
    makeSupabaseMock({ gradeLogError: new Error("db error"), gradeLogData: null });

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("service_unavailable");
  });

  it("returns a CSV with the correct Content-Type header", async () => {
    makeSupabaseMock({ gradeLogData: [] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
  });

  it("sets Content-Disposition attachment header with a dated filename", async () => {
    makeSupabaseMock({ gradeLogData: [] });

    const response = await GET();
    const disposition = response.headers.get("Content-Disposition") ?? "";

    expect(disposition).toMatch(/attachment;\s*filename="poke-memory-reviews-\d{4}-\d{2}-\d{2}\.csv"/);
  });

  it("returns an empty CSV (header only) when there are no grade_log rows", async () => {
    makeSupabaseMock({ gradeLogData: [] });

    const response = await GET();
    const lines = await csvLines(response);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("date,pokemon,card_type,grade,grade_label");
  });

  it("resolves species subject_key to a Pokémon display name", async () => {
    makeSupabaseMock({
      gradeLogData: makeGradeLogRows([
        { card_type: "name", subject_key: "25", grade: 4, entry_date: "2026-03-10" },
      ]),
    });

    const response = await GET();
    const lines = await csvLines(response);

    // lines[0] is the header; lines[1] is the data row.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Pikachu");
    expect(lines[1]).toContain("name");
    expect(lines[1]).toContain("Good");
  });

  it("resolves evolution-edge subject_key to a 'From -> To' label", async () => {
    makeSupabaseMock({
      gradeLogData: makeGradeLogRows([
        { card_type: "evolution-edge", subject_key: "133>>>134", grade: 5 },
      ]),
    });

    const response = await GET();
    const lines = await csvLines(response);

    expect(lines[1]).toContain("Eevee -> Vaporeon");
    expect(lines[1]).toContain("evolution");
    expect(lines[1]).toContain("Easy");
  });

  it("maps reverse-evolution-edge card_type to 'reverse-evolution' in the CSV", async () => {
    makeSupabaseMock({
      gradeLogData: makeGradeLogRows([
        { card_type: "reverse-evolution-edge", subject_key: "133>>>134", grade: 2 },
      ]),
    });

    const response = await GET();
    const lines = await csvLines(response);

    expect(lines[1]).toContain("reverse-evolution");
    expect(lines[1]).toContain("Hard");
  });

  it("falls back to subject_key verbatim for unknown species IDs", async () => {
    makeSupabaseMock({
      gradeLogData: makeGradeLogRows([
        { card_type: "name", subject_key: "99999999" }, // not in mocked seed
      ]),
    });

    const response = await GET();
    const lines = await csvLines(response);

    expect(lines[1]).toContain("99999999");
  });

  it("outputs an empty pokemon field when subject_key is null", async () => {
    makeSupabaseMock({
      gradeLogData: makeGradeLogRows([
        { card_type: "name", subject_key: null },
      ]),
    });

    const response = await GET();
    const lines = await csvLines(response);

    // null subject_key resolves to "" - the pokemon column is empty.
    const fields = lines[1].split(",");
    // date,pokemon,card_type,grade,grade_label → index 1 is pokemon
    expect(fields[1]).toBe("");
  });

  it("includes all four grade labels: Again, Hard, Good, Easy", async () => {
    makeSupabaseMock({
      gradeLogData: makeGradeLogRows([
        { grade: 1 },
        { grade: 2 },
        { grade: 4 },
        { grade: 5 },
      ]),
    });

    const response = await GET();
    const lines = await csvLines(response);

    const dataLines = lines.slice(1);
    expect(dataLines.some((l) => l.includes("Again"))).toBe(true);
    expect(dataLines.some((l) => l.includes("Hard"))).toBe(true);
    expect(dataLines.some((l) => l.includes("Good"))).toBe(true);
    expect(dataLines.some((l) => l.includes("Easy"))).toBe(true);
  });

  it("sets Cache-Control: no-store on the response", async () => {
    makeSupabaseMock({ gradeLogData: [] });

    const response = await GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("escapes a field value that contains a double-quote (RFC 4180)", async () => {
    makeSupabaseMock({
      // Inject a custom subject_key that will fail species parsing (non-numeric)
      // and be used verbatim - the verbatim value contains a double-quote to
      // test csvField quoting.
      gradeLogData: makeGradeLogRows([
        { card_type: "name", subject_key: 'say "hello"' },
      ]),
    });

    const response = await GET();
    const lines = await csvLines(response);

    // The field with a double-quote must be wrapped and inner quotes doubled.
    expect(lines[1]).toContain('"say ""hello"""');
  });

  it("escapes a field value that contains a carriage return (RFC 4180)", async () => {
    makeSupabaseMock({
      gradeLogData: makeGradeLogRows([
        { card_type: "name", subject_key: "foo\rbar" },
      ]),
    });

    const response = await GET();
    const lines = await csvLines(response);

    // A field with \r must be wrapped in double-quotes per RFC 4180.
    expect(lines[1]).toContain('"foo\rbar"');
  });

  it("prepends a UTF-8 BOM to the CSV output", async () => {
    makeSupabaseMock({ gradeLogData: [] });

    const response = await GET();

    // Read as raw bytes: UTF-8 BOM is the three-byte sequence EF BB BF.
    // response.text() strips the BOM per the Encoding spec, so we check
    // the ArrayBuffer directly.
    const buf = await response.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
  });

  it("returns 503 when Supabase client construction fails", async () => {
    (createClient as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Your project's URL and Key are required"),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("service_unavailable");
  });
});

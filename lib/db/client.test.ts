/**
 * The browser data client (lib/db/client.ts): what it sends and how it maps
 * every answer, including failures, to { data, error, count } without
 * throwing.
 */
import { describe, expect, it, vi } from "vitest";
import { createDataClient, NETWORK_ERROR_CODE } from "./client";

function recordingFetch(status = 200, body: unknown = { data: [], error: null, count: null }) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("what the client sends", () => {
  it("a select chain becomes one POST to /api/db with the wire format", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const db = createDataClient({ fetch: fetchImpl });
    await db
      .from("card_reviews")
      .select("card_type, subject_key ,locale")
      .eq("user_id", "u1")
      .neq("locale", "ja")
      .gt("reps", 1)
      .gte("due_date", "2026-01-01")
      .lt("lapses", 3)
      .lte("stability", 9)
      .in("subject_key", ["1", "2"])
      .is("hidden_since", null)
      .not("last_review", "is", null)
      .order("card_type", { ascending: true })
      .order("subject_key", { ascending: false, nullsFirst: true })
      .range(0, 999);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/db");
    expect(calls[0].init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(calls[0].body).toEqual({
      kind: "select",
      table: "card_reviews",
      columns: ["card_type", "subject_key", "locale"],
      filters: [
        { column: "user_id", op: "eq", value: "u1" },
        { column: "locale", op: "neq", value: "ja" },
        { column: "reps", op: "gt", value: 1 },
        { column: "due_date", op: "gte", value: "2026-01-01" },
        { column: "lapses", op: "lt", value: 3 },
        { column: "stability", op: "lte", value: 9 },
        { column: "subject_key", op: "in", value: ["1", "2"] },
        { column: "hidden_since", op: "is", value: null },
        { column: "last_review", op: "not-is", value: null },
      ],
      order: [
        { column: "card_type", ascending: true },
        { column: "subject_key", ascending: false, nullsFirst: true },
      ],
      range: [0, 999],
    });
  });

  it("select('*') with count/head, limit, maybeSingle and single", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const db = createDataClient({ fetch: fetchImpl, baseUrl: "https://example.test" });
    await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", "u").limit(1);
    await db.from("user_settings").select("*").maybeSingle();
    await db.from("user_settings").select().single();
    expect(calls[0].url).toBe("https://example.test/api/db");
    expect(calls[0].body).toEqual({
      kind: "select",
      table: "push_subscriptions",
      columns: ["id"],
      filters: [{ column: "user_id", op: "eq", value: "u" }],
      limit: 1,
      count: "exact",
      head: true,
    });
    expect(calls[1].body).toEqual({ kind: "select", table: "user_settings", columns: "*", single: "maybe" });
    expect(calls[2].body).toEqual({ kind: "select", table: "user_settings", columns: "*", single: "one" });
  });

  it("upsert, insert, update, delete and rpc", async () => {
    const { fetchImpl, calls } = recordingFetch(200, { data: null, error: null });
    const db = createDataClient({ fetch: fetchImpl });
    await db.from("streak_days").upsert([{ review_date: "2026-01-01" }], { onConflict: "user_id,review_date", ignoreDuplicates: true });
    await db.from("card_reviews").upsert({ subject_key: "1" }, { onConflict: "user_id,card_type,subject_key,locale" });
    await db.from("push_subscriptions").insert({ endpoint: "e" });
    await db.from("user_settings").update({ timezone: "UTC" }).eq("user_id", "u");
    await db.from("push_subscriptions").delete().eq("user_id", "u").eq("endpoint", "e");
    await db.rpc("merge_user_settings", { p_user_id: "u", p_patch: { a: null } });
    await db.rpc("reset_all_progress");
    expect(calls.map((c) => c.body)).toEqual([
      { kind: "upsert", table: "streak_days", rows: [{ review_date: "2026-01-01" }], onConflict: "user_id,review_date", ignoreDuplicates: true },
      { kind: "upsert", table: "card_reviews", rows: { subject_key: "1" }, onConflict: "user_id,card_type,subject_key,locale" },
      { kind: "insert", table: "push_subscriptions", rows: { endpoint: "e" } },
      { kind: "update", table: "user_settings", values: { timezone: "UTC" }, filters: [{ column: "user_id", op: "eq", value: "u" }] },
      { kind: "delete", table: "push_subscriptions", filters: [{ column: "user_id", op: "eq", value: "u" }, { column: "endpoint", op: "eq", value: "e" }] },
      { kind: "rpc", name: "merge_user_settings", args: { p_user_id: "u", p_patch: { a: null } } },
      { kind: "rpc", name: "reset_all_progress", args: {} },
    ]);
  });

  it("sends once per query, however often it is awaited", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const query = createDataClient({ fetch: fetchImpl }).from("grade_log").select("*");
    await query;
    await query;
    expect(calls).toHaveLength(1);
  });

  it("uses the global fetch at call time when none is given", async () => {
    const { fetchImpl, calls } = recordingFetch();
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await createDataClient().from("grade_log").select("*");
      expect(calls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("how answers map (never throws)", () => {
  it("data and count pass through", async () => {
    const { fetchImpl } = recordingFetch(200, { data: [{ a: 1 }], error: null, count: 5 });
    expect(await createDataClient({ fetch: fetchImpl }).from("t").select("*")).toEqual({ data: [{ a: 1 }], error: null, count: 5 });
  });

  it("a database error keeps its code and the supabase-js error shape", async () => {
    const { fetchImpl } = recordingFetch(200, { data: null, error: { code: "23514", message: "card_reviews regression: reps cannot decrease", details: null, hint: null } });
    const result = await createDataClient({ fetch: fetchImpl }).from("card_reviews").upsert({});
    expect(result).toEqual({
      data: null,
      error: { code: "23514", message: "card_reviews regression: reps cannot decrease", details: null, hint: null },
      count: null,
    });
  });

  it("a 4xx with an error body keeps that error (403 42501, 401 PGRST301)", async () => {
    for (const [status, code] of [[403, "42501"], [401, "PGRST301"], [400, "42703"]] as const) {
      const { fetchImpl } = recordingFetch(status, { data: null, error: { code, message: "x" } });
      const result = await createDataClient({ fetch: fetchImpl }).from("t").select("*");
      expect(result.error).toEqual({ code, message: "x", details: null, hint: null });
    }
  });

  it("a network failure is NETWORK_ERROR, treated as transient by the sync layer", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const result = await createDataClient({ fetch: fetchImpl }).from("t").select("*");
    expect(result).toEqual({ data: null, error: { code: NETWORK_ERROR_CODE, message: "Failed to fetch", details: null, hint: null }, count: null });
    expect(result.error!.code.startsWith("42")).toBe(false);
    expect(/^2[23]/.test(result.error!.code)).toBe(false);
    const rpc = await createDataClient({ fetch: fetchImpl }).rpc("reset_all_progress");
    expect(rpc.error?.code).toBe(NETWORK_ERROR_CODE);
  });

  it("an unreadable or error-less failure answer is HTTP_<status>", async () => {
    const html = recordingFetch(502, "<html>bad gateway</html>");
    expect((await createDataClient({ fetch: html.fetchImpl }).from("t").select("*")).error?.code).toBe("HTTP_502");
    const empty = recordingFetch(500, {});
    expect((await createDataClient({ fetch: empty.fetchImpl }).from("t").select("*")).error?.code).toBe("HTTP_500");
  });
});

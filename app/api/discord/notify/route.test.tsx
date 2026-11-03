/**
 * Tests for POST /api/discord/notify (#1653, #1848, ops #405).
 *
 * Covers:
 *   - 503 on missing env vars (all combinations)
 *   - 401 on missing / bad bearer token
 *   - 400 on invalid JSON body
 *   - 400 if body contains forbidden fields (message, user_id) - guard unchanged
 *   - 200 success path: formats the correct Discord embed, posts to webhook
 *   - Message preview fetched by id (route-side, NOT from trigger payload)
 *   - 500-char cap + "…" truncation on long messages
 *   - Missing/failed message fetch → embed still sent without the preview field
 *   - user_id is never in the Discord webhook payload
 *   - 502 when the Discord webhook fetch fails or returns non-2xx
 *   - The Discord message id is stored, and the post is deleted when the
 *     feedback row is deleted (ops #405)
 *
 * `fetch` is mocked globally so the test never touches the network.
 * `@supabase/supabase-js` is mocked to intercept the service-role DB query.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

// ── Supabase admin mock ──────────────────────────────────────────────────────

// Default: message fetch returns a short message.
let supabaseSingleResult: { data: { message: string } | null; error: unknown } = {
  data: { message: "app crashes on the practice screen" },
  error: null,
};

// The re-check after storing the id (ops #405): whether the row still exists.
let feedbackRowResult: { data: { id: string } | null; error: unknown } = {
  data: { id: "row" },
  error: null,
};

// `feedback_discord_posts` (ops #405): what the stored-id lookup returns, and
// every lookup, insert and delete the route makes.
let postLookupResult: { data: { discord_message_id: string } | null; error: unknown } = {
  data: null,
  error: null,
};
let postInsertResult: { error: unknown } = { error: null };
let postDeleteResult: { error: unknown } = { error: null };
const postInserts: unknown[] = [];
const postDeletes: Array<[string, unknown]> = [];
const postLookups: Array<[string, string, unknown]> = [];

vi.mock("@supabase/supabase-js", () => {
  const feedbackTable = {
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve(supabaseSingleResult),
        maybeSingle: () => Promise.resolve(feedbackRowResult),
      }),
    }),
  };
  const postsTable = {
    insert: (row: unknown) => {
      postInserts.push(row);
      return Promise.resolve(postInsertResult);
    },
    select: (cols: string) => ({
      eq: (col: string, value: unknown) => {
        postLookups.push([cols, col, value]);
        return { maybeSingle: () => Promise.resolve(postLookupResult) };
      },
    }),
    delete: () => ({
      eq: (col: string, value: unknown) => {
        postDeletes.push([col, value]);
        return Promise.resolve(postDeleteResult);
      },
    }),
  };
  return {
    createClient: vi.fn(() => ({
      from: vi.fn((table: string) => (table === "feedback" ? feedbackTable : postsTable)),
    })),
  };
});

// ── Environment helpers ──────────────────────────────────────────────────────

function setRequiredEnv() {
  process.env.CRON_SHARED_SECRET = "test-secret-abc123";
  process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.com/api/webhooks/test/notify";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc123.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
}

function clearEnv() {
  delete process.env.CRON_SHARED_SECRET;
  delete process.env.DISCORD_NOTIFY_WEBHOOK_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// ── Request helpers ──────────────────────────────────────────────────────────

const VALID_BEARER = "Bearer test-secret-abc123";

function makeRequest(body: unknown, authHeader: string | null = VALID_BEARER): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader !== null) headers["authorization"] = authHeader;
  return new Request("http://localhost/api/discord/notify", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Valid minimal body as sent by the pg_net trigger. */
const VALID_BODY = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  category: "bug",
  page: "/practice",
  app_version: "0.11.2",
  created_at: "2026-06-09T09:00:00.000Z",
  authenticated: true,
} as const;

// ── fetch mock ───────────────────────────────────────────────────────────────

const DISCORD_MESSAGE_ID = "1234567890123456789";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Discord with `wait=true` answers 200 with the message JSON. A fresh
  // Response each call, since a body can only be read once.
  fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(Response.json({ id: DISCORD_MESSAGE_ID })),
  );
  vi.stubGlobal("fetch", fetchMock);
  setRequiredEnv();
  // Reset the Supabase mock to a short message by default.
  supabaseSingleResult = {
    data: { message: "app crashes on the practice screen" },
    error: null,
  };
  feedbackRowResult = { data: { id: "row" }, error: null };
  postLookupResult = { data: null, error: null };
  postInsertResult = { error: null };
  postDeleteResult = { error: null };
  postInserts.length = 0;
  postDeletes.length = 0;
  postLookups.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEnv();
});

// ── 503 Misconfiguration ─────────────────────────────────────────────────────

describe("POST /api/discord/notify - misconfiguration", () => {
  it("returns 503 when CRON_SHARED_SECRET is missing", async () => {
    delete process.env.CRON_SHARED_SECRET;
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("misconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when DISCORD_NOTIFY_WEBHOOK_URL is missing", async () => {
    delete process.env.DISCORD_NOTIFY_WEBHOOK_URL;
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 401 Auth ─────────────────────────────────────────────────────────────────

describe("POST /api/discord/notify - auth", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(makeRequest(VALID_BODY, null));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer token", async () => {
    const res = await POST(makeRequest(VALID_BODY, "Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a bearer token of different length", async () => {
    const res = await POST(makeRequest(VALID_BODY, "Bearer short"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 400 Bad request ───────────────────────────────────────────────────────────

describe("POST /api/discord/notify - bad request", () => {
  it("returns 400 for invalid JSON body", async () => {
    const res = await POST(makeRequest("not-json"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 if body contains forbidden field 'message'", async () => {
    const maliciousBody = { ...VALID_BODY, message: "raw user text" };
    const res = await POST(makeRequest(maliciousBody));
    expect(res.status).toBe(400);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("forbidden_fields");
    // Discord webhook must NOT be called.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 if body contains forbidden field 'user_id'", async () => {
    const maliciousBody = { ...VALID_BODY, user_id: "some-user-uuid" };
    const res = await POST(makeRequest(maliciousBody));
    expect(res.status).toBe(400);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("forbidden_fields");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Success path ─────────────────────────────────────────────────────────────

describe("POST /api/discord/notify - success", () => {
  it("returns 200 { ok: true } on success", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean };
    expect(b.ok).toBe(true);
  });

  it("posts to the Discord webhook URL with wait=true, so Discord returns the message id (ops #405)", async () => {
    await POST(makeRequest(VALID_BODY));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/webhooks/test/notify?wait=true");
  });

  it("formats a Discord embed with the correct colour (red 0xE74C3C)", async () => {
    await POST(makeRequest(VALID_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ color: number; title: string }>;
    };
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].color).toBe(0xe74c3c);
    expect(payload.embeds[0].title).toBe("New bug report");
  });

  it("includes page, app_version, authenticated, and timestamp in the embed fields", async () => {
    await POST(makeRequest(VALID_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const fields = payload.embeds[0].fields;
    const fieldNames = fields.map((f) => f.name);

    expect(fieldNames).toContain("Page");
    expect(fieldNames).toContain("App version");
    expect(fieldNames).toContain("Authenticated");
    expect(fieldNames).toContain("Timestamp");
    expect(fieldNames).toContain("View in Supabase");

    const pageField = fields.find((f) => f.name === "Page")!;
    expect(pageField.value).toBe("/practice");

    const authField = fields.find((f) => f.name === "Authenticated")!;
    expect(authField.value).toBe("Yes");
  });

  it("shows '(not provided)' in the Page field when page is null (#1847 - user left selector blank)", async () => {
    await POST(makeRequest({ ...VALID_BODY, page: null }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const pageField = payload.embeds[0].fields.find((f) => f.name === "Page")!;
    // Null page (user didn't state a page) must NOT show "/settings" - any
    // previous submission that captured the pathname would always be "/settings".
    expect(pageField.value).not.toBe("/settings");
    expect(pageField.value).toBe("(not provided)");
  });

  it("shows 'No (guest)' in the Authenticated field for guest submissions", async () => {
    await POST(makeRequest({ ...VALID_BODY, authenticated: false }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const authField = payload.embeds[0].fields.find((f) => f.name === "Authenticated")!;
    expect(authField.value).toBe("No (guest)");
  });

  it("the deep link uses feedback.id (row UUID) not user_id", async () => {
    await POST(makeRequest(VALID_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const linkField = payload.embeds[0].fields.find((f) => f.name === "View in Supabase")!;
    // Must contain the row UUID.
    expect(linkField.value).toContain(VALID_BODY.id);
    // Must NOT contain any user_id-like path segment (there is no user_id in the valid body).
    // The deep link points at the Supabase dashboard - ensure it references supabase.com.
    expect(linkField.value).toContain("supabase.com");
  });

  it("CRITICAL: Discord webhook payload contains NO user_id field", async () => {
    await POST(makeRequest(VALID_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const raw = init.body as string;
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain('"user_id"');
  });
});

// ── Message preview (#1848) ────────────────────────────────────────────────

describe("POST /api/discord/notify - message preview (#1848)", () => {
  it("fetches the message by id and adds a 'Message preview' embed field", async () => {
    supabaseSingleResult = {
      data: { message: "app crashes on the practice screen" },
      error: null,
    };
    await POST(makeRequest(VALID_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const fields = payload.embeds[0].fields;
    const previewField = fields.find((f) => f.name === "Message preview");
    expect(previewField).toBeDefined();
    expect(previewField!.value).toBe("app crashes on the practice screen");
  });

  it("appears between the Timestamp field and the View in Supabase field", async () => {
    supabaseSingleResult = {
      data: { message: "short message" },
      error: null,
    };
    await POST(makeRequest(VALID_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const fields = payload.embeds[0].fields;
    const previewIdx = fields.findIndex((f) => f.name === "Message preview");
    const supabaseIdx = fields.findIndex((f) => f.name === "View in Supabase");
    const timestampIdx = fields.findIndex((f) => f.name === "Timestamp");
    expect(previewIdx).toBeGreaterThan(timestampIdx);
    expect(previewIdx).toBeLessThan(supabaseIdx);
  });

  it("caps the message at 500 chars and appends '…' when longer", async () => {
    const longMessage = "x".repeat(600);
    supabaseSingleResult = { data: { message: longMessage }, error: null };
    await POST(makeRequest(VALID_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const fields = payload.embeds[0].fields;
    const previewField = fields.find((f) => f.name === "Message preview");
    expect(previewField).toBeDefined();
    // 500 chars of "x" + the ellipsis character (1 char).
    expect(previewField!.value).toHaveLength(501);
    expect(previewField!.value).toMatch(/…$/);
    expect(previewField!.value.slice(0, 500)).toBe("x".repeat(500));
  });

  it("does NOT truncate a message that is exactly 500 chars", async () => {
    const exactMessage = "y".repeat(500);
    supabaseSingleResult = { data: { message: exactMessage }, error: null };
    await POST(makeRequest(VALID_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const previewField = payload.embeds[0].fields.find((f) => f.name === "Message preview")!;
    expect(previewField.value).toBe(exactMessage);
    expect(previewField.value).not.toMatch(/…$/);
  });

  it("omits the 'Message preview' field when the DB query fails", async () => {
    supabaseSingleResult = { data: null, error: { message: "DB error" } };
    await POST(makeRequest(VALID_BODY));
    // Embed is still posted to Discord.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const fields = payload.embeds[0].fields;
    const previewField = fields.find((f) => f.name === "Message preview");
    // No preview field when fetch fails - deep link is still present.
    expect(previewField).toBeUndefined();
    expect(fields.find((f) => f.name === "View in Supabase")).toBeDefined();
    // Route should still return 200.
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
  });

  it("omits the 'Message preview' field when SUPABASE_SERVICE_ROLE_KEY is absent", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const previewField = payload.embeds[0].fields.find((f) => f.name === "Message preview");
    expect(previewField).toBeUndefined();
  });
});

// ── 502 Webhook errors ────────────────────────────────────────────────────────

describe("POST /api/discord/notify - webhook errors", () => {
  it("returns 502 when the Discord webhook returns a non-2xx status", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Request", { status: 400 }));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(502);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("webhook_error");
  });

  it("returns 502 when the fetch itself throws (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(502);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("webhook_fetch_failed");
  });
});

// ── Deletion with the feedback (ops #405) ───────────────────────────────────

const DELETED_BODY = { event: "deleted", id: VALID_BODY.id } as const;

describe("POST /api/discord/notify - stores the Discord message id (ops #405)", () => {
  it("stores the message id Discord returns against the feedback id", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(postInserts).toEqual([
      { feedback_id: VALID_BODY.id, discord_message_id: DISCORD_MESSAGE_ID },
    ]);
    // The row is still there, so the post stays.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postDeletes).toHaveLength(0);
  });

  it("deletes the post at once when the row went before its id was stored", async () => {
    feedbackRowResult = { data: null, error: null };
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`https://discord.com/api/webhooks/test/notify/messages/${DISCORD_MESSAGE_ID}`);
    expect(init.method).toBe("DELETE");
    expect(postDeletes).toEqual([["feedback_id", VALID_BODY.id]]);
  });

  it("keeps the post when the re-check of the row fails", async () => {
    feedbackRowResult = { data: null, error: { message: "DB error" } };
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postDeletes).toHaveLength(0);
  });

  it("still answers 200 when storing the id fails", async () => {
    postInsertResult = { error: { message: "insert failed" } };
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
  });

  it("stores nothing when Discord's answer is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(postInserts).toHaveLength(0);
  });

  it("stores nothing when Discord's body has no message id", async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(postInserts).toHaveLength(0);
  });

  it("stores nothing, and sends no preview, without a Supabase key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await POST(makeRequest(VALID_BODY));
    expect(postInserts).toHaveLength(0);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string }> }>;
    };
    expect(payload.embeds[0].fields.find((f) => f.name === "Message preview")).toBeUndefined();
  });
});

describe("POST /api/discord/notify - deletes the post with the feedback (ops #405)", () => {
  it("CRITICAL: deletes the stored Discord message, then the stored id", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://discord.com/api/webhooks/test/notify/messages/${DISCORD_MESSAGE_ID}`);
    expect(init.method).toBe("DELETE");
    expect(postDeletes).toEqual([["feedback_id", VALID_BODY.id]]);
  });

  it("looks the stored id up by the deleted row's feedback id", async () => {
    await POST(makeRequest(DELETED_BODY));
    expect(postLookups).toEqual([["discord_message_id", "feedback_id", VALID_BODY.id]]);
  });

  it("answers 400 to a deletion event without an id", async () => {
    const res = await POST(makeRequest({ event: "deleted" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(postLookups).toHaveLength(0);
  });

  it("keeps a thread_id on the webhook URL when deleting", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.com/api/webhooks/test/notify?thread_id=42";
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    await POST(makeRequest(DELETED_BODY));
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://discord.com/api/webhooks/test/notify/messages/${DISCORD_MESSAGE_ID}?thread_id=42`,
    );
  });

  it("never posts a new embed for a deletion event", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    await POST(makeRequest(DELETED_BODY));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });

  it("calls Discord not at all when no id was stored", async () => {
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(postDeletes).toHaveLength(0);
  });

  it("treats a post Discord no longer has (404 Unknown Message) as deleted", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    fetchMock.mockResolvedValue(
      Response.json({ message: "Unknown Message", code: 10008 }, { status: 404 }),
    );
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(200);
    expect(postDeletes).toEqual([["feedback_id", VALID_BODY.id]]);
  });

  it("answers 502 and keeps the stored id for a 404 Unknown Webhook", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    fetchMock.mockResolvedValue(
      Response.json({ message: "Unknown Webhook", code: 10015 }, { status: 404 }),
    );
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(502);
    expect(postDeletes).toHaveLength(0);
  });

  it("retries a rate-limited delete after Discord's retry_after", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    fetchMock
      .mockResolvedValueOnce(Response.json({ retry_after: 0.01 }, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(postDeletes).toEqual([["feedback_id", VALID_BODY.id]]);
  });

  it("answers 502 and keeps the stored id when still rate-limited after the retries", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    fetchMock.mockImplementation(() =>
      Promise.resolve(Response.json({ retry_after: 0.01 }, { status: 429 })),
    );
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(postDeletes).toHaveLength(0);
  });

  it("still answers 200 once the post is gone, if removing the stored id fails", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    postDeleteResult = { error: { message: "delete failed" } };
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(200);
  });

  it("answers 502 and keeps the stored id when Discord fails", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(502);
    expect(postDeletes).toHaveLength(0);
  });

  it("answers 502 and keeps the stored id when the delete request throws", async () => {
    postLookupResult = { data: { discord_message_id: DISCORD_MESSAGE_ID }, error: null };
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(502);
    expect(postDeletes).toHaveLength(0);
  });

  it("answers 502 when the stored id cannot be read", async () => {
    postLookupResult = { data: null, error: { message: "DB error" } };
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 without a Supabase key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await POST(makeRequest(DELETED_BODY));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses a deletion body holding message or user_id", async () => {
    const res = await POST(makeRequest({ ...DELETED_BODY, user_id: "u" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still needs the bearer secret", async () => {
    const res = await POST(makeRequest(DELETED_BODY, "Bearer wrong"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

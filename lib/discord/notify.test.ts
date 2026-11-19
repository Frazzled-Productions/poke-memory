/**
 * The Discord bug notification and its deletion (#1653, #1848, ops #405),
 * with a fake store and `fetch` mocked: the cases of the old
 * app/api/discord/notify route tests, plus the outbound gate (design D2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_PREVIEW_MAX, deleteBugNotification, postBugNotification, type DiscordPostStore, type FeedbackNotice } from "./notify";
import { deleteDiscordPosts } from "./webhook";

const WEBHOOK = "https://discord.com/api/webhooks/123/abc";
const PROD = { DEPLOY_ENV: "cloudflare-production", DISCORD_NOTIFY_WEBHOOK_URL: WEBHOOK };
const PREVIEW = { DEPLOY_ENV: "cloudflare-preview", DISCORD_NOTIFY_WEBHOOK_URL: WEBHOOK };

const NOTICE: FeedbackNotice = {
  id: "11111111-1111-4111-8111-111111111111",
  category: "bug",
  page: "/practice",
  app_version: "1.2.3",
  created_at: "2026-11-19T10:00:00.000Z",
  authenticated: true,
};

type FakeStore = DiscordPostStore & { posts: Map<string, string>; rows: Map<string, string> };

function fakeStore(overrides: Partial<DiscordPostStore> = {}): FakeStore {
  const posts = new Map<string, string>();
  const rows = new Map<string, string>([[NOTICE.id, "app crashes on the practice screen"]]);
  return {
    posts,
    rows,
    feedbackMessage: async (id) => rows.get(id) ?? null,
    feedbackExists: async (id) => rows.has(id),
    storeMessageId: async (id, messageId) => void posts.set(id, messageId),
    messageIdFor: async (id) => posts.get(id) ?? null,
    forgetMessageId: async (id) => void posts.delete(id),
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ id: "msg-1" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function postedEmbed() {
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse(String(init!.body)).embeds[0] as { color: number; fields: { name: string; value: string }[] };
}
const field = (name: string) => postedEmbed().fields.find((f) => f.name === name)?.value;

describe("postBugNotification", () => {
  it("posts the embed with wait=true and stores the returned message id", async () => {
    const store = fakeStore();
    expect(await postBugNotification(PROD, store, NOTICE)).toEqual({ ok: true, posted: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${WEBHOOK}?wait=true`);
    expect(postedEmbed().color).toBe(0xe74c3c);
    expect(postedEmbed().fields.map((f) => f.name)).toEqual([
      "Page",
      "App version",
      "Authenticated",
      "Timestamp",
      "Message preview",
      "Feedback id",
    ]);
    expect(field("Page")).toBe("/practice");
    expect(field("App version")).toBe("1.2.3");
    expect(field("Authenticated")).toBe("Yes");
    expect(field("Timestamp")).toBe("2026-11-19T10:00:00.000Z");
    expect(field("Message preview")).toBe("app crashes on the practice screen");
    expect(field("Feedback id")).toBe(NOTICE.id);
    expect(store.posts.get(NOTICE.id)).toBe("msg-1");
  });

  it("shows (not provided) and No (guest) where the notice has no page, version or user", async () => {
    await postBugNotification(PROD, fakeStore(), { ...NOTICE, page: null, app_version: null, authenticated: false });
    expect(field("Page")).toBe("(not provided)");
    expect(field("App version")).toBe("(not provided)");
    expect(field("Authenticated")).toBe("No (guest)");
  });

  it("CRITICAL: the payload carries no user_id", async () => {
    await postBugNotification(PROD, fakeStore(), NOTICE);
    expect(String(fetchMock.mock.calls[0][1]!.body)).not.toContain("user_id");
  });

  it("caps the preview at 500 characters plus an ellipsis, and leaves exactly 500 alone", async () => {
    const store = fakeStore();
    store.rows.set(NOTICE.id, "x".repeat(MESSAGE_PREVIEW_MAX + 20));
    await postBugNotification(PROD, store, NOTICE);
    expect(field("Message preview")).toBe("x".repeat(MESSAGE_PREVIEW_MAX) + "…");

    fetchMock.mockClear();
    store.rows.set(NOTICE.id, "y".repeat(MESSAGE_PREVIEW_MAX));
    store.posts.clear();
    await postBugNotification(PROD, store, NOTICE);
    expect(field("Message preview")).toBe("y".repeat(MESSAGE_PREVIEW_MAX));
  });

  it("leaves the preview out when the message read fails", async () => {
    await postBugNotification(PROD, fakeStore({ feedbackMessage: () => Promise.reject(new Error("D1 down")) }), NOTICE);
    expect(field("Message preview")).toBeUndefined();
  });

  it("reports webhook_error for a non-2xx answer and webhook_fetch_failed for a throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await postBugNotification(PROD, fakeStore(), NOTICE)).toEqual({ ok: false, error: "webhook_error", status: 500 });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await postBugNotification(PROD, fakeStore(), NOTICE)).toEqual({ ok: false, error: "webhook_fetch_failed" });
  });

  it("is misconfigured in production without a webhook URL", async () => {
    expect(await postBugNotification({ DEPLOY_ENV: "cloudflare-production" }, fakeStore(), NOTICE)).toEqual({
      ok: false,
      error: "misconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("outside production reads the preview but sends nothing and stores nothing", async () => {
    for (const env of [PREVIEW, {}, { DEPLOY_ENV: "cloudflare-preview" }]) {
      const store = fakeStore();
      expect(await postBugNotification(env, store, NOTICE)).toEqual({ ok: true, posted: false });
      expect(store.posts.size).toBe(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores nothing when Discord's answer has no message id or is not JSON, and still succeeds", async () => {
    const store = fakeStore();
    fetchMock.mockResolvedValueOnce(Response.json({}));
    expect(await postBugNotification(PROD, store, NOTICE)).toEqual({ ok: true, posted: true });
    fetchMock.mockResolvedValueOnce(new Response("not json"));
    expect(await postBugNotification(PROD, store, NOTICE)).toEqual({ ok: true, posted: true });
    expect(store.posts.size).toBe(0);
  });

  it("still succeeds when storing the id fails", async () => {
    const store = fakeStore({ storeMessageId: () => Promise.reject(new Error("D1 down")) });
    expect(await postBugNotification(PROD, store, NOTICE)).toEqual({ ok: true, posted: true });
  });

  it("deletes the post at once when the row went before its id was stored", async () => {
    const store = fakeStore({ feedbackExists: async () => false });
    fetchMock.mockResolvedValueOnce(Response.json({ id: "msg-9" })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await postBugNotification(PROD, store, NOTICE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${WEBHOOK}/messages/msg-9`);
    expect(fetchMock.mock.calls[1][1]!.method).toBe("DELETE");
    expect(store.posts.size).toBe(0);
  });

  it("keeps the post when the re-check of the row fails", async () => {
    const store = fakeStore({ feedbackExists: () => Promise.reject(new Error("D1 down")) });
    await postBugNotification(PROD, store, NOTICE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.posts.get(NOTICE.id)).toBe("msg-1");
  });
});

describe("deleteBugNotification", () => {
  function storeWithPost() {
    const store = fakeStore();
    store.posts.set(NOTICE.id, "msg-1");
    store.rows.clear();
    return store;
  }

  it("CRITICAL: deletes the Discord message, then the stored id", async () => {
    const store = storeWithPost();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await deleteBugNotification(PROD, store, NOTICE.id)).toEqual({ ok: true, deleted: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${WEBHOOK}/messages/msg-1`);
    expect(store.posts.size).toBe(0);
  });

  it("keeps a thread_id on the webhook URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteBugNotification({ ...PROD, DISCORD_NOTIFY_WEBHOOK_URL: `${WEBHOOK}?thread_id=42` }, storeWithPost(), NOTICE.id);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${WEBHOOK}/messages/msg-1?thread_id=42`);
  });

  it("calls Discord not at all when no id was stored", async () => {
    expect(await deleteBugNotification(PROD, fakeStore(), NOTICE.id)).toEqual({ ok: true, deleted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats 404 Unknown Message as deleted", async () => {
    const store = storeWithPost();
    fetchMock.mockResolvedValueOnce(Response.json({ code: 10008 }, { status: 404 }));
    expect(await deleteBugNotification(PROD, store, NOTICE.id)).toEqual({ ok: true, deleted: true });
    expect(store.posts.size).toBe(0);
  });

  it("fails and keeps the stored id for a 404 Unknown Webhook, a 500 or a thrown request", async () => {
    for (const outcome of [
      () => fetchMock.mockResolvedValueOnce(Response.json({ code: 10015 }, { status: 404 })),
      () => fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 })),
      () => fetchMock.mockRejectedValueOnce(new Error("network")),
    ]) {
      const store = storeWithPost();
      outcome();
      const result = await deleteBugNotification(PROD, store, NOTICE.id);
      expect(result.ok).toBe(false);
      expect(store.posts.get(NOTICE.id)).toBe("msg-1");
    }
  });

  it("retries a rate-limited delete after retry_after, and gives up after two retries", async () => {
    vi.useFakeTimers();
    try {
      const store = storeWithPost();
      fetchMock
        .mockResolvedValueOnce(Response.json({ retry_after: 0.5 }, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      const done = deleteBugNotification(PROD, store, NOTICE.id);
      await vi.advanceTimersByTimeAsync(600);
      expect(await done).toEqual({ ok: true, deleted: true });

      const stuck = storeWithPost();
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => Response.json({ retry_after: 0.1 }, { status: 429 }));
      const failed = deleteBugNotification(PROD, stuck, NOTICE.id);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await failed).toEqual({ ok: false, error: "webhook_error", status: 429 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(stuck.posts.get(NOTICE.id)).toBe("msg-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still succeeds once the post is gone if removing the stored id fails", async () => {
    const store = storeWithPost();
    store.forgetMessageId = () => Promise.reject(new Error("D1 down"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await deleteBugNotification(PROD, store, NOTICE.id)).toEqual({ ok: true, deleted: true });
  });

  it("reports lookup_failed when the stored id cannot be read", async () => {
    const store = fakeStore({ messageIdFor: () => Promise.reject(new Error("D1 down")) });
    expect(await deleteBugNotification(PROD, store, NOTICE.id)).toEqual({ ok: false, error: "lookup_failed" });
  });

  it("outside production deletes nothing and keeps the stored id", async () => {
    const store = storeWithPost();
    expect(await deleteBugNotification(PREVIEW, store, NOTICE.id)).toEqual({ ok: true, deleted: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.posts.get(NOTICE.id)).toBe("msg-1");
  });
});

describe("deleteDiscordPosts (account deletion)", () => {
  it("deletes each message and sorts the ids into deleted and failed", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ code: 10008 }, { status: 404 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect(await deleteDiscordPosts(PROD, ["a", "b", "c"])).toEqual({ deleted: ["a", "b"], failed: ["c"], skipped: [] });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${WEBHOOK}/messages/a`,
      `${WEBHOOK}/messages/b`,
      `${WEBHOOK}/messages/c`,
    ]);
  });

  it("skips every id outside production or without a webhook", async () => {
    expect(await deleteDiscordPosts(PREVIEW, ["a"])).toEqual({ deleted: [], failed: [], skipped: ["a"] });
    expect(await deleteDiscordPosts({ DEPLOY_ENV: "cloudflare-production" }, ["a"])).toEqual({
      deleted: [],
      failed: [],
      skipped: ["a"],
    });
    expect(await deleteDiscordPosts(PROD, [])).toEqual({ deleted: [], failed: [], skipped: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

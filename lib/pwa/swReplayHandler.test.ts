/**
 * Unit tests for the real Background Sync handler in lib/pwa/swReplay.ts
 * (#2209). Only the worker's globals are faked; the MessageChannel is real, so
 * the ACK path runs as it does in the worker.
 *
 * A sync event is retried when the promise rejects, so "resolves" means the
 * browser stops and "rejects" means it tries again.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ACK_TIMEOUT_MS, replayPendingGrades, type SwReplayDeps } from "./swReplay";
import { SW_REPLAY_MESSAGE } from "@/lib/sync/backgroundSync";

const QUEUE = [{ card_type: "name", subject_key: "1" }];

type FakeClient = { postMessage: ReturnType<typeof vi.fn> };

/** A client that replies on the transferred port, as useOnlineReconnectSync does. */
function ackingClient(): FakeClient {
  return {
    postMessage: vi.fn((_data: unknown, [port]: MessagePort[]) => {
      port.postMessage({ type: "ACK" });
    }),
  };
}

/** A frozen or not-yet-hydrated client: it takes the message and never replies. */
function silentClient(): FakeClient {
  return { postMessage: vi.fn() };
}

function deps(
  options: { status?: number; clients?: FakeClient[]; queue?: unknown[] } = {},
) {
  const { status = 200, clients = [], queue = QUEUE } = options;
  return {
    clients: { matchAll: vi.fn().mockResolvedValue(clients) },
    fetch: vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status }),
    readQueue: vi.fn().mockResolvedValue(queue),
    clearQueue: vi.fn().mockResolvedValue(undefined),
  } satisfies SwReplayDeps;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("replayPendingGrades: an open tab", () => {
  it("leaves the push to a client that ACKs", async () => {
    const d = deps({ clients: [ackingClient()] });

    await expect(replayPendingGrades(d)).resolves.toBeUndefined();

    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.readQueue).not.toHaveBeenCalled();
    expect(d.clearQueue).not.toHaveBeenCalled();
  });

  it("only asks clients this worker controls, and sends them the replay message", async () => {
    const client = ackingClient();
    const d = deps({ clients: [client] });

    await replayPendingGrades(d);

    expect(d.clients.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: false,
    });
    expect(client.postMessage).toHaveBeenCalledWith({ type: SW_REPLAY_MESSAGE }, [
      expect.any(MessagePort),
    ]);
  });

  it("needs only one of several clients to ACK", async () => {
    const d = deps({ clients: [silentClient(), ackingClient()] });

    await replayPendingGrades(d);

    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("does not push before the ACK timeout", async () => {
    vi.useFakeTimers();
    const d = deps({ clients: [silentClient()] });

    const run = replayPendingGrades(d);
    await vi.advanceTimersByTimeAsync(CLIENT_ACK_TIMEOUT_MS - 1);
    expect(d.fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(d.fetch).toHaveBeenCalledOnce();
  });

  it("pushes the queue itself after an ACK timeout", async () => {
    vi.useFakeTimers();
    const d = deps({ clients: [silentClient()] });

    const run = replayPendingGrades(d);
    await vi.advanceTimersByTimeAsync(CLIENT_ACK_TIMEOUT_MS);
    await run;

    expect(d.fetch).toHaveBeenCalledOnce();
    expect(d.clearQueue).toHaveBeenCalledOnce();
  });
});

describe("replayPendingGrades: all tabs closed", () => {
  it("does nothing and resolves on an empty queue", async () => {
    const d = deps({ queue: [] });

    await expect(replayPendingGrades(d)).resolves.toBeUndefined();

    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.clearQueue).not.toHaveBeenCalled();
  });

  it("posts the queue as is, with cookies, and clears it on a 200", async () => {
    const d = deps({ status: 200 });

    await expect(replayPendingGrades(d)).resolves.toBeUndefined();

    expect(d.fetch).toHaveBeenCalledWith("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards: QUEUE }),
      credentials: "include",
    });
    expect(d.clearQueue).toHaveBeenCalledOnce();
  });

  it.each([401, 403])("resolves and clears the queue on a %i", async (status) => {
    const d = deps({ status });

    await expect(replayPendingGrades(d)).resolves.toBeUndefined();

    expect(d.clearQueue).toHaveBeenCalledOnce();
  });

  it.each([400, 409])("resolves on a %i, so it does not loop, and keeps the queue", async (status) => {
    const d = deps({ status });

    await expect(replayPendingGrades(d)).resolves.toBeUndefined();

    expect(d.clearQueue).not.toHaveBeenCalled();
  });

  it.each([500, 502, 503])("rejects on a %i, so the browser retries, and keeps the queue", async (status) => {
    const d = deps({ status });

    await expect(replayPendingGrades(d)).rejects.toThrow(`/api/sync returned ${String(status)}`);

    expect(d.clearQueue).not.toHaveBeenCalled();
  });

  it("rejects on a network error and keeps the queue", async () => {
    const d = deps();
    d.fetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(replayPendingGrades(d)).rejects.toThrow("network error");

    expect(d.clearQueue).not.toHaveBeenCalled();
  });
});

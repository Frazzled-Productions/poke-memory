import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("web-push", () => ({
  default: { sendNotification: vi.fn() },
}));

import webpush from "web-push";
import { deliverPushes, type PushTarget } from "./deliver";

const mockSend = vi.mocked(webpush.sendNotification);
const never = () => new Promise<never>(() => {});
const healthy = { statusCode: 201, body: "", headers: {} };

function targets(count: number): PushTarget[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `sub-${i}`,
    endpoint: `https://fcm.googleapis.com/fcm/send/${i}`,
    p256dh: "p256",
    auth_secret: "auth",
  }));
}

const payload = () => ({ title: "t" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mockSend.mockResolvedValue(healthy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("deliverPushes - time limits", () => {
  it("Healthy reply: counts the send and leaves no timer running", async () => {
    const result = await deliverPushes(targets(1), payload, Date.now());
    expect(result).toEqual({ sent: 1, deadIds: [], notReached: 0, unknownHost: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes a 10 second socket timeout to every send", async () => {
    await deliverPushes(targets(1), payload, Date.now());
    expect(mockSend.mock.calls[0][2]).toEqual({ timeout: 10_000 });
    expect(mockSend.mock.calls[0][1]).toBe(JSON.stringify({ title: "t" }));
  });

  it("No reply: fails at the socket timeout, the row stays and the run goes on", async () => {
    mockSend.mockRejectedValueOnce(new Error("Socket timeout"));
    const result = await deliverPushes(targets(2), payload, Date.now());
    expect(result).toMatchObject({ sent: 1, deadIds: [] });
    expect(console.warn).toHaveBeenCalledWith(
      "[push] sendNotification failed",
      expect.objectContaining({ id: "sub-0" }),
    );
  });

  it("Slow reply: a send that never settles fails at 15 seconds, the row stays", async () => {
    mockSend.mockImplementationOnce(never);
    const run = deliverPushes(targets(2), payload, Date.now());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toMatchObject({ sent: 1, deadIds: [], notReached: 0 });
  });
});

describe("deliverPushes - results", () => {
  it("Gone: collects 404 and 410 for deletion", async () => {
    mockSend.mockRejectedValueOnce({ statusCode: 410 });
    mockSend.mockRejectedValueOnce({ statusCode: 404 });
    const result = await deliverPushes(targets(3), payload, Date.now());
    expect(result).toMatchObject({ sent: 1, deadIds: ["sub-0", "sub-1"] });
  });

  it("Server error from a push service: the row stays and the others are sent to", async () => {
    mockSend.mockRejectedValueOnce({ statusCode: 500 });
    const result = await deliverPushes(targets(3), payload, Date.now());
    expect(result).toMatchObject({ sent: 2, deadIds: [] });
  });

  it("Payload build fails: that device fails, the others are sent to and dead rows are kept", async () => {
    mockSend.mockRejectedValueOnce({ statusCode: 410 });
    const build = vi
      .fn(payload)
      .mockImplementationOnce(payload)
      .mockImplementationOnce(() => {
        throw new Error("no catalogue");
      });
    const result = await deliverPushes(targets(3), build, Date.now());
    expect(result).toMatchObject({ sent: 1, deadIds: ["sub-0"] });
  });

  it("builds a payload only for a device it sends to", async () => {
    const build = vi.fn(payload);
    await deliverPushes(
      [...targets(1), { ...targets(1)[0], id: "old", endpoint: "https://push.example/a" }],
      build,
      Date.now(),
    );
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe("deliverPushes - concurrency", () => {
  it("First device hangs: the other 20 are sent to before it reaches its limit", async () => {
    mockSend.mockImplementationOnce(never);
    const run = deliverPushes(targets(21), payload, Date.now());
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSend).toHaveBeenCalledTimes(21);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(run).resolves.toMatchObject({ sent: 20 });
  });

  it("Limit on sends in flight: never more than 20 of 100", async () => {
    let inFlight = 0;
    let peak = 0;
    mockSend.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 100));
      inFlight--;
      return healthy;
    });
    const run = deliverPushes(targets(100), payload, Date.now());
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(run).resolves.toMatchObject({ sent: 100 });
    expect(peak).toBe(20);
  });

  it("keeps the existing order when starting sends", async () => {
    await deliverPushes(targets(3), payload, Date.now());
    expect(mockSend.mock.calls.map((c) => c[0].endpoint)).toEqual(targets(3).map((t) => t.endpoint));
  });
});

describe("deliverPushes - run budget", () => {
  it("Budget used up: starts no send after 240 seconds and counts the rest", async () => {
    mockSend.mockImplementation(never);
    const run = deliverPushes(targets(400), payload, Date.now());
    await vi.advanceTimersByTimeAsync(300_000);
    await expect(run).resolves.toMatchObject({ sent: 0, notReached: 80 });
    expect(mockSend).toHaveBeenCalledTimes(320);
    expect(console.warn).toHaveBeenCalledWith(
      "[push] devices not reached",
      expect.objectContaining({ notReached: 80 }),
    );
  });

  it("Budget includes the reads: 230 seconds of reads leave 10 seconds of sends", async () => {
    mockSend.mockImplementation(never);
    const run = deliverPushes(targets(100), payload, Date.now() - 230_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(run).resolves.toMatchObject({ notReached: 80 });
    expect(mockSend).toHaveBeenCalledTimes(20);
  });
});

describe("deliverPushes - known hosts", () => {
  it("Row from before the check: skipped, not sent to and not deleted", async () => {
    const old = { ...targets(1)[0], id: "old", endpoint: "https://push.example/a" };
    const result = await deliverPushes([old, ...targets(1)], payload, Date.now());
    expect(result).toEqual({ sent: 1, deadIds: [], notReached: 0, unknownHost: 1 });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

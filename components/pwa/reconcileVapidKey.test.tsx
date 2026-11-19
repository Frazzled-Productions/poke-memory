/**
 * Tests for reconcileVapidKey (lib/push/subscribe.ts): the move to Cloudflare
 * brings a new VAPID key pair, so a browser subscription made with the old
 * public key stops receiving pushes. On load, a signed-in browser whose
 * permission is already granted swaps its subscription for one on the current
 * key and stores the new endpoint, with no permission prompt.
 *
 * Lives under components/ because it needs a window (jsdom project).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataClient } from "@/lib/db/client";
import { reconcileVapidKey } from "@/lib/push/subscribe";

/** base64url of bytes 1, 2, 3, 4: the current (new) public key. */
const CURRENT_KEY = "AQIDBA";
const CURRENT_BYTES = [1, 2, 3, 4];
const OLD_BYTES = [9, 9, 9, 9];
const OLD_ENDPOINT = "https://fcm.googleapis.com/fcm/send/old";
const NEW_ENDPOINT = "https://fcm.googleapis.com/fcm/send/new";

function buffer(bytes: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return buf;
}

type FakeSubscription = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null; userVisibleOnly: boolean };
  getKey: (name: string) => ArrayBuffer | null;
  unsubscribe: ReturnType<typeof vi.fn>;
};

function subscription(endpoint: string, keyBytes: number[] | null): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: keyBytes ? buffer(keyBytes) : null, userVisibleOnly: true },
    getKey: (name) => (name === "p256dh" ? buffer([7, 7]) : name === "auth" ? buffer([8, 8]) : null),
    unsubscribe: vi.fn(async () => true),
  };
}

let current: FakeSubscription | null;
let subscribe: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
let calls: { op: string; table: string; filters: [string, unknown][]; rows?: unknown }[];

function client(): DataClient {
  return {
    from: (table: string) => ({
      insert: async (rows: unknown) => {
        calls.push({ op: "insert", table, filters: [], rows });
        return { error: null };
      },
      delete: () => {
        const entry = { op: "delete", table, filters: [] as [string, unknown][] };
        calls.push(entry);
        const chain = {
          eq(col: string, val: unknown) {
            entry.filters.push([col, val]);
            return chain;
          },
          then<R>(onFulfilled?: (v: { error: null }) => R) {
            return Promise.resolve(onFulfilled ? onFulfilled({ error: null }) : { error: null });
          },
        };
        return chain;
      },
    }),
  } as unknown as DataClient;
}

function setPermission(permission: NotificationPermission) {
  (window as unknown as { Notification: unknown }).Notification = Object.assign(function () {}, {
    permission,
    requestPermission,
  });
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = CURRENT_KEY;
  calls = [];
  current = subscription(OLD_ENDPOINT, OLD_BYTES);
  requestPermission = vi.fn(async () => "granted");
  subscribe = vi.fn(async (opts: { applicationServerKey: ArrayBuffer }) => {
    current = subscription(NEW_ENDPOINT, Array.from(new Uint8Array(opts.applicationServerKey)));
    return current;
  });
  (window as unknown as { PushManager?: unknown }).PushManager = function () {};
  setPermission("granted");
  setOnline(true);
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      ready: Promise.resolve({ pushManager: { getSubscription: async () => current, subscribe } }),
    },
    configurable: true,
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  vi.restoreAllMocks();
});

describe("reconcileVapidKey", () => {
  it("replaces a subscription made with the old key: unsubscribes, subscribes with the current key, stores the new endpoint and deletes the old row", async () => {
    const old = current!;
    expect(await reconcileVapidKey(client(), "user-1")).toBe("resubscribed");

    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    const opts = subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer };
    expect(opts.userVisibleOnly).toBe(true);
    expect(Array.from(new Uint8Array(opts.applicationServerKey))).toEqual(CURRENT_BYTES);
    // No permission prompt: permission was already granted on this origin.
    expect(requestPermission).not.toHaveBeenCalled();

    expect(calls).toEqual([
      { op: "delete", table: "push_subscriptions", filters: [["user_id", "user-1"], ["endpoint", OLD_ENDPOINT]] },
      { op: "delete", table: "push_subscriptions", filters: [["user_id", "user-1"], ["endpoint", NEW_ENDPOINT]] },
      {
        op: "insert",
        table: "push_subscriptions",
        filters: [],
        rows: expect.objectContaining({ user_id: "user-1", endpoint: NEW_ENDPOINT, p256dh: "Bwc", auth_secret: "CAg" }),
      },
    ]);
  });

  it("leaves a subscription on the current key alone", async () => {
    current = subscription(NEW_ENDPOINT, CURRENT_BYTES);
    const sub = current;
    expect(await reconcileVapidKey(client(), "user-1")).toBe("current");
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("does nothing when notification permission is not granted", async () => {
    for (const permission of ["default", "denied"] as NotificationPermission[]) {
      setPermission(permission);
      const sub = current!;
      expect(await reconcileVapidKey(client(), "user-1")).toBe("not-granted");
      expect(sub.unsubscribe).not.toHaveBeenCalled();
    }
    expect(subscribe).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("does nothing while offline, so a later load can try again", async () => {
    setOnline(false);
    const sub = current!;
    expect(await reconcileVapidKey(client(), "user-1")).toBe("offline");
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("does nothing without a local subscription, without a VAPID key, or when the browser hides the key", async () => {
    current = null;
    expect(await reconcileVapidKey(client(), "user-1")).toBe("no-local");

    current = subscription(OLD_ENDPOINT, OLD_BYTES);
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    expect(await reconcileVapidKey(client(), "user-1")).toBe("no-vapid-key");

    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = CURRENT_KEY;
    current = subscription(OLD_ENDPOINT, null);
    expect(await reconcileVapidKey(client(), "user-1")).toBe("unknown-key");

    expect(subscribe).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("when subscribing again fails, still deletes the old row (its key no longer signs) and reports failed", async () => {
    subscribe.mockRejectedValueOnce(new Error("AbortError"));
    expect(await reconcileVapidKey(client(), "user-1")).toBe("failed");
    expect(calls).toEqual([
      { op: "delete", table: "push_subscriptions", filters: [["user_id", "user-1"], ["endpoint", OLD_ENDPOINT]] },
    ]);
  });
});

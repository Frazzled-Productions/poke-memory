/**
 * Tests for lib/push/subscribe.
 *
 * Lives under components/pwa/ rather than lib/push/ because subscribeToPush
 * touches navigator.serviceWorker, window.matchMedia, and Notification —
 * all of which require a window. Per AGENTS.md "Testing", any test that
 * uses DOM APIs must live in components/ or app/ so the jsdom vitest
 * project picks it up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPushSupported,
  isStandalone,
  subscribeToPush,
  unsubscribeFromPush,
  urlBase64ToUint8Array,
} from "@/lib/push/subscribe";

// ---------------------------------------------------------------------------
// urlBase64ToUint8Array — pure helper, deterministic
// ---------------------------------------------------------------------------
describe("urlBase64ToUint8Array", () => {
  it("decodes a base64url string into the equivalent byte array", () => {
    // 'hello' base64 is aGVsbG8=; base64url drops the padding and swaps + / for - _.
    const bytes = urlBase64ToUint8Array("aGVsbG8");
    expect(Array.from(bytes)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it("handles base64url '-' and '_' substitutions", () => {
    // 0xfb 0xff = "+/8=" in standard base64 → "-_8" in base64url (no padding).
    const bytes = urlBase64ToUint8Array("-_8");
    expect(Array.from(bytes)).toEqual([0xfb, 0xff]);
  });

  it("pads short inputs that lack the trailing '='", () => {
    // 1-byte input "f" → "Zg=="; no-padding form is "Zg".
    const bytes = urlBase64ToUint8Array("Zg");
    expect(Array.from(bytes)).toEqual([0x66]);
  });
});

// ---------------------------------------------------------------------------
// isPushSupported / isStandalone — feature detection
// ---------------------------------------------------------------------------
describe("isPushSupported", () => {
  it("returns true when the three core APIs exist", () => {
    // jsdom: PushManager and Notification are not present by default.
    Object.defineProperty(navigator, "serviceWorker", {
      value: {},
      configurable: true,
    });
    (window as unknown as { PushManager?: unknown }).PushManager = function () {};
    (window as unknown as { Notification?: unknown }).Notification = function () {};
    expect(isPushSupported()).toBe(true);
  });

  it("returns false when PushManager is missing", () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: {},
      configurable: true,
    });
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    expect(isPushSupported()).toBe(false);
  });
});

describe("isStandalone", () => {
  it("returns true when matchMedia reports standalone", () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes("standalone"),
      media: q,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    expect(isStandalone()).toBe(true);
  });

  it("returns true for iOS Safari standalone flag", () => {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    (navigator as Navigator & { standalone?: boolean }).standalone = true;
    expect(isStandalone()).toBe(true);
    delete (navigator as Navigator & { standalone?: boolean }).standalone;
  });

  it("returns false when neither signal is present", () => {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    expect(isStandalone()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// subscribeToPush / unsubscribeFromPush — DB + browser integration
// ---------------------------------------------------------------------------

type FakeSubscription = {
  endpoint: string;
  getKey: (name: string) => ArrayBuffer | null;
  unsubscribe: () => Promise<boolean>;
};

function bufferFromString(s: string): ArrayBuffer {
  // Use a fresh ArrayBuffer; Uint8Array.buffer can be a SharedArrayBuffer
  // in some environments, which trips TypeScript narrowing.
  const buf = new ArrayBuffer(s.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i);
  return buf;
}

function makeSubscription(endpoint = "https://push.example/test"): FakeSubscription {
  return {
    endpoint,
    getKey: (name: string) =>
      name === "p256dh" ? bufferFromString("p256-key-bytes") :
      name === "auth" ? bufferFromString("auth-key-bytes") :
      null,
    unsubscribe: vi.fn(async () => true),
  };
}

function makeRegistration(initial: FakeSubscription | null) {
  let current = initial;
  return {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe: vi.fn(async () => {
        current = makeSubscription();
        return current;
      }),
    },
  };
}

function makeClient(): {
  client: SupabaseClient;
  upsertCalls: unknown[];
  deleteCalls: unknown[];
  failUpsert?: boolean;
  failDelete?: boolean;
} {
  const state = {
    upsertCalls: [] as unknown[],
    deleteCalls: [] as unknown[],
    failUpsert: false,
    failDelete: false,
  };
  const client = {
    from: () => ({
      upsert: async (rows: unknown, opts?: unknown) => {
        state.upsertCalls.push({ rows, opts });
        return { error: state.failUpsert ? { message: "boom" } : null };
      },
      delete: () => ({
        eq: async (col: string, val: unknown) => {
          state.deleteCalls.push({ col, val });
          return { error: state.failDelete ? { message: "boom" } : null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return Object.assign(state, { client });
}

describe("subscribeToPush", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BMqSvZZL_test_public_key";
    (window as unknown as { PushManager?: unknown }).PushManager = function () {};
    (window as unknown as { Notification?: unknown }).Notification = function () {};
    (
      Notification as unknown as { requestPermission?: () => Promise<NotificationPermission> }
    ).requestPermission = async () => "granted";
    (
      Notification as unknown as { permission?: NotificationPermission }
    ).permission = "granted";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    vi.restoreAllMocks();
  });

  it("returns unsupported when PushManager is missing", async () => {
    // isPushSupported's serviceWorker check uses `in`, which sees prototype
    // properties — and jsdom defines serviceWorker on Navigator.prototype, so
    // `delete navigator.serviceWorker` doesn't remove it. PushManager is a
    // window-only feature with no prototype fallback, so removing it from
    // window IS the cleanest way to flip isPushSupported to false.
    const orig = (window as unknown as { PushManager?: unknown }).PushManager;
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    const { client } = makeClient();
    const result = await subscribeToPush(client, "user-1");
    expect(result).toEqual({ ok: false, reason: "unsupported" });
    (window as unknown as { PushManager?: unknown }).PushManager = orig;
  });

  it("returns no-vapid-key when env var is absent", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve(makeRegistration(null)) },
      configurable: true,
    });
    const { client } = makeClient();
    const result = await subscribeToPush(client, "user-1");
    expect(result).toEqual({ ok: false, reason: "no-vapid-key" });
  });

  it("returns permission-denied when the user declines", async () => {
    (
      Notification as unknown as { requestPermission?: () => Promise<NotificationPermission> }
    ).requestPermission = async () => "denied";
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve(makeRegistration(null)) },
      configurable: true,
    });
    const { client } = makeClient();
    const result = await subscribeToPush(client, "user-1");
    expect(result).toEqual({ ok: false, reason: "permission-denied" });
  });

  it("subscribes, persists, and returns ok", async () => {
    const registration = makeRegistration(null);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve(registration) },
      configurable: true,
    });
    const harness = makeClient();
    const result = await subscribeToPush(harness.client, "user-1");
    expect(result).toEqual({ ok: true });
    expect(registration.pushManager.subscribe).toHaveBeenCalled();
    expect(harness.upsertCalls).toHaveLength(1);
    const call = harness.upsertCalls[0] as {
      rows: { user_id: string; endpoint: string; p256dh: string; auth_secret: string };
    };
    expect(call.rows.user_id).toBe("user-1");
    expect(call.rows.endpoint).toMatch(/^https:\/\/push\./);
    expect(call.rows.p256dh.length).toBeGreaterThan(0);
    expect(call.rows.auth_secret.length).toBeGreaterThan(0);
  });

  it("reuses an existing PushManager subscription instead of re-subscribing", async () => {
    const existing = makeSubscription("https://push.example/existing");
    const registration = makeRegistration(existing);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve(registration) },
      configurable: true,
    });
    const harness = makeClient();
    const result = await subscribeToPush(harness.client, "user-1");
    expect(result.ok).toBe(true);
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    const call = harness.upsertCalls[0] as { rows: { endpoint: string } };
    expect(call.rows.endpoint).toBe("https://push.example/existing");
  });

  it("returns persist-failed when the Supabase upsert errors", async () => {
    const registration = makeRegistration(null);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve(registration) },
      configurable: true,
    });
    const harness = makeClient();
    harness.failUpsert = true;
    const result = await subscribeToPush(harness.client, "user-1");
    expect(result).toEqual({ ok: false, reason: "persist-failed" });
  });
});

describe("unsubscribeFromPush", () => {
  beforeEach(() => {
    (window as unknown as { PushManager?: unknown }).PushManager = function () {};
    (window as unknown as { Notification?: unknown }).Notification = function () {};
  });

  it("deletes the DB row and unsubscribes the PushManager", async () => {
    const existing = makeSubscription();
    const registration = makeRegistration(existing);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve(registration) },
      configurable: true,
    });
    const harness = makeClient();
    const result = await unsubscribeFromPush(harness.client, "user-1");
    expect(result).toEqual({ ok: true });
    expect(harness.deleteCalls).toEqual([{ col: "user_id", val: "user-1" }]);
    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it("returns delete-failed without unsubscribing locally when the DB delete errors", async () => {
    const existing = makeSubscription();
    const registration = makeRegistration(existing);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve(registration) },
      configurable: true,
    });
    const harness = makeClient();
    harness.failDelete = true;
    const result = await unsubscribeFromPush(harness.client, "user-1");
    expect(result).toEqual({ ok: false, reason: "delete-failed" });
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });
});

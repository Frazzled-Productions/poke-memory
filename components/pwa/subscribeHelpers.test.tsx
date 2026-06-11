/**
 * Unit tests for lib/push/subscribe.ts helpers.
 *
 * Lives under components/ so the jsdom vitest project picks it up - the
 * subscribe helpers use browser globals (navigator.serviceWorker, PushManager,
 * Notification) that require a DOM environment.
 *
 * Covers the pure helpers (urlBase64ToUint8Array) and the
 * reconcileSubscription logic (#1858 F35).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  urlBase64ToUint8Array,
  reconcileSubscription,
  type ReconcileResult,
} from "@/lib/push/subscribe";

// ---------------------------------------------------------------------------
// urlBase64ToUint8Array
// ---------------------------------------------------------------------------

describe("urlBase64ToUint8Array", () => {
  it("decodes a well-formed base64url key to the correct byte length", () => {
    // A VAPID public key is an uncompressed P-256 point = 65 bytes.
    const fake65 = btoa(String.fromCharCode(...new Array(65).fill(0xa5)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = urlBase64ToUint8Array(fake65);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(65);
  });

  it("round-trips through base64url encoding", () => {
    const source = new Uint8Array([1, 2, 3, 200, 255, 128]);
    const encoded = btoa(String.fromCharCode(...source))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const decoded = urlBase64ToUint8Array(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(source));
  });
});

// ---------------------------------------------------------------------------
// reconcileSubscription
// ---------------------------------------------------------------------------

/**
 * A minimal Supabase client stub.
 */
function makeMockClient(opts: {
  selectData?: { endpoint: string } | null;
  selectError?: { message: string } | null;
  deleteError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const from = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.selectData ?? null,
            error: opts.selectError ?? null,
          }),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: opts.deleteError ?? null }),
      }),
    }),
    insert: vi.fn().mockResolvedValue({ error: opts.insertError ?? null }),
  }));
  return { from } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

function mockNavigatorServiceWorker(subscription: PushSubscription | null) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
    },
  } as unknown as ServiceWorkerRegistration;

  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
    writable: true,
  });
  return registration;
}

function makeFakeSubscription(endpoint = "https://push.example.com/sub/1"): PushSubscription {
  const fakeKey = new ArrayBuffer(16);
  return {
    endpoint,
    getKey: vi.fn().mockReturnValue(fakeKey),
    toJSON: vi.fn().mockReturnValue({ endpoint, keys: { p256dh: "abc", auth: "def" } }),
  } as unknown as PushSubscription;
}

beforeEach(() => {
  // Ensure PushManager, Notification, and window globals are present so
  // isPushSupported() returns true in most tests.
  if (!("PushManager" in globalThis)) {
    Object.defineProperty(globalThis, "PushManager", {
      value: class PushManager {},
      configurable: true,
      writable: true,
    });
  }
  if (!("Notification" in globalThis)) {
    Object.defineProperty(globalThis, "Notification", {
      value: { permission: "granted" },
      configurable: true,
      writable: true,
    });
  }
  // Ensure NEXT_PUBLIC_VAPID_PUBLIC_KEY is set so isPushSupported + reconcile
  // can proceed past the VAPID key guard.
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "fake-vapid-key";
});

describe("reconcileSubscription", () => {
  it("returns 'no-local' when PushManager returns null subscription", async () => {
    mockNavigatorServiceWorker(null);
    const client = makeMockClient({});
    const result: ReconcileResult = await reconcileSubscription(client, "user-1");
    expect(result).toBe("no-local");
  });

  it("returns 'in-sync' when a matching server row exists", async () => {
    const sub = makeFakeSubscription();
    mockNavigatorServiceWorker(sub);
    const client = makeMockClient({ selectData: { endpoint: sub.endpoint } });
    const result = await reconcileSubscription(client, "user-1");
    expect(result).toBe("in-sync");
  });

  it("returns 're-inserted' when no server row exists and re-insert succeeds", async () => {
    const sub = makeFakeSubscription();
    mockNavigatorServiceWorker(sub);
    const client = makeMockClient({ selectData: null });
    const result = await reconcileSubscription(client, "user-1");
    expect(result).toBe("re-inserted");
  });

  it("returns 'disabled' when no server row exists and re-insert fails", async () => {
    const sub = makeFakeSubscription();
    mockNavigatorServiceWorker(sub);
    const client = makeMockClient({
      selectData: null,
      insertError: { message: "insert denied" },
    });
    const result = await reconcileSubscription(client, "user-1");
    expect(result).toBe("disabled");
  });

  it("returns 'in-sync' (non-disruptive) when the SELECT query errors", async () => {
    // A query failure should not flip the toggle off - treat as in-sync to
    // avoid false-positive disables when the network is flaky.
    const sub = makeFakeSubscription();
    mockNavigatorServiceWorker(sub);
    const client = makeMockClient({ selectError: { message: "network error" } });
    const result = await reconcileSubscription(client, "user-1");
    expect(result).toBe("in-sync");
  });

  it("returns 'no-local' when NEXT_PUBLIC_VAPID_PUBLIC_KEY is absent", async () => {
    // reconcileSubscription bails early without the VAPID key.
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const sub = makeFakeSubscription();
    mockNavigatorServiceWorker(sub);
    const client = makeMockClient({ selectData: { endpoint: sub.endpoint } });
    const result = await reconcileSubscription(client, "user-1");
    expect(result).toBe("no-local");
  });
});

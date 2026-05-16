import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deleteAccountEverywhere } from "@/lib/sync/deleteAccount";
import { clearLocalProgress } from "@/lib/storage/reset";

// deleteAccountEverywhere sweeps localStorage — including the
// poke-memory:settings:* keys that clearLocalProgress deliberately spares.
// That sweep needs a real DOM, so this test lives in the jsdom project (it
// would crash in the DOM-free `node` project). The RPC-orchestration tests
// live alongside the source in lib/sync/deleteAccount.test.ts.

vi.mock("@/lib/storage/reset", () => ({
  clearLocalProgress: vi.fn(async () => {}),
}));

function makeRpcClient(rpcError: null | object = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ error: rpcError, data: null }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

// jsdom on this Node version does not ship localStorage out of the box, so
// the test provides its own in-memory stub — matching the pattern used in
// CollapsibleSection.test.tsx / VoiceQualityHint.test.tsx.
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
}

describe("deleteAccountEverywhere — localStorage sweep", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(clearLocalProgress).mockClear();
    vi.mocked(clearLocalProgress).mockImplementation(async () => {});
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("clears ALL poke-memory keys including settings keys", async () => {
    // A normal reset (clearLocalProgress) spares poke-memory:settings:*.
    // Account deletion is a full erasure — those keys must go too.
    localStorage.setItem("poke-memory:settings:v1", "{}");
    localStorage.setItem("poke-memory:review-session:v1", "[]");
    localStorage.setItem("poke-memory:superuser:flags", "{}");
    localStorage.setItem("unrelated-key", "keep-me");

    const result = await deleteAccountEverywhere(makeRpcClient());

    expect(result).toEqual({ ok: true });
    expect(localStorage.getItem("poke-memory:settings:v1")).toBeNull();
    expect(localStorage.getItem("poke-memory:review-session:v1")).toBeNull();
    expect(localStorage.getItem("poke-memory:superuser:flags")).toBeNull();
    // Keys outside the poke-memory namespace are untouched.
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
  });

  it("does not clear localStorage when the cloud delete fails", async () => {
    localStorage.setItem("poke-memory:settings:v1", "{}");
    const result = await deleteAccountEverywhere(
      makeRpcClient({ message: "boom" }),
    );
    expect(result).toEqual({ ok: false, reason: "cloud-delete-failed" });
    expect(localStorage.getItem("poke-memory:settings:v1")).toBe("{}");
  });
});

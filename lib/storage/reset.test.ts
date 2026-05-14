import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocalProgress } from "./reset";
import { idbGet, idbSet, __resetForTests } from "@/lib/idb/db";

// Node 22+ exposes its own gated localStorage at the global scope which
// hides jsdom's window.localStorage in component tests (see the
// "depending on jsdom's gated localStorage" note in
// components/onboarding/OnboardingHint.test.tsx). Stubbing window here
// gives us a deterministic in-memory localStorage + a real dispatchEvent
// so the StorageEvent assertion works in the node project. The IDB layer
// runs against fake-indexeddb's global polyfill (imported above and via
// vitest.setup.node.ts).

// Real browser localStorage exposes entries both via the Storage methods
// AND as enumerable own properties — `Object.keys(localStorage)` walks the
// stored keys directly. The function under test uses that idiom, so the
// stub must too. A Proxy bridges Map storage to property access.
function makeStubStorage(): Storage {
  const data = new Map<string, string>();
  const api = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => {
      data.clear();
    },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && data.has(prop)) {
        return data.get(prop);
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (typeof prop === "string" && !(prop in target)) {
        data.set(prop, String(value));
        return true;
      }
      return Reflect.set(target, prop, value, receiver);
    },
    deleteProperty(target, prop) {
      if (typeof prop === "string" && data.has(prop)) {
        data.delete(prop);
        return true;
      }
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys() {
      return Array.from(data.keys());
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && data.has(prop)) {
        return {
          value: data.get(prop),
          enumerable: true,
          configurable: true,
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  }) as unknown as Storage;
}

describe("clearLocalProgress", () => {
  const events: Array<{ key: string | null }> = [];
  const stubLocalStorage = makeStubStorage();

  beforeEach(async () => {
    await __resetForTests();
    stubLocalStorage.clear();
    events.length = 0;
    vi.stubGlobal("window", {
      localStorage: stubLocalStorage,
      indexedDB: globalThis.indexedDB,
      dispatchEvent: (e: Event) => {
        events.push({ key: (e as unknown as { key?: string | null }).key ?? null });
        return true;
      },
    });
    // The function reads via the global `localStorage` reference too,
    // because window.localStorage and globalThis.localStorage are the
    // same reference in the browser. Mirror that here.
    vi.stubGlobal("localStorage", stubLocalStorage);
    // StorageEvent isn't a built-in in node — provide a minimal
    // constructor that captures the key, since the function uses
    // `new StorageEvent("storage", { key })`.
    // lib/review/persistence.test.ts has a similar stub that also extends
    // Event and captures storageArea/newValue. The two stubs differ in shape
    // (this one only needs key; that one drives full-reload assertions), so
    // extracting a shared helper would force a lowest-common-denominator
    // interface. Keeping them inline is intentional until a third consumer
    // makes extraction worthwhile.
    vi.stubGlobal("StorageEvent", class {
      key: string | null;
      constructor(_type: string, init: { key?: string | null }) {
        this.key = init.key ?? null;
      }
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await __resetForTests();
  });

  it("removes poke-memory:* localStorage keys while preserving settings:* keys", async () => {
    stubLocalStorage.setItem("poke-memory:streak", "5");
    stubLocalStorage.setItem("poke-memory:scope", '{"axes":[]}');
    stubLocalStorage.setItem("poke-memory:settings:retention", "0.9");
    stubLocalStorage.setItem("poke-memory:settings:theme", "dark");
    stubLocalStorage.setItem("unrelated:key", "kept");

    await clearLocalProgress();

    expect(stubLocalStorage.getItem("poke-memory:streak")).toBeNull();
    expect(stubLocalStorage.getItem("poke-memory:scope")).toBeNull();
    expect(stubLocalStorage.getItem("poke-memory:settings:retention")).toBe("0.9");
    expect(stubLocalStorage.getItem("poke-memory:settings:theme")).toBe("dark");
    expect(stubLocalStorage.getItem("unrelated:key")).toBe("kept");
  });

  it("deletes the IDB review-session, grade-log, and migration-flag keys", async () => {
    await idbSet("poke-memory:review-session:v1", '{"cards":[]}');
    await idbSet("poke-memory:grade-log:v1", '[{"grade":4}]');
    // The real migrateFromLocalStorage stores the flag as a native boolean via
    // a transaction in lib/idb/db.ts, but idbSet/idbGet only handle strings —
    // idbGet returns null for non-string values. We seed a string here so idbGet
    // can verify presence; the production delete path doesn't care about the
    // stored type, so this test exercises the right code path.
    await idbSet("migration_done_v1", "true");
    expect(await idbGet("poke-memory:review-session:v1")).not.toBeNull();
    expect(await idbGet("poke-memory:grade-log:v1")).not.toBeNull();
    expect(await idbGet("migration_done_v1")).not.toBeNull();

    await clearLocalProgress();

    expect(await idbGet("poke-memory:review-session:v1")).toBeNull();
    expect(await idbGet("poke-memory:grade-log:v1")).toBeNull();
    expect(await idbGet("migration_done_v1")).toBeNull();
  });

  it("dispatches synthetic StorageEvents for both the session and grade-log keys", async () => {
    await clearLocalProgress();
    const keys = events.map((e) => e.key);
    expect(keys).toContain("poke-memory:review-session:v1");
    // The grade-log dispatch is the explicit delete signal — without it, same-
    // tab subscribers that read grade-log independently of the session would
    // not pick up the reset.
    expect(keys).toContain("poke-memory:grade-log:v1");
  });
});

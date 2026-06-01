/**
 * Unit tests for `loadPendingQueue`'s deserialization and validation logic (#893).
 *
 * These tests operate directly against the real `loadPendingQueue` (no module
 * mock) using a jsdom localStorage stub. They cover the per-entry validation
 * branches added to guard against partially-corrupted storage: missing or
 * wrong-typed `cardType`, `subjectKey`, `state`, `id`, plus top-level failure
 * modes (key absent, unparseable JSON, non-array JSON).
 *
 * File lives under components/ (not lib/) because the jsdom project covers
 * components/**\/*.test.tsx — loadPendingQueue reads localStorage, which
 * requires a DOM environment.
 *
 * jsdom on this Node version does not ship localStorage out of the box, so
 * the test provides its own in-memory stub — matching the pattern used in
 * components/settings/deleteAccount-local.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadPendingQueue,
  PENDING_QUEUE_KEY,
} from "@/lib/sync/persistence";

// ─── localStorage stub ────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Write arbitrary JSON into the queue key. */
function setRaw(value: unknown): void {
  localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(value));
}

/** Write a deliberately unparseable string into the queue key. */
function setUnparseable(): void {
  localStorage.setItem(PENDING_QUEUE_KEY, "not valid json {{{{");
}

/**
 * A minimal well-formed entry — contains all four required fields with the
 * correct types. Additional ReviewableCard fields are intentionally omitted;
 * `loadPendingQueue` only validates the minimum set.
 */
function wellFormed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    cardType: "name",
    subjectKey: "1",
    state: { stability: 1, difficulty: 0 },
    ...overrides,
  };
}

// ─── Shared setup/teardown ────────────────────────────────────────────────────

function installLocalStorage() {
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
}

function removeLocalStorage() {
  delete (window as unknown as { localStorage?: unknown }).localStorage;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("loadPendingQueue — top-level failure modes", () => {
  beforeEach(installLocalStorage);
  afterEach(removeLocalStorage);

  it("returns an empty array when the key is absent", () => {
    expect(loadPendingQueue()).toEqual([]);
  });

  it("returns an empty array when the stored value is not valid JSON", () => {
    setUnparseable();
    expect(loadPendingQueue()).toEqual([]);
  });

  it("returns an empty array when the stored value is a JSON object (not an array)", () => {
    setRaw({ id: 1, cardType: "name", subjectKey: "1", state: {} });
    expect(loadPendingQueue()).toEqual([]);
  });

  it("returns an empty array when the stored value is a JSON string", () => {
    setRaw("a string");
    expect(loadPendingQueue()).toEqual([]);
  });

  it("returns an empty array when the stored value is a JSON number", () => {
    setRaw(42);
    expect(loadPendingQueue()).toEqual([]);
  });

  it("returns an empty array when the stored value is JSON null", () => {
    setRaw(null);
    expect(loadPendingQueue()).toEqual([]);
  });
});

describe("loadPendingQueue — per-entry validation (malformed entries are dropped)", () => {
  beforeEach(installLocalStorage);
  afterEach(removeLocalStorage);

  // ─── Well-formed baseline ───────────────────────────────────────────────────

  it("passes through a well-formed entry", () => {
    setRaw([wellFormed()]);
    const result = loadPendingQueue();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 1, cardType: "name", subjectKey: "1" });
  });

  it("passes through multiple well-formed entries", () => {
    setRaw([wellFormed({ id: 1, subjectKey: "1" }), wellFormed({ id: 2, subjectKey: "2" })]);
    expect(loadPendingQueue()).toHaveLength(2);
  });

  // ─── null / non-object items ────────────────────────────────────────────────

  it("drops a null array entry", () => {
    setRaw([null, wellFormed()]);
    expect(loadPendingQueue()).toHaveLength(1);
  });

  it("drops a primitive string entry", () => {
    setRaw(["bad", wellFormed()]);
    expect(loadPendingQueue()).toHaveLength(1);
  });

  it("drops a primitive number entry", () => {
    setRaw([42, wellFormed()]);
    expect(loadPendingQueue()).toHaveLength(1);
  });

  // ─── Missing `id` ──────────────────────────────────────────────────────────

  it("drops an entry missing the `id` field", () => {
    const entry = wellFormed();
    delete entry.id;
    setRaw([entry, wellFormed({ id: 99, subjectKey: "99" })]);
    const result = loadPendingQueue();
    // Only the valid entry (id 99) should survive.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(99);
  });

  // ─── Missing or wrong-typed `cardType` ─────────────────────────────────────

  it("drops an entry missing the `cardType` field", () => {
    const entry = wellFormed();
    delete entry.cardType;
    setRaw([entry]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `cardType` is a number (not a string)", () => {
    setRaw([wellFormed({ cardType: 42 })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `cardType` is null", () => {
    setRaw([wellFormed({ cardType: null })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `cardType` is an object", () => {
    setRaw([wellFormed({ cardType: { kind: "name" } })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  // ─── Missing or wrong-typed `subjectKey` ───────────────────────────────────

  it("drops an entry missing the `subjectKey` field", () => {
    const entry = wellFormed();
    delete entry.subjectKey;
    setRaw([entry]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `subjectKey` is a number (not a string)", () => {
    setRaw([wellFormed({ subjectKey: 1 })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `subjectKey` is null", () => {
    setRaw([wellFormed({ subjectKey: null })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `subjectKey` is an array", () => {
    setRaw([wellFormed({ subjectKey: ["1"] })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  // ─── Missing, null, or non-object `state` ──────────────────────────────────

  it("drops an entry missing the `state` field", () => {
    const entry = wellFormed();
    delete entry.state;
    setRaw([entry]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `state` is null", () => {
    setRaw([wellFormed({ state: null })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `state` is a string", () => {
    setRaw([wellFormed({ state: "corrupted" })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `state` is a number", () => {
    setRaw([wellFormed({ state: 0 })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  it("drops an entry where `state` is a boolean", () => {
    setRaw([wellFormed({ state: false })]);
    expect(loadPendingQueue()).toHaveLength(0);
  });

  // ─── Mixed arrays — valid entries survive partial corruption ───────────────

  it("keeps valid entries when a mix of valid and invalid entries are stored", () => {
    setRaw([
      null,
      wellFormed({ id: 1, subjectKey: "1" }),
      wellFormed({ id: 2, subjectKey: "2", cardType: 99 }),  // cardType is number — dropped
      wellFormed({ id: 3, subjectKey: "3" }),
      { id: 4, cardType: "name", subjectKey: "4" },          // missing state — dropped
    ]);

    const result = loadPendingQueue();
    expect(result).toHaveLength(2);
    const ids = result.map((c) => c.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
  });

  it("returns an empty array when every entry is malformed", () => {
    setRaw([
      null,
      { id: 1, cardType: 42, subjectKey: "1", state: {} },
      { id: 2, cardType: "name", subjectKey: 2, state: {} },
      { id: 3, cardType: "name", subjectKey: "3", state: null },
    ]);
    expect(loadPendingQueue()).toHaveLength(0);
  });
});

import { describe, it, expect } from "vitest";
import { deepEqual } from "./deepEqual";

describe("deepEqual", () => {
  // ── Primitives ──────────────────────────────────────────────────────────────

  it("returns true for identical primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it("returns false for different primitives", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
    expect(deepEqual(true, false)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
  });

  it("handles NaN via Object.is (NaN equals NaN)", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  // ── Arrays ──────────────────────────────────────────────────────────────────

  it("returns true for equal arrays", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([], [])).toBe(true);
  });

  it("returns false for arrays of different lengths", () => {
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("returns false for arrays with different elements", () => {
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
  });

  it("treats array order as significant ([1,2] != [2,1])", () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });

  it("handles nested arrays", () => {
    expect(deepEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true);
    expect(deepEqual([[1, 2], [3]], [[1, 2], [4]])).toBe(false);
  });

  // ── Objects ─────────────────────────────────────────────────────────────────

  it("returns true for equal flat objects", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("returns true for equal objects regardless of key insertion order", () => {
    // This is the core property that JSON.stringify does NOT guarantee.
    const a = { balance: 0, spendDates: [] as string[], daysSinceLastEarn: 0 };
    const b = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(deepEqual(a, b)).toBe(true);
  });

  it("returns false when key sets differ", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it("returns false when a value differs", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it("handles nested objects", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("handles objects with null values", () => {
    expect(deepEqual({ a: null }, { a: null })).toBe(true);
    expect(deepEqual({ a: null }, { a: 0 })).toBe(false);
  });

  // ── Mixed ───────────────────────────────────────────────────────────────────

  it("returns false when one is an array and the other is an object", () => {
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({}, [])).toBe(false);
  });

  it("returns false when one is a primitive and the other is an object", () => {
    expect(deepEqual(1, { valueOf: () => 1 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it("handles deeply nested mixed structures", () => {
    const a = { streakProtection: { balance: 0, spendDates: ["2026-05-29"], daysSinceLastEarn: 1 } };
    const b = { streakProtection: { balance: 0, spendDates: ["2026-05-29"], daysSinceLastEarn: 1 } };
    expect(deepEqual(a, b)).toBe(true);
    const c = { streakProtection: { balance: 0, spendDates: ["2026-05-28"], daysSinceLastEarn: 1 } };
    expect(deepEqual(a, c)).toBe(false);
  });
});

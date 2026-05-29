/**
 * Unit tests for the message-catalogue completeness gate logic.
 *
 * The gate script (scripts/lint-i18n.mjs) cannot be imported directly in
 * vitest because it uses top-level `process.exit` calls. Instead, we test the
 * two pure helpers it is built from — `enumerateKeys` — by reproducing them
 * here and verifying they correctly detect structural divergence between an en
 * baseline and a non-English catalogue.
 *
 * The real script is exercised as a CLI smoke-test in the "verify" block at
 * the bottom of this file (subprocess execution, not import).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SCRIPT = resolve(REPO_ROOT, "scripts/lint-i18n.mjs");

// ---------------------------------------------------------------------------
// Replicate the pure helper from the script so we can unit-test the logic
// without spawning a child process for each case.
// ---------------------------------------------------------------------------

function enumerateKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return [prefix];
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(...enumerateKeys(v, path));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// enumerateKeys
// ---------------------------------------------------------------------------

describe("enumerateKeys", () => {
  it("returns a single path for a flat scalar value", () => {
    expect(enumerateKeys("hello", "foo")).toEqual(["foo"]);
  });

  it("returns dot-paths for a flat object", () => {
    const keys = enumerateKeys({ a: 1, b: 2 });
    expect(keys.sort()).toEqual(["a", "b"]);
  });

  it("returns nested dot-paths for a nested object", () => {
    const keys = enumerateKeys({ a: { b: 1, c: 2 }, d: 3 });
    expect(keys.sort()).toEqual(["a.b", "a.c", "d"]);
  });

  it("handles three levels of nesting", () => {
    const keys = enumerateKeys({ settings: { section: { appearance: "x" } } });
    expect(keys).toEqual(["settings.section.appearance"]);
  });

  it("treats array leaf values as leaf (not recursed)", () => {
    // Arrays are not recursed — the path stops at the array node itself.
    // We test by passing an array directly as the obj argument.
    const keys = enumerateKeys(["a", "b"], "items");
    expect(keys).toEqual(["items"]);
  });
});

// ---------------------------------------------------------------------------
// Structural diff logic
// ---------------------------------------------------------------------------

function diff(en: object, locale: object) {
  const enKeys = new Set(enumerateKeys(en));
  const localeKeys = new Set(enumerateKeys(locale));
  const missing = [...enKeys].filter((k) => !localeKeys.has(k)).sort();
  const extra = [...localeKeys].filter((k) => !enKeys.has(k)).sort();
  return { missing, extra };
}

describe("catalogue diff", () => {
  it("returns empty arrays when catalogues are identical", () => {
    const en = { a: { b: "hello" }, c: "world" };
    expect(diff(en, { a: { b: "こんにちは" }, c: "世界" })).toEqual({
      missing: [],
      extra: [],
    });
  });

  it("reports missing keys when locale has fewer keys than en", () => {
    const en = { a: "1", b: "2" };
    const ja = { a: "1" };
    expect(diff(en, ja)).toEqual({ missing: ["b"], extra: [] });
  });

  it("reports extra keys when locale has keys en doesn't", () => {
    const en = { a: "1" };
    const ja = { a: "1", b: "2" };
    expect(diff(en, ja)).toEqual({ missing: [], extra: ["b"] });
  });

  it("reports both missing and extra keys simultaneously", () => {
    const en = { a: "1", b: "2" };
    const ja = { a: "1", c: "3" };
    expect(diff(en, ja)).toEqual({ missing: ["b"], extra: ["c"] });
  });

  it("detects nested missing key", () => {
    const en = { nav: { brand: "x", practice: "y" } };
    const ja = { nav: { brand: "z" } };
    expect(diff(en, ja)).toEqual({ missing: ["nav.practice"], extra: [] });
  });

  it("detects nested extra key", () => {
    const en = { nav: { brand: "x" } };
    const ja = { nav: { brand: "z", extra: "surplus" } };
    expect(diff(en, ja)).toEqual({ missing: [], extra: ["nav.extra"] });
  });
});

// ---------------------------------------------------------------------------
// CLI smoke test — the actual script must exit 0 on the real catalogues
// ---------------------------------------------------------------------------

describe("lint-i18n.mjs CLI", () => {
  it("exits 0 when all catalogues match en (current repo state)", () => {
    // If this throws, the script exited non-zero — a catalogue has drifted.
    expect(() =>
      execFileSync("node", [SCRIPT], { encoding: "utf8" }),
    ).not.toThrow();
  });
});

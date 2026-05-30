/**
 * Unit tests for the message-catalogue completeness and duplicate-key gate logic.
 *
 * The gate script (scripts/lint-i18n.mjs) cannot be imported directly in
 * vitest because it calls `process.exit` in its `main()` function. Instead,
 * we test the two pure exported helpers -- `enumerateKeys` and
 * `findDuplicateKeys` -- by replicating them here and verifying they correctly
 * detect structural divergence and duplicate keys.
 *
 * The real script is exercised as a CLI smoke-test at the bottom of this file
 * (subprocess execution, not import).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SCRIPT = resolve(REPO_ROOT, "scripts/lint-i18n.mjs");

// ---------------------------------------------------------------------------
// Replicate the pure helpers from the script so we can unit-test the logic
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

type DuplicateFinding = { dotPath: string; line1: number; line2: number };

/**
 * Replica of the script's findDuplicateKeys for unit-testing without spawning.
 * Must be kept in sync with scripts/lint-i18n.mjs.
 */
function findDuplicateKeys(text: string): DuplicateFinding[] {
  const duplicates: DuplicateFinding[] = [];

  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }

  function charToLine(pos: number): number {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  let i = 0;
  const n = text.length;
  const pathStack: string[] = [];

  function skipWhitespace() {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) {
      i++;
    }
  }

  function readString(): string {
    i++;
    let s = "";
    while (i < n) {
      const c = text[i];
      if (c === "\\") {
        i++;
        const esc = text[i];
        if (esc === "u") {
          s += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
          i += 5;
        } else {
          const escMap: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          s += escMap[esc] ?? esc;
          i++;
        }
      } else if (c === '"') {
        i++;
        break;
      } else {
        s += c;
        i++;
      }
    }
    return s;
  }

  function parseValue(): void {
    skipWhitespace();
    if (i >= n) return;
    const c = text[i];
    if (c === "{") parseObject();
    else if (c === "[") parseArray();
    else if (c === '"') readString();
    else if (c === "-" || (c >= "0" && c <= "9")) {
      while (i < n && text[i] !== "," && text[i] !== "}" && text[i] !== "]" &&
             text[i] !== " " && text[i] !== "\t" && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
    } else if (text.slice(i, i + 4) === "true") i += 4;
    else if (text.slice(i, i + 5) === "false") i += 5;
    else if (text.slice(i, i + 4) === "null") i += 4;
  }

  function parseObject(): void {
    i++;
    const seenKeys = new Map<string, number>();
    skipWhitespace();
    if (i < n && text[i] === "}") { i++; return; }
    while (i < n) {
      skipWhitespace();
      if (i >= n || text[i] !== '"') break;
      const keyLine = charToLine(i);
      const key = readString();
      const dotPath = pathStack.length > 0 ? `${pathStack.join(".")}.${key}` : key;
      if (seenKeys.has(key)) {
        duplicates.push({ dotPath, line1: seenKeys.get(key)!, line2: keyLine });
      } else {
        seenKeys.set(key, keyLine);
      }
      skipWhitespace();
      if (i < n && text[i] === ":") i++;
      pathStack.push(key);
      parseValue();
      pathStack.pop();
      skipWhitespace();
      if (i < n && text[i] === ",") i++;
      else break;
    }
    skipWhitespace();
    if (i < n && text[i] === "}") i++;
  }

  function parseArray(): void {
    i++;
    skipWhitespace();
    if (i < n && text[i] === "]") { i++; return; }
    while (i < n) {
      parseValue();
      skipWhitespace();
      if (i < n && text[i] === ",") i++;
      else break;
    }
    skipWhitespace();
    if (i < n && text[i] === "]") i++;
  }

  parseValue();
  return duplicates;
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
    // Arrays are not recursed -- the path stops at the array node itself.
    const keys = enumerateKeys(["a", "b"], "items");
    expect(keys).toEqual(["items"]);
  });
});

// ---------------------------------------------------------------------------
// findDuplicateKeys
// ---------------------------------------------------------------------------

describe("findDuplicateKeys", () => {
  it("returns empty array for a clean flat object", () => {
    expect(findDuplicateKeys('{"a": 1, "b": 2}')).toEqual([]);
  });

  it("returns empty array for a clean nested object", () => {
    expect(findDuplicateKeys('{"a": {"b": 1, "c": 2}, "d": 3}')).toEqual([]);
  });

  it("detects a duplicate key in a flat object", () => {
    const result = findDuplicateKeys('{"a": 1, "b": 2, "a": 3}');
    expect(result).toHaveLength(1);
    expect(result[0].dotPath).toBe("a");
    expect(result[0].line1).toBe(1);
    expect(result[0].line2).toBe(1); // same line (single-line JSON)
  });

  it("detects a duplicate key in a nested object with correct dot-path", () => {
    const raw = `{
  "practice": {
    "todayNew": "new",
    "todayReviewed": "reviewed",
    "todayNew": "new cards"
  }
}`;
    const result = findDuplicateKeys(raw);
    expect(result).toHaveLength(1);
    expect(result[0].dotPath).toBe("practice.todayNew");
    expect(result[0].line1).toBe(3); // "todayNew": "new" is on line 3
    expect(result[0].line2).toBe(5); // second "todayNew" is on line 5
  });

  it("detects multiple duplicate keys in the same object", () => {
    const raw = `{
  "practice": {
    "a": "1",
    "b": "2",
    "a": "3",
    "b": "4"
  }
}`;
    const result = findDuplicateKeys(raw);
    expect(result).toHaveLength(2);
    const paths = result.map((r) => r.dotPath).sort();
    expect(paths).toEqual(["practice.a", "practice.b"]);
  });

  it("detects a duplicate key in a deeply nested object", () => {
    const raw = `{
  "settings": {
    "section": {
      "key": "first",
      "key": "second"
    }
  }
}`;
    const result = findDuplicateKeys(raw);
    expect(result).toHaveLength(1);
    expect(result[0].dotPath).toBe("settings.section.key");
    expect(result[0].line1).toBe(4);
    expect(result[0].line2).toBe(5);
  });

  it("does NOT flag the same short key name in different parent objects", () => {
    // "heading" and "label" appear under many different parent objects -- those
    // are NOT duplicates because they are in different JSON object contexts.
    const raw = `{
  "nav": {"heading": "Navigation"},
  "practice": {"heading": "Practice"}
}`;
    const result = findDuplicateKeys(raw);
    expect(result).toEqual([]);
  });

  it("returns both line numbers for a multi-line duplicate", () => {
    const raw = `{
  "a": "first",
  "b": "middle",
  "a": "duplicate"
}`;
    const result = findDuplicateKeys(raw);
    expect(result).toHaveLength(1);
    expect(result[0].line1).toBe(2);
    expect(result[0].line2).toBe(4);
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
    expect(diff(en, { a: { b: "\u3053\u3093\u306b\u3061\u306f" }, c: "\u4e16\u754c" })).toEqual({
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
// CLI smoke tests -- the actual script must behave correctly end-to-end
// ---------------------------------------------------------------------------

describe("lint-i18n.mjs CLI", () => {
  it("exits 0 when all catalogues match en and have no duplicates (current repo state)", () => {
    // If this throws, the script exited non-zero -- a catalogue has drifted or
    // has duplicate keys.
    expect(() =>
      execFileSync("node", [SCRIPT], { encoding: "utf8" }),
    ).not.toThrow();
  });

  it("exits non-zero and reports the duplicate dot-path when en.json has a duplicate key", () => {
    const messagesDir = join(REPO_ROOT, "messages");
    const enPath = join(messagesDir, "en.json");
    const original = readFileSync(enPath, "utf8");

    // Inject a duplicate key by inserting a second "brand" entry under "nav".
    const patched = original.replace(
      '  "brand": "poke-memory",',
      '  "brand": "poke-memory",\n    "brand": "DUPLICATE",',
    );
    writeFileSync(enPath, patched);

    let caughtStderr = "";
    let caughtStatus = 0;
    try {
      execFileSync("node", [SCRIPT], { encoding: "utf8" });
    } catch (err: unknown) {
      const execError = err as { status?: number; stderr?: string };
      caughtStatus = execError.status ?? 0;
      caughtStderr = execError.stderr ?? "";
    } finally {
      // Always restore -- test must be idempotent.
      writeFileSync(enPath, original);
    }

    expect(caughtStatus).toBe(1);
    expect(caughtStderr).toContain("DUPLICATE");
    expect(caughtStderr).toContain("nav.brand");
  });
});

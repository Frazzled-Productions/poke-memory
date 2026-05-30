#!/usr/bin/env node
// Message-catalogue completeness and integrity gate.
//
// Loads messages/en.json as the key-set baseline and diffs each non-English
// catalogue (ja, zh-Hans, zh-Hant) against it. Fails (exit 1) when any locale
// is MISSING a key that en has, or has an EXTRA key that en doesn't -- both
// directions are checked because extra keys are dead code that signal drift.
//
// ALSO detects DUPLICATE keys within any catalogue. JSON.parse silently keeps
// the last occurrence, so duplicates with different values produce a silently
// wrong translation at runtime. The duplicate check runs on the raw text before
// JSON.parse so duplication is never masked.
//
// Run directly: `node scripts/lint-i18n.mjs` (or `npm run lint:i18n`).
// Exit code 0 = all catalogues are structurally identical to en AND have no duplicate keys.
// Exit code 1 = at least one missing key, extra key, or duplicate key found.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MESSAGES_DIR = join(REPO_ROOT, "messages");

const ALL_LOCALES = ["en", "ja", "zh-Hans", "zh-Hant"];
const LOCALES_TO_DIFF = ["ja", "zh-Hans", "zh-Hant"];

/**
 * Recursively enumerates all leaf keys in a nested JSON object as dot-paths.
 * Example: { a: { b: 1, c: 2 } } => ["a.b", "a.c"]
 *
 * @param {unknown} obj
 * @param {string} prefix
 * @returns {string[]}
 */
export function enumerateKeys(obj, prefix = "") {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return [prefix];
  }
  const keys = [];
  for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (obj))) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(...enumerateKeys(v, path));
  }
  return keys;
}

/**
 * Scans raw JSON text for duplicate keys at any nesting depth.
 *
 * JSON.parse silently keeps the last occurrence of a duplicate key, so this
 * check MUST run on the raw text -- after parse the duplicate is gone.
 *
 * Returns an array of findings: { dotPath, line1, line2 } where dotPath is the
 * full dot-path to the duplicate key, line1 is the first occurrence (line
 * number, 1-based), and line2 is the duplicate occurrence.
 *
 * @param {string} text  Raw JSON file contents.
 * @returns {{ dotPath: string; line1: number; line2: number }[]}
 */
export function findDuplicateKeys(text) {
  /** @type {{ dotPath: string; line1: number; line2: number }[]} */
  const duplicates = [];

  // Build a line-start offset index so we can convert char positions to
  // 1-based line numbers cheaply.
  /** @type {number[]} */
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }

  /**
   * Binary search: return 1-based line number for a char offset.
   * @param {number} pos
   * @returns {number}
   */
  function charToLine(pos) {
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

  /** @type {string[]} */
  const pathStack = [];

  function skipWhitespace() {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) {
      i++;
    }
  }

  /**
   * Read a JSON string starting at i (which must be a double-quote). Advances i
   * past the closing quote and returns the unescaped string content.
   * @returns {string}
   */
  function readString() {
    i++; // skip opening "
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
          const escMap = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          s += escMap[esc] ?? esc;
          i++;
        }
      } else if (c === '"') {
        i++; // skip closing "
        break;
      } else {
        s += c;
        i++;
      }
    }
    return s;
  }

  function parseValue() {
    skipWhitespace();
    if (i >= n) return;
    const c = text[i];
    if (c === "{") {
      parseObject();
    } else if (c === "[") {
      parseArray();
    } else if (c === '"') {
      readString();
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      // number -- advance past it
      while (i < n && text[i] !== "," && text[i] !== "}" && text[i] !== "]" &&
             text[i] !== " " && text[i] !== "\t" && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
    } else if (text.slice(i, i + 4) === "true") {
      i += 4;
    } else if (text.slice(i, i + 5) === "false") {
      i += 5;
    } else if (text.slice(i, i + 4) === "null") {
      i += 4;
    }
  }

  function parseObject() {
    i++; // skip {
    /** @type {Map<string, number>} */
    const seenKeys = new Map(); // key => line number of first occurrence
    skipWhitespace();
    if (i < n && text[i] === "}") {
      i++;
      return;
    }
    while (i < n) {
      skipWhitespace();
      if (i >= n || text[i] !== '"') break;

      const keyLine = charToLine(i);
      const key = readString();
      const dotPath = pathStack.length > 0 ? `${pathStack.join(".")}.${key}` : key;

      if (seenKeys.has(key)) {
        duplicates.push({ dotPath, line1: /** @type {number} */ (seenKeys.get(key)), line2: keyLine });
      } else {
        seenKeys.set(key, keyLine);
      }

      skipWhitespace();
      if (i < n && text[i] === ":") i++; // skip :

      pathStack.push(key);
      parseValue();
      pathStack.pop();

      skipWhitespace();
      if (i < n && text[i] === ",") {
        i++;
      } else {
        break;
      }
    }
    skipWhitespace();
    if (i < n && text[i] === "}") i++;
  }

  function parseArray() {
    i++; // skip [
    skipWhitespace();
    if (i < n && text[i] === "]") {
      i++;
      return;
    }
    while (i < n) {
      parseValue();
      skipWhitespace();
      if (i < n && text[i] === ",") {
        i++;
      } else {
        break;
      }
    }
    skipWhitespace();
    if (i < n && text[i] === "]") i++;
  }

  parseValue();
  return duplicates;
}

/**
 * Load and parse a JSON message catalogue. Returns the parsed object.
 *
 * @param {string} locale
 * @returns {unknown}
 */
function loadCatalogue(locale) {
  const filePath = join(MESSAGES_DIR, `${locale}.json`);
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`lint-i18n: cannot read ${filePath}: ${/** @type {Error} */ (err).message}`);
    process.exit(1);
  }
}

/**
 * Read the raw text of a catalogue file.
 *
 * @param {string} locale
 * @returns {string}
 */
function readCatalogueRaw(locale) {
  const filePath = join(MESSAGES_DIR, `${locale}.json`);
  try {
    return readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`lint-i18n: cannot read ${filePath}: ${/** @type {Error} */ (err).message}`);
    process.exit(1);
  }
}

function main() {
  let hasFailure = false;

  // --- Pass 1: duplicate-key scan on all locales (including en) ---
  for (const locale of ALL_LOCALES) {
    const raw = readCatalogueRaw(locale);
    const dups = findDuplicateKeys(raw);
    if (dups.length > 0) {
      hasFailure = true;
      console.error(`lint-i18n: duplicate keys detected in messages/${locale}.json:`);
      for (const { dotPath, line1, line2 } of dups) {
        console.error(`    DUPLICATE  ${dotPath}  (first at line ${line1}, duplicate at line ${line2})`);
      }
      console.error("");
    }
  }

  // --- Pass 2: structural diff (en vs non-English locales) ---
  const enCatalogue = loadCatalogue("en");
  const enKeys = new Set(enumerateKeys(enCatalogue));

  /** @type {{ locale: string; missing: string[]; extra: string[] }[]} */
  const diffFailures = [];

  for (const locale of LOCALES_TO_DIFF) {
    const catalogue = loadCatalogue(locale);
    const localeKeys = new Set(enumerateKeys(catalogue));

    const missing = [...enKeys].filter((k) => !localeKeys.has(k)).sort();
    const extra = [...localeKeys].filter((k) => !enKeys.has(k)).sort();

    if (missing.length > 0 || extra.length > 0) {
      diffFailures.push({ locale, missing, extra });
    }
  }

  if (diffFailures.length > 0) {
    hasFailure = true;
    console.error(
      "lint-i18n: message catalogue drift detected.\n" +
        "Every non-English catalogue must have exactly the same key set as messages/en.json.\n" +
        "Missing keys must be translated; extra keys must be removed.\n",
    );

    for (const { locale, missing, extra } of diffFailures) {
      console.error(`  messages/${locale}.json:`);
      for (const key of missing) {
        console.error(`    MISSING  ${key}`);
      }
      for (const key of extra) {
        console.error(`    EXTRA    ${key}`);
      }
      console.error("");
    }
  }

  if (!hasFailure) {
    console.log(
      "lint-i18n: OK -- all catalogues (en, ja, zh-Hans, zh-Hant) have no duplicate keys and match the en key set.",
    );
    process.exit(0);
  }

  process.exit(1);
}

main();

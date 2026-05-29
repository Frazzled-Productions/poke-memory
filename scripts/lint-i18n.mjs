#!/usr/bin/env node
// Message-catalogue completeness gate.
//
// Loads messages/en.json as the key-set baseline and diffs each non-English
// catalogue (ja, zh-Hans, zh-Hant) against it. Fails (exit 1) when any locale
// is MISSING a key that en has, or has an EXTRA key that en doesn't — both
// directions are checked because extra keys are dead code that signal drift.
//
// Run directly: `node scripts/lint-i18n.mjs` (or `npm run lint:i18n`).
// Exit code 0 = all catalogues are structurally identical to en.
// Exit code 1 = at least one missing or extra key found.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MESSAGES_DIR = join(REPO_ROOT, "messages");

const LOCALES_TO_CHECK = ["ja", "zh-Hans", "zh-Hant"];

/**
 * Recursively enumerates all leaf keys in a nested JSON object as dot-paths.
 * Example: { a: { b: 1, c: 2 } } → ["a.b", "a.c"]
 *
 * @param {unknown} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function enumerateKeys(obj, prefix = "") {
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

function main() {
  const enCatalogue = loadCatalogue("en");
  const enKeys = new Set(enumerateKeys(enCatalogue));

  /** @type {{ locale: string; missing: string[]; extra: string[] }[]} */
  const failures = [];

  for (const locale of LOCALES_TO_CHECK) {
    const catalogue = loadCatalogue(locale);
    const localeKeys = new Set(enumerateKeys(catalogue));

    const missing = [...enKeys].filter((k) => !localeKeys.has(k)).sort();
    const extra = [...localeKeys].filter((k) => !enKeys.has(k)).sort();

    if (missing.length > 0 || extra.length > 0) {
      failures.push({ locale, missing, extra });
    }
  }

  if (failures.length === 0) {
    console.log(
      "lint-i18n: OK — all catalogues (ja, zh-Hans, zh-Hant) match the en key set.",
    );
    process.exit(0);
  }

  console.error(
    "lint-i18n: message catalogue drift detected.\n" +
      "Every non-English catalogue must have exactly the same key set as messages/en.json.\n" +
      "Missing keys must be translated; extra keys must be removed.\n",
  );

  for (const { locale, missing, extra } of failures) {
    console.error(`  messages/${locale}.json:`);
    for (const key of missing) {
      console.error(`    MISSING  ${key}`);
    }
    for (const key of extra) {
      console.error(`    EXTRA    ${key}`);
    }
    console.error("");
  }

  process.exit(1);
}

main();

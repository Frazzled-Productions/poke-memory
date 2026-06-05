#!/usr/bin/env node
/**
 * generate-pseudo-locale.mjs
 *
 * Reads messages/en.json and produces messages/xx-pseudo.json, a
 * "pseudo-locale" catalogue used by the English-leak test harness.
 *
 * Every leaf string value is wrapped in sentinel brackets:
 *   "Practice" → "[Practice]"
 *
 * For ICU message-format patterns (strings containing "{…}"), the ENTIRE
 * pattern is wrapped - not the interpolated args - so that runtime
 * interpolation still works while translated strings are still
 * distinguishable from un-translated raw English:
 *   "{count, plural, one {# card} other {# cards}}"
 *   → "[{count, plural, one {# card} other {# cards}}]"
 *
 * Commit the output as a dev artefact. Run:
 *   node scripts/generate-pseudo-locale.mjs
 * or let npm run generate:pseudo-locale do it (defined in package.json).
 *
 * The harness test (components/review/DirectionBadge.i18n-leak.test.tsx)
 * imports this file via renderWithIntl's "xx-pseudo" locale slot and checks
 * that rendered text nodes match the sentinel pattern - proving the component
 * is routing its strings through the catalogue rather than hard-coding English.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EN_PATH = join(REPO_ROOT, "messages", "en.json");
const OUT_PATH = join(REPO_ROOT, "messages", "xx-pseudo.json");

/**
 * Recursively walks a parsed JSON object and wraps every leaf string in
 * sentinel brackets "[…]".  Non-string leaves (numbers, booleans, null)
 * are returned unchanged.
 *
 * @param {unknown} node
 * @returns {unknown}
 */
function wrapLeaves(node) {
  if (node === null || typeof node !== "object") {
    if (typeof node === "string") {
      return `[${node}]`;
    }
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(wrapLeaves);
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (node))) {
    out[key] = wrapLeaves(value);
  }
  return out;
}

const raw = readFileSync(EN_PATH, "utf8");
const en = JSON.parse(raw);
const pseudo = wrapLeaves(en);
const output = JSON.stringify(pseudo, null, 2) + "\n";
writeFileSync(OUT_PATH, output, "utf8");
console.log(`generate-pseudo-locale: wrote ${OUT_PATH}`);

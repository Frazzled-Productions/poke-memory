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

// `--check` regenerates in memory and fails (exit 1) if the on-disk
// messages/xx-pseudo.json is stale, WITHOUT writing - so the drift CI's
// `check` job enforces (a catalogue change that skipped the regen) is caught
// in the local `lint` gate before push. #1649 / #1654: the drift is otherwise
// invisible locally and only surfaces in CI.
const CHECK_ONLY = process.argv.includes("--check");

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

if (CHECK_ONLY) {
  let current = "";
  try {
    current = readFileSync(OUT_PATH, "utf8");
  } catch {
    current = "";
  }
  if (current !== output) {
    console.error(
      `lint:pseudo-locale: ${OUT_PATH} is out of date with messages/en.json. ` +
        `Run 'npm run generate:pseudo-locale' and commit the result.`,
    );
    process.exit(1);
  }
  console.log("lint:pseudo-locale: OK (xx-pseudo.json matches en.json).");
} else {
  writeFileSync(OUT_PATH, output, "utf8");
  console.log(`generate-pseudo-locale: wrote ${OUT_PATH}`);
}

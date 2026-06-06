#!/usr/bin/env node
// Fails CI if any changelog fragment under changelog.d/unreleased/ is malformed.
//
// auto-release.yml assembles these fragments into the next CHANGELOG section.
// A fragment missing its YAML front-matter (or with an unknown `kind`, or with
// no bullet body) breaks that assembly. This was caught only by auto-review on
// PR #1503 when a fragment shipped as the bare text `patch` instead of valid
// front-matter; this gate makes the failure local and immediate instead.
//
// Contract (mirrors changelog.d/README.md): parsing/validation lives in the
// shared parser at scripts/lib/changelog-fragment.mjs, which the release cut
// (.github/scripts/cut-release.mjs) also uses, so this lint accepts exactly
// what the release accepts, and rejects exactly what it would reject (#1664).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFragment } from "./lib/changelog-fragment.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIR = resolve(ROOT, "changelog.d", "unreleased");

// Files in the directory that are not fragments and must be skipped.
const SKIP = new Set([".gitkeep"]);

/**
 * Validate a single fragment's text. Returns an array of human-readable
 * problem strings (empty when the fragment is well-formed).
 */
function problemsFor(text) {
  const result = parseFragment(text);
  return result.ok ? [] : result.problems;
}

let fileNames;
try {
  fileNames = readdirSync(DIR);
} catch (err) {
  console.error(`✗ cannot read ${DIR}: ${err.message}`);
  process.exit(1);
}

const fragments = fileNames
  .filter((name) => name.endsWith(".md") && !SKIP.has(name))
  .sort();

let failures = 0;
for (const name of fragments) {
  const text = readFileSync(resolve(DIR, name), "utf8");
  const problems = problemsFor(text);
  if (problems.length > 0) {
    failures++;
    console.error(`✗ changelog.d/unreleased/${name}:`);
    for (const p of problems) {
      console.error(`    - ${p}`);
    }
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} malformed changelog fragment(s). ` +
      `See changelog.d/README.md for the required format.`,
  );
  process.exit(1);
}

console.log(`✓ ${fragments.length} changelog fragment(s) well-formed.`);

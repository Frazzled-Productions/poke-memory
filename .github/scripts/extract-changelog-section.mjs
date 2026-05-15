#!/usr/bin/env node
// Prints the body of a single `## [VERSION]` section from CHANGELOG.md to stdout.
//
// Usage:
//   node .github/scripts/extract-changelog-section.mjs 0.1.0

import fs from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: extract-changelog-section.mjs <version>');
  process.exit(2);
}

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

// Find the `## [<version>]` heading by exact string match rather than building
// a RegExp from `version` — `version` is a command-line argument, so feeding it
// into `new RegExp` would allow regex injection (and the old `.`-only escape
// missed backslashes and other metacharacters). The heading is anchored to the
// start of a line and the rest of the line is consumed up to the newline.
const headingPrefix = `## [${version}]`;
let headingIndex = -1;
for (let i = 0; i !== -1; i = changelog.indexOf('\n', i) + 1 || -1) {
  if (changelog.startsWith(headingPrefix, i)) {
    headingIndex = i;
    break;
  }
}
if (headingIndex === -1) {
  console.error(`No '## [${version}]' heading found in CHANGELOG.md.`);
  process.exit(1);
}

const lineEnd = changelog.indexOf('\n', headingIndex);
const match = {
  index: headingIndex,
  0: changelog.slice(headingIndex, lineEnd === -1 ? changelog.length : lineEnd + 1),
};

const start = match.index + match[0].length;
const afterStart = changelog.indexOf('\n## [', start);
const end = afterStart >= 0 ? afterStart : changelog.length;

let body = changelog.slice(start, end).trim();

// Strip the reference-link footer if we accidentally grabbed it (last section).
body = body.replace(/\n\[Unreleased\]:[\s\S]*$/, '').trimEnd();

process.stdout.write(body + '\n');

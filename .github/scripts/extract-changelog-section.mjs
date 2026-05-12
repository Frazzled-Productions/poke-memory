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

const headingRe = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n`, 'm');
const match = changelog.match(headingRe);
if (!match) {
  console.error(`No '## [${version}]' heading found in CHANGELOG.md.`);
  process.exit(1);
}

const start = match.index + match[0].length;
const afterStart = changelog.indexOf('\n## [', start);
const end = afterStart >= 0 ? afterStart : changelog.length;

let body = changelog.slice(start, end).trim();

// Strip the reference-link footer if we accidentally grabbed it (last section).
body = body.replace(/\n\[Unreleased\]:[\s\S]*$/, '').trimEnd();

process.stdout.write(body + '\n');

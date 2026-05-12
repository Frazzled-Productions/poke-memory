#!/usr/bin/env node
// Promotes changelog fragments from changelog.d/unreleased/ to CHANGELOG.md,
// bumps package.json, and writes release notes for `gh release create`.
//
// Reads:
//   changelog.d/unreleased/*.md, CHANGELOG.md, package.json
//
// Writes (only when fragments exist):
//   CHANGELOG.md (new [X.Y.Z] section inserted after [Unreleased] stub)
//   package.json (version bumped)
//   $RUNNER_TEMP/release-notes.md
//   $GITHUB_OUTPUT keys: skip, version, bodyFile, bumpType
//
// Bump rules (pre-v1 SemVer per AGENTS.md):
//   - any fragment with kind: minor-bump  → minor bump (0.N.0 → 0.N+1.0)
//   - any other non-empty set of fragments → patch bump (0.N.M → 0.N.M+1)
//   - no fragments                        → skip=true, no-op

import fs from 'node:fs';
import path from 'node:path';

const CHANGELOG = 'CHANGELOG.md';
const PACKAGE = 'package.json';
const FRAGMENTS_DIR = 'changelog.d/unreleased';
const KIND_ORDER = ['Added', 'Changed', 'Removed', 'Deprecated', 'Fixed', 'Security'];

function setOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    console.log(`(local) ${name}=${value}`);
    return;
  }
  fs.appendFileSync(out, `${name}=${value}\n`);
}

function fail(msg) {
  console.error(`cut-release: ${msg}`);
  process.exit(1);
}

// --- Read fragment files -----------------------------------------------------

let fragmentFiles = [];
if (fs.existsSync(FRAGMENTS_DIR)) {
  fragmentFiles = fs.readdirSync(FRAGMENTS_DIR).filter((f) => /\.md$/i.test(f)).sort();
}

if (fragmentFiles.length === 0) {
  console.log('No changelog fragments found — nothing to release.');
  setOutput('skip', 'true');
  process.exit(0);
}

// --- Parse each fragment -----------------------------------------------------

// Maps title-case kind name → array of bullet strings.
const bulletsByKind = {};
let hasMinorBump = false;

for (const filename of fragmentFiles) {
  const filePath = path.join(FRAGMENTS_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

  const match = raw.match(/^---\s*\nkind:\s*(\S+)\s*\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    fail(`Fragment ${filename} does not match expected front-matter format (---\\nkind: VALUE\\n---).`);
  }

  const kind = match[1].toLowerCase();
  const body = match[2].trim();

  if (kind === 'minor-bump') {
    hasMinorBump = true;
    continue;
  }

  // Normalise kind to title-case for grouping (e.g. 'added' → 'Added').
  const titleKind = kind.charAt(0).toUpperCase() + kind.slice(1);
  if (!KIND_ORDER.includes(titleKind)) {
    fail(`Fragment ${filename} has unknown kind: "${kind}". Expected one of: minor-bump, ${KIND_ORDER.map((k) => k.toLowerCase()).join(', ')}.`);
  }

  const bullets = body.split('\n').filter((l) => /^\s*-\s+\S/.test(l));
  if (bullets.length > 0) {
    if (!bulletsByKind[titleKind]) bulletsByKind[titleKind] = [];
    bulletsByKind[titleKind].push(...bullets);
  }
}

// --- Determine bump type -----------------------------------------------------

const nonEmptyKinds = Object.keys(bulletsByKind);

if (!hasMinorBump && nonEmptyKinds.length === 0) {
  // Fragments exist but all have empty bodies and none is minor-bump — skip.
  console.log('No changelog fragments with content — nothing to release.');
  setOutput('skip', 'true');
  process.exit(0);
}

const bumpType = hasMinorBump ? 'minor' : 'patch';

// --- Read package.json and compute new version --------------------------------

const changelog = fs.readFileSync(CHANGELOG, 'utf8');
const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));

const versionParts = pkg.version.split('.').map(Number);
if (versionParts.length !== 3 || versionParts.some(Number.isNaN)) {
  fail(`package.json version is not SemVer X.Y.Z: ${pkg.version}`);
}
const [major, minor, patch] = versionParts;

let newVersion;
if (major === 0) {
  newVersion = bumpType === 'minor' ? `0.${minor + 1}.0` : `0.${minor}.${patch + 1}`;
} else {
  newVersion = bumpType === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

const today = new Date().toISOString().slice(0, 10);

// --- Build cleanBody from fragments ------------------------------------------

const sections = KIND_ORDER.filter((k) => bulletsByKind[k] && bulletsByKind[k].length > 0).map(
  (k) => `### ${k}\n\n${bulletsByKind[k].join('\n')}`,
);
const cleanBody = sections.join('\n\n');

// --- Rewrite CHANGELOG -------------------------------------------------------

const unreleasedStart = changelog.indexOf('## [Unreleased]');
if (unreleasedStart < 0) fail('No `## [Unreleased]` heading in CHANGELOG.md.');

const afterUnreleased = changelog.indexOf('\n## [', unreleasedStart + 1);
if (afterUnreleased < 0) {
  fail('No previous `## [X.Y.Z]` heading after [Unreleased]; CHANGELOG must have at least one prior version.');
}

// Insert the new version section right before the existing `\n## [X.Y.Z]` block,
// preserving the [Unreleased] stub (with any HTML comment) exactly as-is.
const newSection = `\n## [${newVersion}] — ${today}\n\n${cleanBody}\n`;

let newChangelog =
  changelog.slice(0, afterUnreleased) +
  newSection +
  changelog.slice(afterUnreleased);

// Reference links at the bottom.
const refRe = /^\[Unreleased\]: (https:\/\/github\.com\/[^/\s]+\/[^/\s]+)\/compare\/v[^\s]+\.\.\.HEAD\s*$/m;
const refMatch = newChangelog.match(refRe);
if (refMatch) {
  const baseUrl = refMatch[1];
  const newUnreleased = `[Unreleased]: ${baseUrl}/compare/v${newVersion}...HEAD`;
  const newTagLink = `[${newVersion}]: ${baseUrl}/releases/tag/v${newVersion}`;
  newChangelog = newChangelog.replace(refRe, `${newUnreleased}\n${newTagLink}`);
} else {
  console.warn('cut-release: no [Unreleased] reference link found — skipping link update.');
}

fs.writeFileSync(CHANGELOG, newChangelog);

// --- Bump package.json (preserve trailing newline) ---------------------------

const oldPkgRaw = fs.readFileSync(PACKAGE, 'utf8');
const trailing = oldPkgRaw.endsWith('\n') ? '\n' : '';
const previousVersion = pkg.version;
pkg.version = newVersion;
fs.writeFileSync(PACKAGE, JSON.stringify(pkg, null, 2) + trailing);

// --- Write release notes -----------------------------------------------------

const tmp = process.env.RUNNER_TEMP || '/tmp';
const notesPath = path.join(tmp, 'release-notes.md');
fs.writeFileSync(notesPath, cleanBody + '\n');

setOutput('skip', 'false');
setOutput('version', newVersion);
setOutput('bumpType', bumpType);
setOutput('bodyFile', notesPath);

console.log(`Cut v${newVersion} (${bumpType} bump from v${previousVersion}).`);

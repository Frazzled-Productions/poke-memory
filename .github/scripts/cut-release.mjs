#!/usr/bin/env node
// Promotes [Unreleased] in CHANGELOG.md to the next SemVer version, bumps
// package.json, and writes release notes to a file for `gh release create`.
//
// Reads:
//   CHANGELOG.md, package.json
//
// Writes (only when [Unreleased] has content):
//   CHANGELOG.md (rewritten with [Unreleased] promoted)
//   package.json (version bumped)
//   $RUNNER_TEMP/release-notes.md
//   $GITHUB_OUTPUT keys: skip, version, bodyFile, bumpType
//
// Bump rules (pre-v1 SemVer per AGENTS.md):
//   - `> bump: minor` in [Unreleased]  → minor bump (0.N.0 → 0.N+1.0)
//   - any other non-empty [Unreleased] → patch bump (0.N.M → 0.N.M+1)
//   - empty [Unreleased]               → skip=true, no-op

import fs from 'node:fs';
import path from 'node:path';

const CHANGELOG = 'CHANGELOG.md';
const PACKAGE = 'package.json';
const TRIGGER_SECTIONS = ['Added', 'Changed', 'Removed', 'Deprecated', 'Fixed', 'Security'];

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

const changelog = fs.readFileSync(CHANGELOG, 'utf8');
const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));

const versionParts = pkg.version.split('.').map(Number);
if (versionParts.length !== 3 || versionParts.some(Number.isNaN)) {
  fail(`package.json version is not SemVer X.Y.Z: ${pkg.version}`);
}
const [major, minor, patch] = versionParts;

// --- Slice [Unreleased] section ---------------------------------------------

const unreleasedStart = changelog.indexOf('## [Unreleased]');
if (unreleasedStart < 0) fail('No `## [Unreleased]` heading in CHANGELOG.md.');

const afterUnreleased = changelog.indexOf('\n## [', unreleasedStart + 1);
if (afterUnreleased < 0) {
  fail('No previous `## [X.Y.Z]` heading after [Unreleased]; CHANGELOG must have at least one prior version.');
}

const unreleasedSection = changelog.slice(unreleasedStart, afterUnreleased + 1);
const unreleasedBody = unreleasedSection
  .replace(/^## \[Unreleased\][^\n]*\n+/, '')
  .replace(/\s+$/, '');

// --- Parse subsections ------------------------------------------------------

function parseSubsections(body) {
  const result = {};
  const lines = body.split('\n');
  let current = null;
  let buffer = [];
  for (const line of lines) {
    const head = line.match(/^### (.+?)\s*$/);
    if (head) {
      if (current) result[current] = buffer;
      current = head[1];
      buffer = [];
    } else if (current) {
      buffer.push(line);
    }
  }
  if (current) result[current] = buffer;
  return result;
}

function hasBullet(lines) {
  return lines.some((l) => /^\s*-\s+\S/.test(l));
}

const sections = parseSubsections(unreleasedBody);
const nonEmpty = TRIGGER_SECTIONS.filter((s) => sections[s] && hasBullet(sections[s]));

if (nonEmpty.length === 0) {
  console.log('[Unreleased] is empty — nothing to release.');
  setOutput('skip', 'true');
  process.exit(0);
}

// --- Compute next version ---------------------------------------------------

// Shared source keeps the detect and strip regexes in sync — tighten one place only.
const BUMP_MINOR_SOURCE = String.raw`^>\s*bump:\s*minor\s*`;
const BUMP_MINOR_DETECT_RE = new RegExp(BUMP_MINOR_SOURCE + '$', 'm');
const BUMP_MINOR_STRIP_RE = new RegExp(BUMP_MINOR_SOURCE + '\\n?', 'gm');

const needsMinor = BUMP_MINOR_DETECT_RE.test(unreleasedBody);
let newVersion;
if (major === 0) {
  newVersion = needsMinor ? `0.${minor + 1}.0` : `0.${minor}.${patch + 1}`;
} else {
  newVersion = needsMinor ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}
const bumpType = needsMinor ? 'minor' : 'patch';
const today = new Date().toISOString().slice(0, 10);

// Strip the directive from both the promoted CHANGELOG section and release notes.
// Trailing .trim() absorbs any extra blank lines left behind.
const cleanBody = unreleasedBody.replace(BUMP_MINOR_STRIP_RE, '').trim();

// --- Rewrite CHANGELOG ------------------------------------------------------

const promoted =
  `## [Unreleased]\n\n` +
  `## [${newVersion}] — ${today}\n\n` +
  cleanBody +
  `\n\n`;

let newChangelog =
  changelog.slice(0, unreleasedStart) +
  promoted +
  changelog.slice(afterUnreleased + 1);

// Reference links at the bottom.
// Existing pattern:
//   [Unreleased]: https://github.com/OWNER/REPO/compare/vPREV...HEAD
//   [PREV]: https://github.com/OWNER/REPO/releases/tag/vPREV
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

// --- Bump package.json (preserve trailing newline) --------------------------

const oldPkgRaw = fs.readFileSync(PACKAGE, 'utf8');
const trailing = oldPkgRaw.endsWith('\n') ? '\n' : '';
const previousVersion = pkg.version;
pkg.version = newVersion;
fs.writeFileSync(PACKAGE, JSON.stringify(pkg, null, 2) + trailing);

// --- Write release notes ----------------------------------------------------

const tmp = process.env.RUNNER_TEMP || '/tmp';
const notesPath = path.join(tmp, 'release-notes.md');
fs.writeFileSync(notesPath, cleanBody + '\n');

setOutput('skip', 'false');
setOutput('version', newVersion);
setOutput('bumpType', bumpType);
setOutput('bodyFile', notesPath);

console.log(`Cut v${newVersion} (${bumpType} bump from v${previousVersion}).`);

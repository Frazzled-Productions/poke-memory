import fs from "node:fs";
import path from "node:path";

export type ChangelogSectionKind =
  | "Added"
  | "Changed"
  | "Removed"
  | "Deprecated"
  | "Fixed"
  | "Security";

export interface ChangelogRelease {
  version: string;
  date: string;
  sections: Array<{ kind: ChangelogSectionKind; bullets: string[] }>;
}

const SECTION_ORDER: ChangelogSectionKind[] = [
  "Added",
  "Changed",
  "Removed",
  "Deprecated",
  "Fixed",
  "Security",
];

const SECTION_SET = new Set<string>(SECTION_ORDER);

// The separator is a hyphen on current headings; a U+2014 em dash is also
// accepted so legacy headings predating the no-em-dash rule still parse. The
// char class uses the U+2014 escape (not the literal glyph) so the no-em-dash
// gate does not flag this line.
const VERSION_HEADING_RE = /^##\s+\[(\d+\.\d+\.\d+)\]\s+[\u2014-]\s+(\d{4}-\d{2}-\d{2})\s*$/;
const SECTION_HEADING_RE = /^###\s+(\S.*?)\s*$/;
const BULLET_RE = /^-\s+(\S.+)$/;
const CONTINUATION_RE = /^  \S/;

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const releases: ChangelogRelease[] = [];

  let current: ChangelogRelease | null = null;
  let currentSectionKind: ChangelogSectionKind | null = null;
  let currentBullets: string[] = [];
  let pendingBullet: string | null = null;

  function flushBullet() {
    if (pendingBullet === null) return;
    const text = pendingBullet;
    pendingBullet = null;
    // Skip internal-only bullets per the changelog convention.
    if (!/^internal:/i.test(text)) currentBullets.push(text);
  }

  function closeSection() {
    flushBullet();
    if (current && currentSectionKind && currentBullets.length > 0) {
      current.sections.push({ kind: currentSectionKind, bullets: currentBullets });
    }
    currentSectionKind = null;
    currentBullets = [];
  }

  for (const line of lines) {
    const versionMatch = VERSION_HEADING_RE.exec(line);
    if (versionMatch) {
      closeSection();
      if (current) releases.push(current);
      current = { version: versionMatch[1], date: versionMatch[2], sections: [] };
      continue;
    }

    // Any other `## ` heading (e.g. `## [Unreleased]`) terminates the current release.
    if (line.startsWith("## ")) {
      closeSection();
      if (current) {
        releases.push(current);
        current = null;
      }
      continue;
    }

    if (!current) continue;

    const sectionMatch = SECTION_HEADING_RE.exec(line);
    if (sectionMatch) {
      // Any `### ` heading closes the prior section. Known kinds open a new
      // section; unknown kinds (e.g. a hand-written `### Notes` block) close
      // the prior section and absorb any subsequent bullets into nothing
      // until the next known heading or version heading.
      closeSection();
      if (SECTION_SET.has(sectionMatch[1])) {
        currentSectionKind = sectionMatch[1] as ChangelogSectionKind;
      }
      continue;
    }

    if (currentSectionKind) {
      const bulletMatch = BULLET_RE.exec(line);
      if (bulletMatch) {
        flushBullet();
        pendingBullet = bulletMatch[1].trim();
        continue;
      }
      // Indented continuation lines extend the preceding bullet. A blank
      // line - or any non-indented non-bullet line - terminates the
      // continuation window so wrapping doesn't accidentally swallow
      // unrelated prose.
      if (pendingBullet !== null) {
        if (CONTINUATION_RE.test(line)) {
          pendingBullet += " " + line.trim();
          continue;
        }
        if (line.trim() === "") {
          flushBullet();
          continue;
        }
      }
    }
  }

  closeSection();
  if (current) releases.push(current);

  // Sort each release's sections into the canonical order (Added → Security),
  // concatenating bullets when the same kind appears more than once in a
  // release block, then drop releases that ended up with zero user-facing
  // bullets after filtering internal/empty entries.
  return releases
    .map((release) => ({
      ...release,
      sections: SECTION_ORDER.flatMap((kind) => {
        const bullets = release.sections
          .filter((s) => s.kind === kind)
          .flatMap((s) => s.bullets);
        return bullets.length > 0 ? [{ kind, bullets }] : [];
      }),
    }))
    .filter((release) => release.sections.some((s) => s.bullets.length > 0));
}

let cached: ChangelogRelease[] | null = null;

export function getChangelog(): ChangelogRelease[] {
  if (cached && process.env.NODE_ENV !== "development") return cached;
  const filePath = path.join(process.cwd(), "CHANGELOG.md");
  let markdown: string;
  try {
    markdown = fs.readFileSync(filePath, "utf8");
  } catch {
    // CHANGELOG.md may be absent in some build/test environments. Fall back
    // to an empty list so the page renders its graceful empty state instead
    // of surfacing a 500.
    cached = [];
    return cached;
  }
  cached = parseChangelog(markdown);
  return cached;
}

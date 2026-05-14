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

const VERSION_HEADING_RE = /^##\s+\[(\d+\.\d+\.\d+)\]\s+[—-]\s+(\d{4}-\d{2}-\d{2})\s*$/;
const SECTION_HEADING_RE = /^###\s+(\S.*?)\s*$/;
const BULLET_RE = /^-\s+(.+)$/;

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const releases: ChangelogRelease[] = [];

  let current: ChangelogRelease | null = null;
  let currentSectionKind: ChangelogSectionKind | null = null;
  let currentBullets: string[] = [];

  function closeSection() {
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
    if (sectionMatch && SECTION_SET.has(sectionMatch[1])) {
      closeSection();
      currentSectionKind = sectionMatch[1] as ChangelogSectionKind;
      continue;
    }

    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch && currentSectionKind) {
      const text = bulletMatch[1].trim();
      // Skip internal-only bullets per the changelog convention: a leading
      // "Internal:" marks notes that exist only so the version block isn't
      // empty and should not surface in user-facing changelogs.
      if (/^internal:/i.test(text)) continue;
      currentBullets.push(text);
    }
  }

  closeSection();
  if (current) releases.push(current);

  // Sort each release's sections into the canonical order (Added → Security)
  // and drop releases that ended up with zero user-facing bullets after
  // filtering internal/empty entries.
  return releases
    .map((release) => ({
      ...release,
      sections: SECTION_ORDER
        .map((kind) => release.sections.find((s) => s.kind === kind))
        .filter((s): s is { kind: ChangelogSectionKind; bullets: string[] } => Boolean(s)),
    }))
    .filter((release) => release.sections.some((s) => s.bullets.length > 0));
}

let cached: ChangelogRelease[] | null = null;

export function getChangelog(): ChangelogRelease[] {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "CHANGELOG.md");
  const markdown = fs.readFileSync(filePath, "utf8");
  cached = parseChangelog(markdown);
  return cached;
}

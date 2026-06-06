// Single source of truth for parsing changelog fragments under
// changelog.d/unreleased/. Both the release cut (.github/scripts/cut-release.mjs)
// and the PR-time lint (scripts/lint-changelog-fragments.mjs) import this, so the
// two can never disagree on what a valid fragment is (#1664).
//
// Before #1664 there were two divergent parsers: cut-release used a strict
// positional regex that required `kind:` to be the only front-matter line, while
// the lint scanned the front-matter for a `kind:` line and tolerated extras. A
// fragment carrying an `issue:` line (e.g. 1607/1643) passed the lint but broke
// the release cut. This parser is line-based and tolerates unknown front-matter
// keys (they are ignored), so `issue:` and similar metadata are allowed.
//
// Contract (mirrors changelog.d/README.md):
//   - YAML front-matter delimited by a leading `---` (line 1) and a closing `---`.
//   - A `kind:` field whose value is one of VALID_KINDS. Other front-matter keys
//     (e.g. `issue:`) are permitted and ignored.
//   - At least one `- ` bullet line in the body, EXCEPT for `minor-bump`, which
//     carries no bullet (it only requests a minor version bump).

export const VALID_KINDS = [
  "added",
  "changed",
  "removed",
  "deprecated",
  "fixed",
  "security",
  "minor-bump",
];

/**
 * Parse a single fragment's text.
 *
 * @param {string} text Raw fragment file contents.
 * @returns {{ ok: true, kind: string, bullets: string[] }
 *          | { ok: false, problems: string[] }}
 *   On success, `kind` is the lower-cased kind and `bullets` is the list of
 *   `- ` body lines (empty for `minor-bump`). On failure, `problems` is a list
 *   of human-readable reasons.
 */
export function parseFragment(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  if (lines[0]?.trim() !== "---") {
    return {
      ok: false,
      problems: [
        "missing opening YAML front-matter delimiter `---` on line 1 " +
          "(fragments need front-matter with a `kind:` field, see changelog.d/README.md)",
      ],
    };
  }

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    return {
      ok: false,
      problems: ["missing closing YAML front-matter delimiter `---`"],
    };
  }

  // Scan the front-matter region for the `kind:` line; ignore any other keys.
  const frontMatter = lines.slice(1, closeIdx);
  const kindLine = frontMatter.find((l) => /^\s*kind\s*:/.test(l));
  if (!kindLine) {
    return { ok: false, problems: ["front-matter has no `kind:` field"] };
  }

  const kind = kindLine.replace(/^\s*kind\s*:/, "").trim().toLowerCase();
  if (!VALID_KINDS.includes(kind)) {
    return {
      ok: false,
      problems: [
        `\`kind: ${kind || "(empty)"}\` is not valid; expected one of ${VALID_KINDS.join(", ")}`,
      ],
    };
  }

  const bullets = lines.slice(closeIdx + 1).filter((l) => /^\s*-\s+\S/.test(l));
  if (kind !== "minor-bump" && bullets.length === 0) {
    return { ok: false, problems: ["no `- ` bullet line in the body"] };
  }

  return { ok: true, kind, bullets };
}

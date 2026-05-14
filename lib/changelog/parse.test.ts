import { describe, expect, it } from "vitest";
import { parseChangelog } from "./parse";

describe("parseChangelog", () => {
  it("parses a single release with one section", () => {
    const md = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "## [1.2.3] — 2026-05-14",
      "",
      "### Fixed",
      "",
      "- A bug was fixed.",
      "- Another bug was fixed.",
    ].join("\n");
    const releases = parseChangelog(md);
    expect(releases).toEqual([
      {
        version: "1.2.3",
        date: "2026-05-14",
        sections: [
          {
            kind: "Fixed",
            bullets: ["A bug was fixed.", "Another bug was fixed."],
          },
        ],
      },
    ]);
  });

  it("parses multiple releases preserving order", () => {
    const md = [
      "## [0.9.55] — 2026-05-14",
      "",
      "### Fixed",
      "",
      "- Latest fix.",
      "",
      "## [0.9.54] — 2026-05-13",
      "",
      "### Added",
      "",
      "- Earlier feature.",
    ].join("\n");
    const releases = parseChangelog(md);
    expect(releases.map((r) => r.version)).toEqual(["0.9.55", "0.9.54"]);
    expect(releases[0].sections[0].bullets).toEqual(["Latest fix."]);
    expect(releases[1].sections[0]).toEqual({
      kind: "Added",
      bullets: ["Earlier feature."],
    });
  });

  it("supports both em-dash and hyphen between version and date", () => {
    const md = [
      "## [1.0.0] — 2026-05-14",
      "",
      "### Added",
      "",
      "- A.",
      "",
      "## [0.9.0] - 2026-05-13",
      "",
      "### Added",
      "",
      "- B.",
    ].join("\n");
    const releases = parseChangelog(md);
    expect(releases.map((r) => r.version)).toEqual(["1.0.0", "0.9.0"]);
  });

  it("sorts sections within a release into canonical order", () => {
    const md = [
      "## [1.0.0] — 2026-05-14",
      "",
      "### Fixed",
      "",
      "- F.",
      "",
      "### Added",
      "",
      "- A.",
      "",
      "### Changed",
      "",
      "- C.",
    ].join("\n");
    const [release] = parseChangelog(md);
    expect(release.sections.map((s) => s.kind)).toEqual([
      "Added",
      "Changed",
      "Fixed",
    ]);
  });

  it("filters out 'Internal:' bullets", () => {
    const md = [
      "## [1.0.0] — 2026-05-14",
      "",
      "### Changed",
      "",
      "- Visible bullet.",
      "- Internal: rewired the cache layer. No user-visible change.",
      "- Another visible bullet.",
    ].join("\n");
    const [release] = parseChangelog(md);
    expect(release.sections[0].bullets).toEqual([
      "Visible bullet.",
      "Another visible bullet.",
    ]);
  });

  it("drops releases that contain only filtered or empty sections", () => {
    const md = [
      "## [1.0.0] — 2026-05-14",
      "",
      "### Changed",
      "",
      "- Internal: only an internal note here.",
    ].join("\n");
    expect(parseChangelog(md)).toEqual([]);
  });

  it("ignores the [Unreleased] heading and reference links at the bottom", () => {
    const md = [
      "## [Unreleased]",
      "",
      "<!-- Add entries to changelog.d/unreleased/ -->",
      "",
      "## [1.0.0] — 2026-05-14",
      "",
      "### Added",
      "",
      "- Feature.",
      "",
      "[Unreleased]: https://example.com/compare/v1.0.0...HEAD",
      "[1.0.0]: https://example.com/releases/tag/v1.0.0",
    ].join("\n");
    const releases = parseChangelog(md);
    expect(releases).toHaveLength(1);
    expect(releases[0].version).toBe("1.0.0");
  });

  it("ignores unknown ### subheadings inside a release", () => {
    const md = [
      "## [1.0.0] — 2026-05-14",
      "",
      "### Bogus",
      "",
      "- This should not appear.",
      "",
      "### Added",
      "",
      "- Real feature.",
    ].join("\n");
    const [release] = parseChangelog(md);
    expect(release.sections).toEqual([
      { kind: "Added", bullets: ["Real feature."] },
    ]);
  });
});

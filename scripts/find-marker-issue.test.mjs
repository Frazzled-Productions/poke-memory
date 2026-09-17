/**
 * Tests for the shared tracking-issue lookup in
 * .github/scripts/find-marker-issue.mjs (#2081).
 *
 * The helper lives under .github/scripts/ next to the workflows that call it,
 * but its test lives here because the vitest node project only collects
 * scripts/** and lib/**, and lib/** changes trip the changelog gate.
 */

import { describe, it, expect } from "vitest";
import {
  ISSUE_LIMIT,
  firstLine,
  findMarkerIssue,
  ghListArgs,
  main,
  parseCliArgs,
} from "../.github/scripts/find-marker-issue.mjs";

const DRIFT = "<!-- qa-drift-check -->";
const GRADE_LOG = "<!-- monitor:grade-log-divergence -->";
const CRON_AUTO_RELEASE = "<!-- cron-health-monitor:auto-release.yml -->";
const CRON_USER_COUNT = "<!-- cron-health-monitor:refresh-user-count.yml -->";
const REPO = "Frazzled-Productions/poke-memory";

/** Records what the CLI writes, and stands in for gh. */
function harness(ghResult) {
  const out = [];
  const err = [];
  const calls = [];
  const io = {
    gh: (args) => {
      calls.push(args);
      if (ghResult instanceof Error) throw ghResult;
      return typeof ghResult === "string" ? ghResult : JSON.stringify(ghResult);
    },
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
  };
  return {
    io,
    calls,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

describe("findMarkerIssue", () => {
  it("ignores a newer issue that quotes the marker mid-body (the #1997 takeover)", () => {
    // gh lists newest first. On 2026-08-04 the unanchored contains() picked the
    // weekly review, which quoted the drift marker in its text, over the real
    // tracking issue.
    const issues = [
      {
        number: 1997,
        body: `## 2026-W32 workflow review\n\nThe drift job keys on \`${DRIFT}\`.`,
      },
      { number: 1989, body: `${DRIFT}\n**qa has drifted from main**` },
    ];
    expect(findMarkerIssue(issues, DRIFT)).toEqual({ number: 1989, duplicates: [] });
  });

  it("ignores an issue that quotes the marker at the end of its first line", () => {
    const issues = [{ number: 5, body: `Retro: the drift job uses ${DRIFT}\nmore` }];
    expect(findMarkerIssue(issues, DRIFT).number).toBeNull();
  });

  it("finds markers that contain a colon (the #1919 search failure)", () => {
    const issues = [
      { number: 10, body: `${CRON_AUTO_RELEASE}\n**Cron workflow health alert**` },
      { number: 11, body: `${GRADE_LOG}\n\nDivergence report` },
    ];
    expect(findMarkerIssue(issues, CRON_AUTO_RELEASE).number).toBe(10);
    expect(findMarkerIssue(issues, GRADE_LOG).number).toBe(11);
  });

  it("keeps per-workflow markers apart", () => {
    const issues = [{ number: 12, body: `${CRON_USER_COUNT}\nalert` }];
    expect(findMarkerIssue(issues, CRON_AUTO_RELEASE).number).toBeNull();
    expect(findMarkerIssue(issues, CRON_USER_COUNT).number).toBe(12);
  });

  it("requires the marker to be the whole first line", () => {
    const issues = [
      { number: 13, body: `${DRIFT} **qa has drifted**\nbody` },
      { number: 14, body: `**qa has drifted** ${DRIFT}\nbody` },
      { number: 15, body: `<!-- qa-drift-check-v2 -->\nbody` },
    ];
    expect(findMarkerIssue(issues, DRIFT).number).toBeNull();
  });

  it("accepts CRLF line endings and whitespace around the marker", () => {
    // A writer whose body kept some indentation must still find its own issue,
    // or it files a new one on every run.
    expect(findMarkerIssue([{ number: 16, body: `${DRIFT}\r\nbody` }], DRIFT).number).toBe(16);
    expect(findMarkerIssue([{ number: 17, body: `  ${DRIFT}  \t\nbody` }], DRIFT).number).toBe(17);
    expect(findMarkerIssue([{ number: 18, body: DRIFT }], DRIFT).number).toBe(18);
  });

  it("skips empty and missing bodies without throwing", () => {
    const issues = [
      { number: 19, body: "" },
      { number: 20, body: null },
      { number: 21 },
    ];
    expect(findMarkerIssue(issues, DRIFT)).toEqual({ number: null, duplicates: [] });
  });

  it("returns the newest match and lists the rest as duplicates, whatever the input order", () => {
    const issues = [
      { number: 2000, body: `${GRADE_LOG}\n\nday 2` },
      { number: 2002, body: `${GRADE_LOG}\n\nday 4` },
      { number: 1999, body: `${GRADE_LOG}\n\nday 1` },
    ];
    expect(findMarkerIssue(issues, GRADE_LOG)).toEqual({
      number: 2002,
      duplicates: [2000, 1999],
    });
  });
});

describe("firstLine", () => {
  it("returns null for anything that is not a string", () => {
    expect(firstLine(undefined)).toBeNull();
    expect(firstLine(42)).toBeNull();
  });

  it("returns the first line without surrounding whitespace", () => {
    expect(firstLine("  a \nb")).toBe("a");
    expect(firstLine("")).toBe("");
  });
});

describe("parseCliArgs", () => {
  it("reads --repo and --marker", () => {
    expect(parseCliArgs(["--repo", REPO, "--marker", GRADE_LOG])).toEqual({
      repo: REPO,
      marker: GRADE_LOG,
    });
  });

  it("rejects a missing or malformed repo", () => {
    expect(() => parseCliArgs(["--marker", DRIFT])).toThrow(/--repo/);
    expect(() => parseCliArgs(["--repo", "poke-memory", "--marker", DRIFT])).toThrow(/--repo/);
  });

  it("rejects a missing, empty or non-comment marker", () => {
    // An empty marker would match every issue with an empty body.
    expect(() => parseCliArgs(["--repo", REPO])).toThrow(/--marker/);
    expect(() => parseCliArgs(["--repo", REPO, "--marker", ""])).toThrow(/--marker/);
    expect(() => parseCliArgs(["--repo", REPO, "--marker", "qa-drift-check"])).toThrow(/--marker/);
    expect(() => parseCliArgs(["--repo", REPO, "--marker", `${DRIFT}\nx`])).toThrow(/--marker/);
  });

  it("rejects unknown options", () => {
    expect(() => parseCliArgs(["--repo", REPO, "--marker", DRIFT, "--search", "x"])).toThrow();
  });
});

describe("ghListArgs", () => {
  it("lists open issues with their bodies and never searches", () => {
    const args = ghListArgs(REPO);
    expect(args.slice(0, 2)).toEqual(["issue", "list"]);
    expect(args.join(" ")).toContain(`--repo ${REPO}`);
    expect(args.join(" ")).toContain("--state open");
    expect(args.join(" ")).toContain("--json number,body");
    expect(args.join(" ")).toContain(`--limit ${ISSUE_LIMIT}`);
    expect(args).not.toContain("--search");
    // gh sends --label through the search API too.
    expect(args).not.toContain("--label");
  });
});

describe("main (CLI)", () => {
  const argv = ["--repo", REPO, "--marker", DRIFT];

  it("prints only the issue number on a match", () => {
    const h = harness([
      { number: 2050, body: `See ${DRIFT} for context` },
      { number: 2044, body: `${DRIFT}\n**qa has drifted from main**` },
    ]);
    expect(main(argv, h.io)).toBe(0);
    expect(h.stdout()).toBe("2044\n");
    expect(h.stderr()).toBe("");
    expect(h.calls).toEqual([ghListArgs(REPO)]);
  });

  it("prints nothing and exits 0 when no issue matches", () => {
    const h = harness([{ number: 1, body: "unrelated" }]);
    expect(main(argv, h.io)).toBe(0);
    expect(h.stdout()).toBe("");
  });

  it("warns on duplicates on stderr, keeping stdout to the number", () => {
    const h = harness([
      { number: 7, body: `${DRIFT}\nold` },
      { number: 9, body: `${DRIFT}\nnew` },
    ]);
    expect(main(argv, h.io)).toBe(0);
    expect(h.stdout()).toBe("9\n");
    expect(h.stderr()).toMatch(/^::warning::/);
    expect(h.stderr()).toContain("#7");
  });

  it("fails when gh fails, so the step aborts instead of filing a duplicate", () => {
    const h = harness(new Error("HTTP 502"));
    expect(main(argv, h.io)).toBe(1);
    expect(h.stdout()).toBe("");
    expect(h.stderr()).toMatch(/^::error::.*HTTP 502/);
  });

  it("fails on output that is not JSON", () => {
    const h = harness("gh: rate limited");
    expect(main(argv, h.io)).toBe(1);
    expect(h.stdout()).toBe("");
  });

  it("fails on JSON that is not an array of numbered issues", () => {
    expect(main(argv, harness({ message: "Bad credentials" }).io)).toBe(1);
    expect(main(argv, harness([{ body: `${DRIFT}\n` }]).io)).toBe(1);
    expect(main(argv, harness([null]).io)).toBe(1);
  });

  it("fails when the list may be truncated at the limit", () => {
    const full = Array.from({ length: ISSUE_LIMIT }, (_, i) => ({ number: i + 1, body: "x" }));
    const h = harness(full);
    expect(main(argv, h.io)).toBe(1);
    expect(h.stdout()).toBe("");
    expect(h.stderr()).toContain("may be missing");
  });

  it("fails on bad arguments without calling gh", () => {
    const h = harness([]);
    expect(main(["--repo", REPO, "--marker", ""], h.io)).toBe(1);
    expect(h.calls).toEqual([]);
    expect(h.stderr()).toMatch(/^::error::/);
  });
});

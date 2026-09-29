/**
 * Tests for the monitor tracking-issue lookup (#2010, #2081) used by every
 * monitor workflow that keeps a tracking issue.
 *
 * It lives under scripts/ (the node vitest project) rather than lib/ because it
 * guards CI tooling, not product code. The CLI cases run the script the way
 * the workflow does, so the stdin/exit-code contract is covered too.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  findMarkerIssue,
  isBotAuthor,
  normaliseLogin,
  parseArgs,
} from "../.github/scripts/find-marker-issue.mjs";

const MARKER = "<!-- monitor:grade-log-divergence -->";
const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.github/scripts/find-marker-issue.mjs",
);

describe("findMarkerIssue", () => {
  it("matches an issue whose body starts with the marker line", () => {
    expect(findMarkerIssue([{ number: 40, body: `${MARKER}\n\nreport` }], MARKER)).toBe(40);
  });

  it("matches a body that is only the marker", () => {
    expect(findMarkerIssue([{ number: 40, body: MARKER }], MARKER)).toBe(40);
  });

  it("does NOT match an issue that quotes the marker mid-body", () => {
    const issues = [
      { number: 12, body: `Retro notes: the monitor uses ${MARKER} as its key.` },
      { number: 13, body: `Line one\n${MARKER}\nmore` },
    ];
    expect(findMarkerIssue(issues, MARKER)).toBeNull();
  });

  it("does NOT match when the marker is only a prefix of the first line", () => {
    expect(findMarkerIssue([{ number: 14, body: `${MARKER} trailing text` }], MARKER)).toBeNull();
  });

  it("matches a CRLF body", () => {
    expect(findMarkerIssue([{ number: 9, body: `${MARKER}\r\n\r\nreport` }], MARKER)).toBe(9);
  });

  it("does NOT match a null or empty body", () => {
    const issues = [
      { number: 3, body: null },
      { number: 4, body: "" },
      { number: 5 },
    ];
    expect(findMarkerIssue(issues, MARKER)).toBeNull();
  });

  it("picks the oldest issue when two match", () => {
    const issues = [
      { number: 77, body: `${MARKER}\n\nnewer` },
      { number: 40, body: `${MARKER}\n\nolder` },
    ];
    expect(findMarkerIssue(issues, MARKER)).toBe(40);
  });

  it("returns null for an empty list", () => {
    expect(findMarkerIssue([], MARKER)).toBeNull();
  });

  it("throws on input that is not an array", () => {
    expect(() => findMarkerIssue({ number: 1 }, MARKER)).toThrow(TypeError);
  });
});

describe("findMarkerIssue author filter (#2081 review)", () => {
  const bot = { login: "app/github-actions" };
  const human = { login: "someone" };

  it("ignores an OLDER issue with the exact marker opened by another author", () => {
    const issues = [
      { number: 10, body: `${MARKER}\n\nhijack`, author: human },
      { number: 40, body: `${MARKER}\n\nreal`, author: bot },
    ];
    expect(findMarkerIssue(issues, MARKER, { authors: ["github-actions"] })).toBe(40);
  });

  it("returns null when only a non-allowed author carries the marker", () => {
    const issues = [{ number: 10, body: `${MARKER}\n\nhijack`, author: human }];
    expect(findMarkerIssue(issues, MARKER, { authors: ["github-actions"] })).toBeNull();
  });

  it("normalises app/ and [bot] spellings on both sides", () => {
    const issues = [{ number: 5, body: MARKER, author: { login: "github-actions[bot]" } }];
    expect(findMarkerIssue(issues, MARKER, { authors: ["app/github-actions"] })).toBe(5);
    const issues2 = [{ number: 6, body: MARKER, author: { login: "app/poke-memory-bot" } }];
    expect(findMarkerIssue(issues2, MARKER, { authors: ["poke-memory-bot[bot]"] })).toBe(6);
    expect(normaliseLogin("App/GitHub-Actions[bot]")).toBe("github-actions");
  });

  it("accepts any of several allowed authors", () => {
    const issues = [{ number: 7, body: MARKER, author: { login: "app/poke-memory-bot" } }];
    expect(
      findMarkerIssue(issues, MARKER, { authors: ["github-actions", "poke-memory-bot"] }),
    ).toBe(7);
  });

  it("does not match an issue whose author is null (deleted account)", () => {
    expect(
      findMarkerIssue([{ number: 8, body: MARKER, author: null }], MARKER, {
        authors: ["github-actions"],
      }),
    ).toBeNull();
  });

  it("throws when the author field was not requested, rather than matching nothing", () => {
    expect(() =>
      findMarkerIssue([{ number: 8, body: MARKER }], MARKER, { authors: ["github-actions"] }),
    ).toThrow(/--json number,body,author/);
  });

  it("ignores a HUMAN account whose bare login equals an allowed bot name", () => {
    // Real `gh issue list --json author` output carries is_bot; a user
    // literally named `github-actions` would have is_bot false.
    const issues = [
      { number: 2, body: MARKER, author: { login: "github-actions", is_bot: false } },
      { number: 3, body: MARKER, author: { login: "poke-memory-bot", is_bot: false } },
    ];
    expect(
      findMarkerIssue(issues, MARKER, { authors: ["github-actions", "poke-memory-bot"] }),
    ).toBeNull();
  });

  it("without is_bot, requires a bot-only login form, not the bare name", () => {
    const bare = [
      { number: 2, body: MARKER, author: { login: "github-actions" } },
      { number: 3, body: MARKER, author: { login: "poke-memory-bot" } },
    ];
    expect(
      findMarkerIssue(bare, MARKER, { authors: ["github-actions", "poke-memory-bot"] }),
    ).toBeNull();
    const botForm = [{ number: 4, body: MARKER, author: { login: "poke-memory-bot[bot]" } }];
    expect(findMarkerIssue(botForm, MARKER, { authors: ["poke-memory-bot"] })).toBe(4);
  });

  it("trusts is_bot over the login form when gh reports it", () => {
    const real = [{ number: 5, body: MARKER, author: { login: "app/github-actions", is_bot: true } }];
    expect(findMarkerIssue(real, MARKER, { authors: ["github-actions"] })).toBe(5);
    const liar = [{ number: 6, body: MARKER, author: { login: "app/github-actions", is_bot: false } }];
    expect(findMarkerIssue(liar, MARKER, { authors: ["github-actions"] })).toBeNull();
  });

  it("isBotAuthor accepts only bot forms", () => {
    expect(isBotAuthor({ login: "app/github-actions" })).toBe(true);
    expect(isBotAuthor({ login: "github-actions[bot]" })).toBe(true);
    expect(isBotAuthor({ login: "github-actions" })).toBe(false);
    expect(isBotAuthor({ login: "app/" })).toBe(false);
    expect(isBotAuthor({ login: "[bot]" })).toBe(false);
    expect(isBotAuthor({ login: "someone", is_bot: true })).toBe(true);
    expect(isBotAuthor(null)).toBe(false);
    expect(isBotAuthor({})).toBe(false);
  });

  it("throws on an empty authors list", () => {
    expect(() => findMarkerIssue([], MARKER, { authors: [] })).toThrow(TypeError);
  });
});

describe("parseArgs", () => {
  it("collects every --author", () => {
    expect(parseArgs([MARKER, "--author", "a", "--author", "b"])).toEqual({
      marker: MARKER,
      authors: ["a", "b"],
    });
  });

  it("requires at least one --author", () => {
    expect(() => parseArgs([MARKER])).toThrow(/--author/);
  });

  it("rejects a dangling or unknown argument", () => {
    expect(() => parseArgs([MARKER, "--author"])).toThrow(TypeError);
    expect(() => parseArgs([MARKER, "--author", "a", "--bogus"])).toThrow(TypeError);
  });
});

describe("find-marker-issue CLI", () => {
  const AUTH = ["--author", "github-actions"];
  const bot = { login: "app/github-actions" };
  const run = (input, args = [MARKER, ...AUTH]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });

  it("prints the matching issue number", () => {
    const out = execFileSync(process.execPath, [SCRIPT, MARKER, ...AUTH], {
      input: JSON.stringify([{ number: 40, body: `${MARKER}\n\nreport`, author: bot }]),
      encoding: "utf8",
    });
    expect(out.trim()).toBe("40");
  });

  it("skips a same-marker issue from another author", () => {
    const res = run(
      JSON.stringify([
        { number: 3, body: MARKER, author: { login: "someone" } },
        { number: 40, body: MARKER, author: bot },
      ]),
    );
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("40");
  });

  it("prints nothing and exits 0 when no issue matches", () => {
    const res = run(JSON.stringify([{ number: 12, body: `quote ${MARKER}`, author: bot }]));
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("exits non-zero on malformed input, so a broken lookup fails the step", () => {
    const res = run("HTTP 502 Bad Gateway");
    expect(res.status).not.toBe(0);
    expect(res.stdout).toBe("");
  });

  it("exits non-zero when the author field is missing from the input", () => {
    const res = run(JSON.stringify([{ number: 40, body: MARKER }]));
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("author");
  });

  it("exits non-zero without --author", () => {
    const res = run("[]", [MARKER]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--author");
  });

  it("exits non-zero when the marker argument is missing", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { input: "[]", encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });
});

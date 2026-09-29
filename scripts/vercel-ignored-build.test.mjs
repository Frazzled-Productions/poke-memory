/**
 * Tests for scripts/vercel-ignored-build.sh (#2017), the Vercel Ignored Build
 * Step wired in via vercel.json `ignoreCommand`. Exit 0 = skip the build,
 * exit 1 = build. Each case builds a throwaway repo, commits a change to the
 * given paths, and runs the real script with VERCEL_GIT_PREVIOUS_SHA set to
 * the commit before it.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, "vercel-ignored-build.sh");

// Isolate from the developer's global git config (signing, hooks, default
// branch) so the fixture behaves the same locally and in CI.
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
delete ENV.VERCEL_GIT_PREVIOUS_SHA;

const SKIP = 0;
const BUILD = 1;

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" }).trim();
}

function write(repo, file, content) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content);
}

/** A repo with one base commit touching a spread of real top-level paths. */
function setup() {
  const repo = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
  dirs.push(repo);
  git(repo, "init", "-q", "-b", "main");
  for (const f of ["README.md", "app/page.tsx", "docs/a.md", "messages/en.json", "CHANGELOG.md"]) {
    write(repo, f, "base\n");
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return repo;
}

/** Commit a change to `paths` and return the SHA before that commit. */
function change(repo, paths) {
  const prev = git(repo, "rev-parse", "HEAD");
  for (const p of paths) write(repo, p, `changed ${Math.random()}\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "change");
  return prev;
}

function run(repo, previousSha, cwd = repo) {
  const env = { ...ENV };
  if (previousSha !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = previousSha;
  const r = spawnSync("bash", [SCRIPT], { cwd, env, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const decide = (paths) => {
  const repo = setup();
  return run(repo, change(repo, paths)).status;
};

describe("build-relevant changes build", () => {
  // The #2017 gaps first, then the paths the old allow-list covered, then
  // paths no list mentions (the point of a skip-list: unknown means build).
  it.each([
    ["messages/en.json"],
    ["messages/xx-pseudo.json"],
    ["i18n/request.ts"],
    ["instrumentation.ts"],
    ["instrumentation-client.ts"],
    ["instrumentation-edge.ts"],
    ["instrumentation-node.ts"],
    ["CHANGELOG.md"],
    ["app/page.tsx"],
    ["components/Foo.tsx"],
    ["lib/foo.ts"],
    ["public/sprites/x.webp"],
    ["db/migrations/999_x.sql"],
    ["scripts/build-sw.mjs"],
    ["next.config.ts"],
    ["tsconfig.json"],
    ["postcss.config.mjs"],
    ["package.json"],
    ["package-lock.json"],
    ["vercel.json"],
    [".npmrc"],
    ["proxy.ts"],
    ["sentry.server.config.ts"],
    ["some-new-dir/thing.ts"],
  ])("%s", (path) => {
    expect(decide([path])).toBe(BUILD);
  });

  it("a markdown file inside a build directory still builds (skip entries are root-anchored)", () => {
    expect(decide(["app/README.md"])).toBe(BUILD);
    expect(decide(["lib/docs/helper.ts"])).toBe(BUILD);
    expect(decide(["components/e2e/Thing.tsx"])).toBe(BUILD);
  });

  it("a mixed change builds if any path is build-relevant", () => {
    expect(decide(["docs/a.md", ".github/workflows/ci.yml", "messages/ja.json"])).toBe(BUILD);
  });
});

describe("non-build changes skip", () => {
  it.each([
    ["docs/persistence.md"],
    ["README.md"],
    ["AGENTS.md"],
    ["CLAUDE.md"],
    ["WORKFLOW.md"],
    ["SECURITY.md"],
    ["LICENSE"],
    [".claude/agents/ui-coder.md"],
    ["changelog.d/unreleased/2017-x.md"],
    [".github/workflows/ci.yml"],
    ["e2e/practice.spec.ts"],
    ["playwright.config.ts"],
    ["vitest.config.ts"],
    ["vitest.setup.ts"],
    ["vitest.setup.node.ts"],
    ["coverage-floor.json"],
    ["tools/art/generate.py"],
    [".env.local.example"],
  ])("%s", (path) => {
    expect(decide([path])).toBe(SKIP);
  });

  it("a change touching only several skip-listed paths skips", () => {
    expect(decide(["docs/a.md", "README.md", ".github/workflows/ci.yml", "e2e/x.spec.ts"])).toBe(
      SKIP,
    );
  });

  it("deleting a docs file skips", () => {
    const repo = setup();
    const prev = git(repo, "rev-parse", "HEAD");
    git(repo, "rm", "-q", "docs/a.md");
    git(repo, "commit", "-q", "-m", "rm");
    expect(run(repo, prev).status).toBe(SKIP);
  });
});

describe("edge cases", () => {
  it("builds when VERCEL_GIT_PREVIOUS_SHA is unset (first deploy)", () => {
    const repo = setup();
    const r = run(repo, undefined);
    expect(r.status).toBe(BUILD);
    expect(r.out).toMatch(/forcing build/);
  });

  it("fails open when the previous SHA is unreachable", () => {
    const repo = setup();
    const r = run(repo, "0123456789abcdef0123456789abcdef01234567");
    expect(r.status).toBe(BUILD);
    expect(r.out).toMatch(/fail-open/);
  });

  it("behaves the same when run from a subdirectory", () => {
    const repo = setup();
    const prev = change(repo, ["docs/b.md"]);
    expect(run(repo, prev, join(repo, "app")).status).toBe(SKIP);
    const prev2 = change(repo, ["messages/en.json"]);
    expect(run(repo, prev2, join(repo, "app")).status).toBe(BUILD);
  });
});

describe("wiring", () => {
  it("vercel.json runs this script as the ignoreCommand", () => {
    const vercel = JSON.parse(readFileSync(resolve(here, "../vercel.json"), "utf8"));
    expect(vercel.ignoreCommand).toBe("bash scripts/vercel-ignored-build.sh");
  });
});

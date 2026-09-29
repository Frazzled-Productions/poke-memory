/**
 * Tests for .github/scripts/backmerge-main-into-qa.sh (#2058), the single
 * backmerge every push-to-main workflow path runs so qa never falls behind
 * main. Each case builds a throwaway bare "origin" plus a runner clone, the
 * shape actions/checkout leaves on a GitHub runner, and runs the real script.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.github/scripts/backmerge-main-into-qa.sh",
);

// Isolate from the developer's global git config (commit signing, hooks,
// default branch) so the fixture behaves the same locally and in CI.
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "poke-memory-bot[bot]",
  GIT_AUTHOR_EMAIL: "bot@example.invalid",
  GIT_COMMITTER_NAME: "poke-memory-bot[bot]",
  GIT_COMMITTER_EMAIL: "bot@example.invalid",
};

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" }).trim();
}

function commit(cwd, file, content, msg) {
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", msg);
}

/**
 * origin has main = [base] and qa = main. Returns paths plus a `seed` clone
 * for pushing further commits to origin.
 */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "backmerge-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, seed);
  commit(seed, "README.md", "base\n", "base");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/main");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/qa");
  return { root, origin, seed };
}

/** Runner clone of main, as the release / refresh jobs check out. */
function runner({ root, origin }, { shallow = false } = {}) {
  const dir = join(root, `runner-${dirs.length}-${Math.random().toString(36).slice(2)}`);
  const args = ["clone", "-q", "--branch", "main"];
  if (shallow) args.push("--depth", "1");
  args.push(shallow ? `file://${origin}` : origin, dir);
  git(root, ...args);
  return dir;
}

function pushTo(seed, branch, file, content, msg) {
  git(seed, "fetch", "-q", "origin");
  git(seed, "checkout", "-q", "--detach", `origin/${branch}`);
  commit(seed, file, content, msg);
  git(seed, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
}

function run(cwd, extraEnv = {}) {
  return spawnSync("bash", [SCRIPT, "chore: backmerge main into qa (test)"], {
    cwd,
    env: { ...ENV, ...extraEnv },
    encoding: "utf8",
  });
}

const isAncestor = (cwd, a, b) =>
  spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd, env: ENV }).status === 0;

describe("backmerge-main-into-qa.sh", () => {
  it("is a no-op when qa already contains main", () => {
    const repo = setup();
    pushTo(repo.seed, "qa", "feature.txt", "batch work\n", "feat: batch work");
    const qaBefore = git(repo.origin, "rev-parse", "qa");
    const res = run(runner(repo));
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("nothing to backmerge");
    expect(git(repo.origin, "rev-parse", "qa")).toBe(qaBefore);
  });

  it("merges a main-only commit into qa and keeps qa's un-promoted work", () => {
    const repo = setup();
    pushTo(repo.seed, "qa", "feature.txt", "batch work\n", "feat: batch work");
    const qaBefore = git(repo.origin, "rev-parse", "qa");
    pushTo(repo.seed, "main", "users.json", '{"n":1}\n', "chore(stats): refresh user count [skip ci]");

    const res = run(runner(repo));
    expect(res.status, res.stderr).toBe(0);
    expect(isAncestor(repo.origin, "main", "qa")).toBe(true);
    expect(isAncestor(repo.origin, qaBefore, "qa")).toBe(true);
    expect(git(repo.origin, "log", "-1", "--format=%s", "qa")).toBe(
      "chore: backmerge main into qa (test)",
    );
    // A real merge commit (two parents), never a reset.
    expect(git(repo.origin, "rev-list", "--parents", "-n", "1", "qa").split(" ")).toHaveLength(3);
  });

  it("works from a depth-1 checkout (actions/checkout default)", () => {
    const repo = setup();
    pushTo(repo.seed, "qa", "feature.txt", "batch work\n", "feat: batch work");
    pushTo(repo.seed, "main", "users.json", '{"n":2}\n', "chore(stats): refresh");
    const res = run(runner(repo, { shallow: true }));
    expect(res.status, res.stderr).toBe(0);
    expect(isAncestor(repo.origin, "main", "qa")).toBe(true);
  });

  it("fails loudly on a conflict, names the file, and leaves qa untouched", () => {
    const repo = setup();
    pushTo(repo.seed, "qa", "package.json", '{"v":"qa"}\n', "chore: qa edit");
    pushTo(repo.seed, "main", "package.json", '{"v":"main"}\n', "chore(release): v9.9.9");
    const qaBefore = git(repo.origin, "rev-parse", "qa");

    const res = run(runner(repo));
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("::error::");
    expect(res.stdout).toContain("package.json");
    expect(git(repo.origin, "rev-parse", "qa")).toBe(qaBefore);
  });

  it("retries when qa moves under it, then succeeds", () => {
    const repo = setup();
    pushTo(repo.seed, "main", "users.json", '{"n":3}\n', "chore(stats): refresh");
    // Reject only the first push to qa, as a concurrent qa merge would.
    const hook = join(repo.origin, "hooks", "pre-receive");
    const flag = join(repo.root, "rejected-once");
    writeFileSync(
      hook,
      `#!/bin/sh\nif [ ! -f "${flag}" ]; then touch "${flag}"; echo "simulated race" >&2; exit 1; fi\nexit 0\n`,
    );
    chmodSync(hook, 0o755);

    const res = run(runner(repo));
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("attempt 1/3");
    expect(isAncestor(repo.origin, "main", "qa")).toBe(true);
  });

  it("gives up after MAX_ATTEMPTS push rejections", () => {
    const repo = setup();
    pushTo(repo.seed, "main", "users.json", '{"n":4}\n', "chore(stats): refresh");
    const hook = join(repo.origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho 'protected branch' >&2\nexit 1\n");
    chmodSync(hook, 0o755);

    const res = run(runner(repo), { BACKMERGE_MAX_ATTEMPTS: "2" });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("failed 2 times");
    expect(isAncestor(repo.origin, "main", "qa")).toBe(false);
  });

  it("requires a merge message", () => {
    const repo = setup();
    const res = spawnSync("bash", [SCRIPT], { cwd: runner(repo), env: ENV, encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("usage");
  });
});

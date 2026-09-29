/**
 * Tests for .github/scripts/backmerge-main-into-qa.sh (#2058), the single
 * backmerge every push-to-main workflow path runs so qa never falls behind
 * main. Each case builds a throwaway bare "origin" plus a runner clone, the
 * shape actions/checkout leaves on a GitHub runner, and runs the real script.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
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

  /** Server-side hook that counts pushes to origin and runs `body` (sh). */
  function preReceive(repo, body) {
    const hook = join(repo.origin, "hooks", "pre-receive");
    const count = join(repo.root, "push-count");
    writeFileSync(hook, `#!/bin/sh\necho x >> "${count}"\n${body}\n`);
    chmodSync(hook, 0o755);
    return () => {
      try {
        return readFileSync(count, "utf8").split("\n").filter(Boolean).length;
      } catch {
        return 0;
      }
    };
  }

  /**
   * Client-side post-merge hook in the runner clone: after the script's merge
   * and before its push, move origin/qa from the seed clone, producing a
   * genuine non-fast-forward rejection. `times` = how many runs race.
   */
  function raceQaAfterMerge(repo, dir, times) {
    const hook = join(dir, ".git", "hooks", "post-merge");
    const n = join(repo.root, "race-count");
    writeFileSync(
      hook,
      [
        "#!/bin/sh",
        "unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE",
        `c=$(cat "${n}" 2>/dev/null || echo 0)`,
        `[ "$c" -ge ${times} ] && exit 0`,
        `echo $((c + 1)) > "${n}"`,
        `cd "${repo.seed}" && git fetch -q origin && git checkout -q --detach origin/qa`,
        `echo "race $c" > "race-$c.txt" && git add "race-$c.txt" && git commit -qm "feat: raced $c"`,
        "git push -q origin HEAD:refs/heads/qa",
      ].join("\n") + "\n",
    );
    chmodSync(hook, 0o755);
  }

  it("retries a non-fast-forward rejection (qa moved) and then succeeds", () => {
    const repo = setup();
    pushTo(repo.seed, "main", "users.json", '{"n":3}\n', "chore(stats): refresh");
    const dir = runner(repo);
    raceQaAfterMerge(repo, dir, 1);

    const res = run(dir, { BACKMERGE_RETRY_DELAY: "0" });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain("non-fast-forward (attempt 1/3)");
    expect(isAncestor(repo.origin, "main", "qa")).toBe(true);
    // The racing commit is kept, not overwritten.
    expect(git(repo.origin, "log", "--format=%s", "qa")).toContain("feat: raced 0");
  });

  it("gives up after MAX_ATTEMPTS non-fast-forward rejections", () => {
    const repo = setup();
    pushTo(repo.seed, "main", "users.json", '{"n":4}\n', "chore(stats): refresh");
    const dir = runner(repo);
    raceQaAfterMerge(repo, dir, 99);

    const res = run(dir, { BACKMERGE_MAX_ATTEMPTS: "2", BACKMERGE_RETRY_DELAY: "0" });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("non-fast-forward 2 times");
    expect(isAncestor(repo.origin, "main", "qa")).toBe(false);
  });

  it("fails at once, without retrying, on any other push rejection", () => {
    const repo = setup();
    pushTo(repo.seed, "main", "users.json", '{"n":5}\n', "chore(stats): refresh");
    const pushes = preReceive(repo, "echo 'protected branch' >&2\nexit 1");

    const res = run(runner(repo), { BACKMERGE_RETRY_DELAY: "0" });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("not retried");
    expect(pushes()).toBe(1);
    expect(isAncestor(repo.origin, "main", "qa")).toBe(false);
  });

  it("fails fast without pushing when the merge would change workflow files", () => {
    const repo = setup();
    pushTo(repo.seed, "qa", "feature.txt", "batch work\n", "feat: batch work");
    git(repo.seed, "checkout", "-q", "--detach", "origin/main");
    mkdirSync(join(repo.seed, ".github", "workflows"), { recursive: true });
    commit(repo.seed, ".github/workflows/x.yml", "on: push\n", "fix(workflows): hotfix");
    git(repo.seed, "push", "-q", "origin", "HEAD:refs/heads/main");
    const qaBefore = git(repo.origin, "rev-parse", "qa");
    const pushes = preReceive(repo, "exit 0");

    const res = run(runner(repo));
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("`workflows` permission");
    expect(res.stdout).toContain(".github/workflows/x.yml");
    expect(res.stdout).toContain("git checkout -B qa origin/qa");
    expect(pushes()).toBe(0);
    expect(git(repo.origin, "rev-parse", "qa")).toBe(qaBefore);
  });

  it("does not flag workflow files qa already has identically", () => {
    const repo = setup();
    for (const branch of ["qa", "main"]) {
      git(repo.seed, "fetch", "-q", "origin");
      git(repo.seed, "checkout", "-q", "--detach", `origin/${branch}`);
      mkdirSync(join(repo.seed, ".github", "workflows"), { recursive: true });
      commit(repo.seed, ".github/workflows/x.yml", "on: push\n", `ci: add x on ${branch}`);
      git(repo.seed, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
    }
    pushTo(repo.seed, "main", "users.json", '{"n":6}\n', "chore(stats): refresh");

    const res = run(runner(repo));
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(isAncestor(repo.origin, "main", "qa")).toBe(true);
  });

  it("recognises GitHub's workflow-permission refusal and does not retry it", () => {
    const repo = setup();
    git(repo.seed, "checkout", "-q", "--detach", "origin/main");
    mkdirSync(join(repo.seed, ".github", "workflows"), { recursive: true });
    commit(repo.seed, ".github/workflows/x.yml", "on: push\n", "fix(workflows): hotfix");
    git(repo.seed, "push", "-q", "origin", "HEAD:refs/heads/main");
    const pushes = preReceive(
      repo,
      "echo 'refusing to allow a GitHub App to create or update workflow `.github/workflows/x.yml` without `workflows` permission' >&2\nexit 1",
    );

    const res = run(runner(repo), {
      BACKMERGE_ALLOW_WORKFLOW_CHANGES: "1",
      BACKMERGE_RETRY_DELAY: "0",
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("`workflows` permission");
    expect(pushes()).toBe(1);
  });

  it("restores the caller's original branch", () => {
    const repo = setup();
    pushTo(repo.seed, "main", "users.json", '{"n":7}\n', "chore(stats): refresh");
    const dir = runner(repo);
    expect(run(dir).status).toBe(0);
    expect(git(dir, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("requires a merge message", () => {
    const repo = setup();
    const res = spawnSync("bash", [SCRIPT], { cwd: runner(repo), env: ENV, encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("usage");
  });
});

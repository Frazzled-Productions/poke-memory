// The poke-memory-bot token can bypass the `main` and `qa` rulesets, so it must never meet code that
// has not reached `main` (OpenSpec change bot-token-trusted-steps, #2419). A job that mints it checks
// out only `main`, or checks out another ref with `persist-credentials: false` and runs nothing from
// it; `qa` and branch code (npm, builds, tests, repository scripts) runs only in jobs without the token
// and hands results on as an artefact.
//
// Every minting job also names the GitHub environment `bot` (design D7), so once the bot's private key
// lives only in a `bot` environment that admits `main` (ops #613), only runs on `main` can mint it. The
// three jobs that run on `pull_request` refs cannot name it yet; they are listed below by name, and
// the list fails if one of them starts naming `bot`, so it cannot go stale.
//
// Workflows are read as text (no YAML library is a direct dependency), as in
// workflows-no-backups.test.mjs. The parser relies on the house layout: jobs at two spaces under
// `jobs:`, job keys at four, steps as `      - ` items.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = join(process.cwd(), ".github", "workflows");

/** Jobs that mint the token but run on a `pull_request` ref, which a `main`-only environment refuses
 * (design D7, open items O1 and O2). They keep the repository secret until a follow-up moves them. */
const ENVIRONMENT_EXCEPTIONS = [
  "auto-release.yml/release",
  "auto-release.yml/backmerge-hotfix",
  "qa-issue-label.yml/label",
];

/** Triggers whose runs check out the default branch, `main`, when a checkout names no ref. */
const DEFAULT_BRANCH_TRIGGERS = new Set(["issues", "issue_comment", "schedule", "pull_request_target"]);

/** A `run:` block that executes repository or third-party code from the checkout. */
const RUNS_CODE = /\b(?:npm|npx)\b|\bnode\s+[^\s-]|\bbash\s+\S+\.sh\b|(?:^|[\s"'])\.{0,2}\/?(?:\.github\/scripts|scripts)\/\S+/m;

/** The top-level trigger names in a workflow's `on:` block. */
function triggers(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start === -1) {
    const inline = text.match(/^on:\s*\[?([^\]\n]+)\]?\s*$/m);
    return inline ? inline[1].split(",").map((s) => s.trim()) : [];
  }
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^ {2}([a-z_]+):/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Splits a workflow into jobs: { name, body, steps: string[] }. */
function jobs(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const out = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== "") break;
    const m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      current = { name: m[1], lines: [] };
      out.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return out.map(({ name, lines: body }) => {
    const steps = [];
    let step = null;
    let inSteps = false;
    for (const line of body) {
      if (/^ {4}steps:\s*$/.test(line)) {
        inSteps = true;
        continue;
      }
      if (inSteps && /^ {4}\S/.test(line)) inSteps = false;
      if (!inSteps) continue;
      if (/^ {6}- /.test(line)) {
        step = [line];
        steps.push(step);
      } else if (step) {
        step.push(line);
      }
    }
    return { name, body: body.join("\n"), steps: steps.map((s) => s.join("\n")) };
  });
}

const mints = (step) => /actions\/create-github-app-token/.test(step) && /BOT_APP_PRIVATE_KEY/.test(step);
const isCheckout = (step) => /uses:\s*actions\/checkout@/.test(step);
const checkoutRef = (step) => step.match(/^[ \t]+ref:[ \t]*(.+?)[ \t]*$/m)?.[1].replace(/^["']|["']$/g, "");
const runBlock = (step) => {
  const m = step.match(/^(\s*-?\s*)run:\s*(\|[-+]?|>[-+]?)?\s*(.*)$/m);
  if (!m) return "";
  if (m[3] && !m[2]) return m[3];
  return step.slice(step.indexOf(m[0]) + m[0].length);
};
/** The job's environment name, from `environment: x` or `environment:\n      name: x`. */
function environmentOf(job) {
  const inline = job.body.match(/^ {4}environment:[ \t]*(\S.*?)[ \t]*$/m);
  if (inline) return inline[1].replace(/^["']|["']$/g, "");
  const block = job.body.match(/^ {4}environment:\s*\n {6}name:\s*(\S+)/m);
  return block ? block[1].replace(/^["']|["']$/g, "") : null;
}

/** What is wrong with one job of a workflow under the bot-token rule (code checks, a and b). */
function codeViolations(text, job) {
  if (!job.steps.some(mints)) return [];
  const onDefault = triggers(text).every((t) => DEFAULT_BRANCH_TRIGGERS.has(t));
  const untrusted = job.steps.filter(isCheckout).filter((s) => {
    const ref = checkoutRef(s);
    return ref === undefined ? !onDefault : ref !== "main";
  });
  if (untrusted.length === 0) return [];
  const out = [];
  if (job.steps.some((s) => RUNS_CODE.test(runBlock(s)) || /uses:\s*\.\//.test(s))) {
    out.push("runs repository code from a non-main checkout");
  }
  if (untrusted.some((s) => !/persist-credentials:\s*false/.test(s))) {
    out.push("non-main checkout persists credentials");
  }
  return out;
}

/** Every job in .github/workflows as { file, text, job }. */
function allJobs() {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((file) => {
      const text = readFileSync(join(WORKFLOWS, file), "utf8");
      return jobs(text).map((job) => ({ file, text, job }));
    });
}

function job(file, name) {
  const text = readFileSync(join(WORKFLOWS, file), "utf8");
  const found = jobs(text).find((j) => j.name === name);
  expect(found, `${file} has a job named ${name}`).toBeDefined();
  return found;
}

const OLD_CUT_RELEASE = `on:
  workflow_dispatch:
jobs:
  cut-release:
    runs-on: ubuntu-latest
    steps:
      - name: Mint App installation token
        id: app-token
        uses: actions/create-github-app-token@v3
        with:
          private-key: \${{ secrets.BOT_APP_PRIVATE_KEY }}
      - uses: actions/checkout@v7
        with:
          token: \${{ steps.app-token.outputs.token }}
          ref: qa
      - run: npm ci
`;

const SPLIT_CUT_RELEASE = `on:
  workflow_dispatch:
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: qa
          persist-credentials: false
      - run: npm ci
  open-pr:
    needs: prepare
    environment: bot
    steps:
      - name: Mint App installation token
        id: app-token
        uses: actions/create-github-app-token@v3
        with:
          private-key: \${{ secrets.BOT_APP_PRIVATE_KEY }}
      - name: Open
        env:
          GH_TOKEN: \${{ steps.app-token.outputs.token }}
        run: |
          gh pr create --body-file "$RUNNER_TEMP/body.md"
`;

describe("the parser", () => {
  it("flags the one-job cut-release shape and passes the split one", () => {
    const [old] = jobs(OLD_CUT_RELEASE);
    expect(codeViolations(OLD_CUT_RELEASE, old)).toEqual([
      "runs repository code from a non-main checkout",
      "non-main checkout persists credentials",
    ]);
    const split = jobs(SPLIT_CUT_RELEASE);
    expect(split.map((j) => j.name)).toEqual(["prepare", "open-pr"]);
    for (const j of split) expect(codeViolations(SPLIT_CUT_RELEASE, j)).toEqual([]);
    expect(environmentOf(split[1])).toBe("bot");
    expect(environmentOf(split[0])).toBeNull();
  });

  it("treats a ref-less checkout as main only on default-branch triggers", () => {
    const body = (on) => `on:\n  ${on}:\njobs:\n  j:\n    steps:\n      - uses: actions/create-github-app-token@v3\n        with:\n          private-key: \${{ secrets.BOT_APP_PRIVATE_KEY }}\n      - uses: actions/checkout@v7\n      - run: bash .github/scripts/x.sh\n`;
    const issues = body("issues");
    expect(codeViolations(issues, jobs(issues)[0])).toEqual([]);
    const pr = body("pull_request");
    expect(codeViolations(pr, jobs(pr)[0])).toEqual([
      "runs repository code from a non-main checkout",
      "non-main checkout persists credentials",
    ]);
  });

  it("reads the block form of environment", () => {
    const text = "on:\n  push:\njobs:\n  j:\n    environment:\n      name: bot\n    steps:\n      - run: true\n";
    expect(environmentOf(jobs(text)[0])).toBe("bot");
  });
});

describe("the bot token never meets code from outside main", () => {
  it("no minting job runs non-main code or keeps non-main credentials", () => {
    const offenders = allJobs().flatMap(({ file, text, job: j }) =>
      codeViolations(text, j).map((v) => `${file}/${j.name}: ${v}`),
    );
    expect(offenders).toEqual([]);
  });

  it("finds the minting jobs it is meant to guard", () => {
    const minting = allJobs()
      .filter(({ job: j }) => j.steps.some(mints))
      .map(({ file, job: j }) => `${file}/${j.name}`);
    expect(minting.length).toBeGreaterThanOrEqual(8);
    for (const name of ENVIRONMENT_EXCEPTIONS) expect(minting).toContain(name);
  });
});

describe("jobs that mint the bot token name the bot environment", () => {
  it("every minting job names environment bot, except the named exceptions", () => {
    const missing = allJobs()
      .filter(({ job: j }) => j.steps.some(mints))
      .map(({ file, job: j }) => ({ id: `${file}/${j.name}`, env: environmentOf(j) }))
      .filter(({ id, env }) => !ENVIRONMENT_EXCEPTIONS.includes(id) && env !== "bot")
      .map(({ id }) => id);
    expect(missing).toEqual([]);
  });

  it("no named exception names bot (remove it from the list when it moves)", () => {
    const stale = allJobs()
      .filter(({ file, job: j }) => ENVIRONMENT_EXCEPTIONS.includes(`${file}/${j.name}`))
      .filter(({ job: j }) => environmentOf(j) === "bot")
      .map(({ file, job: j }) => `${file}/${j.name}`);
    expect(stale).toEqual([]);
  });

  it("only minting jobs name bot", () => {
    const extra = allJobs()
      .filter(({ job: j }) => environmentOf(j) === "bot" && !j.steps.some(mints))
      .map(({ file, job: j }) => `${file}/${j.name}`);
    expect(extra).toEqual([]);
  });
});

describe("the split jobs keep their shape", () => {
  it("cut-release: prepare mints nothing, open-pr checks out nothing and uses the minted token", () => {
    const prepare = job("cut-release.yml", "prepare");
    expect(prepare.steps.some(mints)).toBe(false);
    expect(prepare.body).not.toMatch(/app-token/);
    const openPr = job("cut-release.yml", "open-pr");
    expect(openPr.steps.some(mints)).toBe(true);
    expect(openPr.steps.some(isCheckout)).toBe(false);
    expect(openPr.body).toMatch(/needs:\s*prepare/);
    const ghStep = openPr.steps.find((s) => /gh pr create/.test(s));
    expect(ghStep).toMatch(/GH_TOKEN:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
    expect(ghStep).toMatch(/--body-file/);
  });

  it("visual-baseline-update: regenerate mints nothing and only reads, push uses the minted token on the push", () => {
    const regenerate = job("visual-baseline-update.yml", "regenerate");
    expect(regenerate.steps.some(mints)).toBe(false);
    expect(regenerate.body).not.toMatch(/app-token/);
    expect(regenerate.body).toMatch(/contents:\s*read/);
    expect(regenerate.body).not.toMatch(/contents:\s*write/);
    const push = job("visual-baseline-update.yml", "push");
    expect(push.steps.some(mints)).toBe(true);
    expect(push.body).not.toMatch(/\b(?:npm|npx)\b/);
    const pushStep = push.steps.find((s) => /\bpush origin\b/.test(runBlock(s)));
    expect(pushStep).toMatch(/steps\.app-token\.outputs\.token/);
  });

  it("qa-issue-label: the parser comes from main without credentials", () => {
    const label = job("qa-issue-label.yml", "label");
    const checkout = label.steps.find(isCheckout);
    expect(checkoutRef(checkout)).toBe("main");
    expect(checkout).toMatch(/persist-credentials:\s*false/);
  });
});

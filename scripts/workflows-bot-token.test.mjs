// The poke-memory-bot token can bypass the `main` and `qa` rulesets, so it must never meet code that
// has not reached `main` (OpenSpec change bot-token-trusted-steps, #2419). A job that mints it checks
// out only `main`, or checks out another ref with `persist-credentials: false` and runs nothing from
// it; `qa` and branch code (npm, builds, tests, repository scripts) runs only in jobs without the token
// and hands results on as an artefact.
//
// Only runs on `main` can mint it (OpenSpec change bot-key-main-only, #2383): every minting job names
// the GitHub environment `bot`, with no exceptions, so once the bot's private key lives only in a
// `bot` environment that admits `main` (ops #613), no other ref can read it. Every minting workflow
// triggers only on `push` to `main`, `schedule`, `issues`, `workflow_run` or `workflow_dispatch`; no
// workflow uses `pull_request_target`; a `workflow_run` follow-up checks the file and repository that
// triggered it; and a job that runs `qa` or branch code skips on a `main` ref, so that code never
// writes `main`'s Actions cache scope.
//
// Workflows are read as text (no YAML library is a direct dependency), as in
// workflows-no-backups.test.mjs. The parser relies on the house layout: jobs at two spaces under
// `jobs:`, job keys at four, steps as `      - ` items.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = join(process.cwd(), ".github", "workflows");

/** Every job that mints the token, by file and job name (design D6). */
const MINTING_JOBS = [
  "auto-close-umbrella.yml/close-umbrella",
  "auto-release.yml/backmerge-hotfix",
  "auto-release.yml/release",
  "auto-status.yml/done",
  "cut-release-open-pr.yml/open-pr",
  "dependabot-hotfix-label.yml/label",
  "qa-issue-label.yml/label",
  "visual-baseline-push.yml/push",
];

/** Triggers whose runs check out the default branch, `main`, when a checkout names no ref. */
const DEFAULT_BRANCH_TRIGGERS = new Set(["issues", "issue_comment", "schedule", "workflow_run"]);

/** The only triggers a minting workflow may have: each one's run is on `main` (`push` only to `main`). */
const MINTING_TRIGGERS = new Set(["push", "schedule", "issues", "workflow_run", "workflow_dispatch"]);

/** The job `if:` a job that runs code from a non-`main` checkout must carry. */
const SKIP_ON_MAIN = /github\.ref\s*!=\s*'refs\/heads\/main'/;

/** An `||` or a negation in a job `if:` could make every required condition moot. */
const LOOSE_IF = /\|\||!(?!=)/;

/** A `run:` block that executes repository or third-party code from the checkout. */
const RUNS_CODE = /\b(?:npm|npx)\b|\bnode\s+[^\s-]|\bbash\s+\S+\.sh\b|(?:^|[\s"'])\.{0,2}\/?(?:\.github\/scripts|scripts)\/\S+/m;

/** A run step that brings another ref's files into the job without actions/checkout. */
const GIT_OTHER_REF = /\bgh\s+(?:pr\s+checkout|repo\s+clone)\b|\bgit\s+(?:clone|worktree\s+add|checkout|switch)\b/;

/** The top-level trigger names in a workflow's `on:` block. */
function triggers(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^["']?on["']?:\s*$/.test(l));
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
    if (/^[^\s#]/.test(line)) break;
    const m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
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
const isCheckout = (step) => /uses:\s*["']?actions\/checkout@/.test(step);
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

/** The job-level `if:` expression, folded onto one line ("" when there is none). */
function jobIf(job) {
  const lines = job.body.split("\n");
  const at = lines.findIndex((l) => /^ {4}if:/.test(l));
  if (at === -1) return "";
  const out = [lines[at].replace(/^ {4}if:\s*(?:>-?|\|-?)?\s*/, "")];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !/^ {5,}/.test(line)) break;
    out.push(line.trim());
  }
  return out.join(" ").trim();
}

/** The lines of one trigger's block under `on:` (empty when it has no block). */
function triggerBlock(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^["']?on["']?:\s*$/.test(l));
  if (start === -1) return [];
  const at = lines.findIndex((l, i) => i > start && new RegExp(`^ {2}${name}:`).test(l));
  if (at === -1) return [];
  const out = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !/^ {3,}/.test(line)) break;
    if (line.trim() !== "" && !/^\s*#/.test(line)) out.push(line);
  }
  return out;
}

/** What is wrong with a minting workflow's triggers (design D6). */
function triggerViolations(text) {
  const out = triggers(text)
    .filter((t) => !MINTING_TRIGGERS.has(t))
    .map((t) => `triggers on ${t}`);
  if (triggers(text).includes("push")) {
    const block = triggerBlock(text, "push").map((l) => l.trim());
    const onlyMain = block.length === 1 && /^branches:\s*\[\s*["']?main["']?\s*\]$/.test(block[0]);
    const listMain = block.length === 2 && /^branches:$/.test(block[0]) && /^-\s*["']?main["']?$/.test(block[1]);
    if (!onlyMain && !listMain) out.push("push trigger is not only branches: [main]");
  }
  return out;
}

/** What is wrong with a minting job in a `workflow_run` workflow (design D5). */
function followUpViolations(text, job) {
  if (!job.steps.some(mints)) return [];
  const out = [];
  // Anywhere in the workflow: another job could read it and hand it on through `needs`.
  if (/workflow_run\.pull_requests|\.pull_requests\[/.test(text.replace(/^\s*#.*$/gm, ""))) {
    out.push("reads workflow_run.pull_requests");
  }
  if (!triggers(text).includes("workflow_run")) return out;
  const cond = jobIf(job);
  if (LOOSE_IF.test(cond)) out.push("job if: uses || or a negation");
  if (!/github\.event\.workflow_run\.event\s*==\s*'[a-z_]+'/.test(cond)) {
    out.push("does not check the triggering event");
  }
  if (!/github\.event\.workflow_run\.path\s*==\s*'\.github\/workflows\/[^']+'/.test(cond)) {
    out.push("does not check the triggering workflow file");
  }
  if (!/github\.event\.workflow_run\.head_repository\.full_name\s*==\s*github\.repository/.test(cond)) {
    out.push("does not check the triggering repository");
  }
  if (!/github\.event\.workflow_run\.conclusion\s*==\s*'success'/.test(cond)) {
    out.push("does not require a successful triggering run");
  }
  return out;
}

/** A job that checks out a named ref other than `main` and runs code must skip on a `main` ref. */
function mainRefViolations(job) {
  const other = job.steps.filter(isCheckout).some((s) => {
    const ref = checkoutRef(s);
    return ref !== undefined && ref !== "main";
  });
  if (!other) return [];
  const runsCode = job.steps.some((s) => RUNS_CODE.test(runBlock(s)) || /uses:\s*\.\//.test(s));
  if (!runsCode || (SKIP_ON_MAIN.test(jobIf(job)) && !LOOSE_IF.test(jobIf(job).replace(SKIP_ON_MAIN, "")))) return [];
  return ["runs code from a non-main checkout on a main ref"];
}

/** What is wrong with one job of a workflow under the bot-token rule (code checks, a and b). */
function codeViolations(text, job) {
  if (!job.steps.some(mints)) return [];
  const on = triggers(text);
  const onDefault = on.length > 0 && on.every((t) => DEFAULT_BRANCH_TRIGGERS.has(t));
  const untrusted = job.steps.filter(isCheckout).filter((s) => {
    const ref = checkoutRef(s);
    return ref === undefined ? !onDefault : ref !== "main";
  });
  const out = [];
  // Data from another job reaches a run script only through `env:` (checked there), never as an
  // expression spliced into the script, and the job fetches no other ref by hand.
  if (job.steps.some((s) => /\$\{\{\s*needs\./.test(runBlock(s)))) {
    out.push("splices another job's output into a run script");
  }
  if (job.steps.some((s) => GIT_OTHER_REF.test(runBlock(s)))) {
    out.push("checks out or clones another ref in a run step");
  }
  if (untrusted.length === 0) return out;
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

  it("flags a spliced job output and a hand-made checkout in a minting job", () => {
    const text = (run) => `on:\n  schedule:\njobs:\n  j:\n    environment: bot\n    steps:\n      - uses: actions/create-github-app-token@v3\n        with:\n          private-key: \${{ secrets.BOT_APP_PRIVATE_KEY }}\n      - run: ${run}\n`;
    const spliced = text('test "${{ needs.prepare.outputs.status }}" = 0');
    expect(codeViolations(spliced, jobs(spliced)[0])).toEqual(["splices another job's output into a run script"]);
    const prCheckout = text("gh pr checkout 12");
    expect(codeViolations(prCheckout, jobs(prCheckout)[0])).toEqual(["checks out or clones another ref in a run step"]);
    const fine = text('test "$STATUS" = 0');
    expect(codeViolations(fine, jobs(fine)[0])).toEqual([]);
  });

  it("reads the block form of environment", () => {
    const text = "on:\n  push:\njobs:\n  j:\n    environment:\n      name: bot\n    steps:\n      - run: true\n";
    expect(environmentOf(jobs(text)[0])).toBe("bot");
  });

  it("allows only triggers whose runs are on main, and push only to main", () => {
    const on = (block) => `on:\n${block}\njobs:\n  j:\n    steps:\n      - run: true\n`;
    expect(triggerViolations(on("  pull_request:\n    types: [closed]"))).toEqual(["triggers on pull_request"]);
    expect(triggerViolations(on("  pull_request_target:"))).toEqual(["triggers on pull_request_target"]);
    expect(triggerViolations(on("  push:\n    branches: [main]\n  schedule:\n    - cron: '0 9 * * *'\n  workflow_dispatch:"))).toEqual([]);
    expect(triggerViolations(on("  push:\n    branches:\n      - main"))).toEqual([]);
    expect(triggerViolations(on("  push:\n    branches: [main, qa]"))).toEqual(["push trigger is not only branches: [main]"]);
    expect(triggerViolations(on("  push:\n    branches: [main]\n    tags: ['v*']"))).toEqual(["push trigger is not only branches: [main]"]);
    expect(triggerViolations(on("  push:"))).toEqual(["push trigger is not only branches: [main]"]);
    expect(triggerViolations(on("  workflow_run:\n    workflows: [X]\n    types: [completed]\n  issues:"))).toEqual([]);
  });

  it("requires a minting follow-up to check its trigger and never read pull_requests", () => {
    const text = (cond, extra = "") => `on:\n  workflow_run:\n    workflows: [X]\n    types: [completed]\njobs:\n  j:\n    if: >-\n${cond}\n    environment: bot\n    steps:\n      - uses: actions/create-github-app-token@v3\n        with:\n          private-key: \${{ secrets.BOT_APP_PRIVATE_KEY }}\n${extra}`;
    const good = [
      "      github.event.workflow_run.conclusion == 'success' &&",
      "      github.event.workflow_run.path == '.github/workflows/x.yml' &&",
      "      github.event.workflow_run.head_repository.full_name == github.repository &&",
      "      github.event.workflow_run.event == 'workflow_dispatch'",
    ];
    const ok = text(good.join("\n"));
    expect(jobIf(jobs(ok)[0])).toMatch(/conclusion == 'success' && .*path == .*full_name == github\.repository && .*event == 'workflow_dispatch'$/);
    expect(followUpViolations(ok, jobs(ok)[0])).toEqual([]);
    const noPath = text([good[0], good[2], good[3]].join("\n"));
    expect(followUpViolations(noPath, jobs(noPath)[0])).toEqual(["does not check the triggering workflow file"]);
    const noRepo = text([good[0], good[1], good[3]].join("\n"));
    expect(followUpViolations(noRepo, jobs(noRepo)[0])).toEqual(["does not check the triggering repository"]);
    const noSuccess = text([good[1], good[2], good[3]].join("\n"));
    expect(followUpViolations(noSuccess, jobs(noSuccess)[0])).toEqual(["does not require a successful triggering run"]);
    const noEvent = text([good[0], good[1], good[2].replace(" &&", "")].join("\n"));
    expect(followUpViolations(noEvent, jobs(noEvent)[0])).toEqual(["does not check the triggering event"]);
    // `&&` binds tighter than `||`: one `||` lets any successful run of any same-named workflow through.
    const loose = text([good[0].replace("&&", "||"), good[1], good[2], good[3]].join("\n"));
    expect(followUpViolations(loose, jobs(loose)[0])).toEqual(["job if: uses || or a negation"]);
    const negated = text(["      !(github.event.workflow_run.conclusion == 'success') &&", good[1], good[2], good[3]].join("\n"));
    expect(followUpViolations(negated, jobs(negated)[0])).toEqual(["job if: uses || or a negation"]);
    const handedOn = text(good.join("\n")) + "  other:\n    steps:\n      - run: echo \"${{ github.event.workflow_run.pull_requests[0].number }}\"\n";
    expect(followUpViolations(handedOn, jobs(handedOn)[0])).toEqual(["reads workflow_run.pull_requests"]);
    const reads = text(good.join("\n"), "      - env:\n          PR: ${{ github.event.workflow_run.pull_requests[0].number }}\n        run: echo \"$PR\"\n");
    expect(followUpViolations(reads, jobs(reads)[0])).toEqual(["reads workflow_run.pull_requests"]);
  });

  it("requires a job running non-main code to skip on a main ref", () => {
    const text = (ifLine, ref, run) => `on:\n  workflow_dispatch:\njobs:\n  j:\n${ifLine}    steps:\n      - uses: actions/checkout@v7\n        with:\n          ref: ${ref}\n          persist-credentials: false\n      - run: ${run}\n`;
    const bare = text("", "qa", "npm ci");
    expect(mainRefViolations(jobs(bare)[0])).toEqual(["runs code from a non-main checkout on a main ref"]);
    const skipped = text("    if: github.ref != 'refs/heads/main'\n", "qa", "npm ci");
    expect(mainRefViolations(jobs(skipped)[0])).toEqual([]);
    const sha = text("", "${{ needs.gate.outputs.sha }}", "npm run build");
    expect(mainRefViolations(jobs(sha)[0])).toEqual(["runs code from a non-main checkout on a main ref"]);
    const onMain = text("", "main", "npm ci");
    expect(mainRefViolations(jobs(onMain)[0])).toEqual([]);
    const readsOnly = text("", "qa", "git log -1");
    expect(mainRefViolations(jobs(readsOnly)[0])).toEqual([]);
    const loose = text("    if: github.ref != 'refs/heads/main' || always()\n", "qa", "npm ci");
    expect(mainRefViolations(jobs(loose)[0])).toEqual(["runs code from a non-main checkout on a main ref"]);
    const quoted = text("", "qa", "npm ci").replace("uses: actions/checkout@v7", 'uses: "actions/checkout@v7"');
    expect(mainRefViolations(jobs(quoted)[0])).toEqual(["runs code from a non-main checkout on a main ref"]);
  });
});

describe("the bot token never meets code from outside main", () => {
  it("no minting job runs non-main code or keeps non-main credentials", () => {
    const offenders = allJobs().flatMap(({ file, text, job: j }) =>
      codeViolations(text, j).map((v) => `${file}/${j.name}: ${v}`),
    );
    expect(offenders).toEqual([]);
  });

  it("sees every use of the bot key as a mint step the parser found", () => {
    // A job the parser cannot read (other indentation) or a key passed some other way would
    // otherwise escape every check here.
    const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    const uses = files.reduce(
      (n, f) => n + (readFileSync(join(WORKFLOWS, f), "utf8").match(/BOT_APP_PRIVATE_KEY/g) ?? []).length,
      0,
    );
    const mintSteps = allJobs().reduce((n, { job: j }) => n + j.steps.filter(mints).length, 0);
    expect(mintSteps).toBe(uses);
  });

  it("reads every workflow: a trigger and a job each, every checkout and every pull_request_target seen", () => {
    // Fail closed on YAML outside the house layout, which the parser would otherwise skip silently.
    const unread = [];
    for (const f of readdirSync(WORKFLOWS).filter((x) => /\.ya?ml$/.test(x))) {
      const text = readFileSync(join(WORKFLOWS, f), "utf8");
      const code = text.replace(/^\s*#.*$/gm, "").replace(/\s#.*$/gm, "");
      if (triggers(text).length === 0) unread.push(`${f}: no trigger parsed`);
      if (jobs(text).length === 0) unread.push(`${f}: no job parsed`);
      const rawCheckouts = (code.match(/actions\/checkout@/g) ?? []).length;
      const parsed = jobs(text).reduce((n, j) => n + j.steps.filter(isCheckout).length, 0);
      if (rawCheckouts !== parsed) unread.push(`${f}: ${rawCheckouts} checkouts in the text, ${parsed} parsed`);
      if (/pull_request_target/.test(code)) unread.push(`${f}: names pull_request_target`);
    }
    expect(unread).toEqual([]);
  });

  it("the minting jobs are exactly the eight it guards", () => {
    const minting = allJobs()
      .filter(({ job: j }) => j.steps.some(mints))
      .map(({ file, job: j }) => `${file}/${j.name}`)
      .sort();
    expect(minting).toEqual(MINTING_JOBS);
  });
});

describe("only runs on main can mint the bot token", () => {
  it("every minting job names environment bot, with no exceptions", () => {
    const missing = allJobs()
      .filter(({ job: j }) => j.steps.some(mints) && environmentOf(j) !== "bot")
      .map(({ file, job: j }) => `${file}/${j.name}`);
    expect(missing).toEqual([]);
  });

  it("only minting jobs name bot", () => {
    const extra = allJobs()
      .filter(({ job: j }) => environmentOf(j) === "bot" && !j.steps.some(mints))
      .map(({ file, job: j }) => `${file}/${j.name}`);
    expect(extra).toEqual([]);
  });

  it("every minting workflow triggers only from main", () => {
    const files = [...new Set(allJobs().filter(({ job: j }) => j.steps.some(mints)).map(({ file }) => file))];
    const offenders = files.flatMap((file) =>
      triggerViolations(readFileSync(join(WORKFLOWS, file), "utf8")).map((v) => `${file}: ${v}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no workflow uses pull_request_target", () => {
    const offenders = readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .filter((f) => triggers(readFileSync(join(WORKFLOWS, f), "utf8")).includes("pull_request_target"));
    expect(offenders).toEqual([]);
  });

  it("every minting follow-up checks what triggered it and never reads pull_requests", () => {
    const offenders = allJobs().flatMap(({ file, text, job: j }) =>
      followUpViolations(text, j).map((v) => `${file}/${j.name}: ${v}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no job runs qa or branch code on a main ref", () => {
    const offenders = allJobs().flatMap(({ file, job: j }) =>
      mainRefViolations(j).map((v) => `${file}/${j.name}: ${v}`),
    );
    expect(offenders).toEqual([]);
  });
});

/** The text of one workflow file. */
const workflow = (file) => readFileSync(join(WORKFLOWS, file), "utf8");

/** The follow-up's `if:` names the one triggering file, event and branch rule. */
function expectFollowUp(j, { path, event, branch }) {
  const cond = jobIf(j);
  expect(cond).toContain(`github.event.workflow_run.path == '${path}'`);
  expect(cond).toContain(`github.event.workflow_run.event == '${event}'`);
  expect(cond).toContain(branch);
  expect(cond).toContain("github.event.workflow_run.conclusion == 'success'");
  expect(cond).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
}

describe("the split jobs keep their shape", () => {
  it("cut-release: prepare mints nothing, skips on main and hands on the body and meta.txt", () => {
    expect(jobs(workflow("cut-release.yml")).map((j) => j.name)).toEqual(["prepare"]);
    expect(workflow("cut-release.yml")).not.toMatch(/BOT_APP_PRIVATE_KEY|app-token|environment:/);
    const prepare = job("cut-release.yml", "prepare");
    expect(jobIf(prepare)).toMatch(SKIP_ON_MAIN);
    const prepCheckout = prepare.steps.find(isCheckout);
    expect(checkoutRef(prepCheckout)).toBe("qa");
    expect(prepCheckout).toMatch(/persist-credentials:\s*false/);
    expect(prepare.body).toMatch(/meta\.txt/);
    expect(prepare.body).toMatch(/name: promotion-pr/);
  });

  it("cut-release-open-pr: a follow-up on main that checks the artefact before it mints", () => {
    const text = workflow("cut-release-open-pr.yml");
    expect(triggers(text)).toEqual(["workflow_run"]);
    expect(triggerBlock(text, "workflow_run").map((l) => l.trim())).toEqual(["workflows: [Cut Release]", "types: [completed]"]);
    const openPr = job("cut-release-open-pr.yml", "open-pr");
    expectFollowUp(openPr, {
      path: ".github/workflows/cut-release.yml",
      event: "workflow_dispatch",
      branch: "github.event.workflow_run.head_branch == 'qa'",
    });
    expect(environmentOf(openPr)).toBe("bot");
    expect(openPr.steps.some(isCheckout)).toBe(false);
    expect(openPr.steps.some((s) => RUNS_CODE.test(runBlock(s)))).toBe(false);
    const download = openPr.steps.findIndex((s) => /actions\/download-artifact@/.test(s));
    expect(openPr.steps[download]).toMatch(/run-id:\s*\$\{\{\s*github\.event\.workflow_run\.id\s*\}\}/);
    const check = openPr.steps.findIndex((s) => /meta\.txt/.test(runBlock(s)) && /grep -vxE/.test(runBlock(s)));
    const mintAt = openPr.steps.findIndex(mints);
    expect(check).toBeGreaterThan(download);
    expect(mintAt).toBeGreaterThan(check);
    const ghStep = openPr.steps.find((s) => /gh pr create/.test(s));
    expect(ghStep).toMatch(/GH_TOKEN:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
    expect(ghStep).toMatch(/--body-file/);
    expect(text).toMatch(/^  group: cut-release-open-pr$/m);
  });

  it("visual-baseline-update: mints nothing, regenerate skips on main and only reads", () => {
    expect(jobs(workflow("visual-baseline-update.yml")).map((j) => j.name)).toEqual(["gate", "regenerate"]);
    expect(workflow("visual-baseline-update.yml")).not.toMatch(/BOT_APP_PRIVATE_KEY|app-token|environment:/);
    const regenerate = job("visual-baseline-update.yml", "regenerate");
    expect(jobIf(regenerate)).toMatch(SKIP_ON_MAIN);
    expect(jobIf(job("visual-baseline-update.yml", "gate"))).toMatch(SKIP_ON_MAIN);
    expect(regenerate.body).toMatch(/contents:\s*read/);
    expect(regenerate.body).not.toMatch(/contents:\s*write/);
    // Built from the tip the gate job recorded, never a commit the branch's code names.
    expect(regenerate.steps.find(isCheckout)).toMatch(/persist-credentials:\s*false/);
    expect(checkoutRef(regenerate.steps.find(isCheckout))).toBe("${{ needs.gate.outputs.sha }}");
    // The target is recorded by the gate, before any branch code runs.
    expect(job("visual-baseline-update.yml", "gate").body).toMatch(/name: visual-baseline-target/);
  });

  it("visual-baseline-push: a follow-up on main that pushes with plumbing only, after the tip check", () => {
    const text = workflow("visual-baseline-push.yml");
    expect(triggers(text)).toEqual(["workflow_run"]);
    expect(triggerBlock(text, "workflow_run").map((l) => l.trim())).toEqual(["workflows: [Visual Baseline Update]", "types: [completed]"]);
    const push = job("visual-baseline-push.yml", "push");
    expectFollowUp(push, {
      path: ".github/workflows/visual-baseline-update.yml",
      event: "workflow_dispatch",
      branch: "github.event.workflow_run.head_branch == 'qa'",
    });
    // The branch comes from the run title, set by qa's file before any branch code ran.
    expect(workflow("visual-baseline-update.yml")).toMatch(/^run-name: "Visual Baseline Update for \$\{\{ inputs\.branch \}\}"$/m);
    expect(push.body).toMatch(/TITLE: \$\{\{ github\.event\.workflow_run\.display_title \}\}/);
    expect(push.body).toMatch(/"\$TITLE" != "Visual Baseline Update for \$BRANCH"/);
    expect(push.body).toMatch(/RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
    expect(environmentOf(push)).toBe("bot");
    expect(push.body).toMatch(/workflow_run\.triggering_actor\.login/);
    expect(push.body).not.toMatch(/\b(?:npm|npx)\b/);
    expect(push.steps.some((s) => RUNS_CODE.test(runBlock(s)))).toBe(false);
    // No checkout: a symlink in the branch must never turn a copied file into a write elsewhere,
    // so the commit is built with git plumbing from the recorded tip and the artefact's PNGs.
    expect(push.steps.some(isCheckout)).toBe(false);
    expect(push.body).not.toMatch(/\bcp\s|\bgit add\b/);
    expect(push.body).toMatch(/git update-index --add --cacheinfo/);
    expect(push.body).toMatch(/git check-ref-format --branch/);
    // Only plumbing that never writes a branch file to disk or runs one.
    const code = push.body.replace(/^\s*#.*$/gm, "");
    const gitCalls = [...code.matchAll(/\bgit\b(?:\s+-c\s+"[^"]*"|\s+-c\s+\S+|\s*\\\n\s*)*\s+([a-z-]+)/g)].map((m) => m[1]);
    const PLUMBING = ["init", "fetch", "ls-remote", "check-ref-format", "ls-tree", "read-tree", "hash-object", "update-index", "write-tree", "rev-parse", "commit-tree", "push"];
    expect(gitCalls.filter((c) => !PLUMBING.includes(c))).toEqual([]);
    expect(gitCalls).toContain("commit-tree");
    expect(push.body).not.toMatch(/read-tree\s+(?:-\S+\s+)*-u\b|\btar\b|\bmake\b|\bpython|\bsh\s/);
    expect(push.steps.find(mints)).toMatch(/if: steps\.commit\.outputs\.commit != ''/);
    expect(push.body).toMatch(/89504e470d0a1a0a/);
    const mintAt = push.steps.findIndex(mints);
    expect(mintAt).toBeGreaterThan(push.steps.findIndex((s) => /git write-tree/.test(s)));
    expect(mintAt).toBeGreaterThan(push.steps.findIndex((s) => /git ls-remote/.test(s)));
    for (const s of push.steps.filter((x) => /actions\/download-artifact@/.test(x))) {
      expect(s).toMatch(/run-id:\s*\$\{\{\s*github\.event\.workflow_run\.id\s*\}\}/);
    }
    const pushStep = push.steps.find((s) => /\bgit\b[\s\S]*\bpush\s+"https:/.test(runBlock(s)));
    expect(pushStep).toMatch(/steps\.app-token\.outputs\.token/);
    // A moved branch must reject the push, not be overwritten.
    expect(runBlock(pushStep)).not.toMatch(/--force|"\+|push\s+-f\b/);
  });

  it("the trigger workflows hold no permission and do nothing", () => {
    for (const file of ["qa-issue-label-trigger.yml", "dependabot-hotfix-label-trigger.yml"]) {
      const text = workflow(file);
      expect(triggers(text), file).toEqual(["pull_request"]);
      expect(text, file).toMatch(/^permissions: \{\}$/m);
      expect(text, file).not.toMatch(/secrets\.|uses:/);
      for (const j of jobs(text)) {
        expect(j.steps.map((s) => runBlock(s).trim()), `${file}/${j.name}`).toEqual(["true"]);
      }
    }
  });

  it("qa-issue-label: a follow-up on main with main's parser and no credentials", () => {
    const text = workflow("qa-issue-label.yml");
    expect(triggers(text)).toEqual(["workflow_run"]);
    expect(triggerBlock(text, "workflow_run").map((l) => l.trim())).toEqual(["workflows: [QA Issue Label trigger]", "types: [completed]"]);
    const label = job("qa-issue-label.yml", "label");
    const cond = jobIf(label);
    expect(cond).toContain("github.event.workflow_run.path == '.github/workflows/qa-issue-label-trigger.yml'");
    expect(cond).toContain("github.event.workflow_run.event == 'pull_request'");
    const checkout = label.steps.find(isCheckout);
    expect(checkoutRef(checkout)).toBe("main");
    expect(checkout).toMatch(/persist-credentials:\s*false/);
  });

  it("dependabot-hotfix-label: a follow-up on main for Dependabot runs only", () => {
    const text = workflow("dependabot-hotfix-label.yml");
    expect(triggers(text)).toEqual(["workflow_run"]);
    expect(triggerBlock(text, "workflow_run").map((l) => l.trim())).toEqual(["workflows: [Dependabot hotfix label trigger]", "types: [completed]"]);
    const label = job("dependabot-hotfix-label.yml", "label");
    const cond = jobIf(label);
    expect(cond).toContain("github.event.workflow_run.path == '.github/workflows/dependabot-hotfix-label-trigger.yml'");
    expect(cond).toContain("github.event.workflow_run.event == 'pull_request'");
    expect(cond).toContain("github.event.workflow_run.actor.login == 'dependabot[bot]'");
    expect(label.steps.some(isCheckout)).toBe(false);
  });

  it("auto-release: find-pr mints nothing and gates the release and the hotfix backmerge", () => {
    const text = workflow("auto-release.yml");
    expect(triggers(text)).toEqual(["push", "schedule", "workflow_dispatch"]);
    const findPr = job("auto-release.yml", "find-pr");
    expect(findPr.steps.some(mints)).toBe(false);
    expect(findPr.steps.some(isCheckout)).toBe(false);
    expect(environmentOf(findPr)).toBeNull();
    for (const name of ["release", "backmerge-hotfix"]) {
      const j = job("auto-release.yml", name);
      expect(j.body, name).toMatch(/^ {4}needs: find-pr$/m);
      expect(jobIf(j), name).toMatch(/needs\.find-pr\.outputs\.kind/);
    }
    expect(jobIf(job("auto-release.yml", "release"))).toContain("github.event_name != 'push'");
    // Only this repository's PRs count, and the release commit must not start another run.
    expect(findPr.body).toContain(".head.repo.full_name == $repo");
    expect(text).toMatch(/git commit -m "chore\(release\): v\$\{NEW_VERSION\} \(\$\{BUMP_TYPE\}\) \[skip ci\]"/);
    expect(text).not.toMatch(/event_name\s*[!=]=\s*'pull_request'/);
  });
});

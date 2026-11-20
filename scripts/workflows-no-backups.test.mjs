// No GitHub workflow may read, write or list the D1 backups (owner ruling 20 November 2026,
// OpenSpec change move-to-cloudflare, design D10). The backups hold every player's data, and copying
// them to a GitHub-hosted runner is a transfer the privacy notice does not cover, so the export and
// the monthly restore check run inside Cloudflare, in the production Worker's Cron Triggers. This
// test fails if a workflow names the backups bucket, calls R2 (REST API or wrangler), dumps D1, or
// fetches a backup object.
//
// The same goes for reading production data at all (owner ruling 20 November 2026, design D13): the
// user-count badge and the grade_log divergence check run in the Worker, so no workflow may query the
// production D1, and only the deploy workflow may hold the Cloudflare token, which can write D1. The
// preview token has its own name and lives only in the trusted preview upload workflow (change
// preview-deploy-guard, koinori #2925 F3 and F4).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = join(process.cwd(), ".github", "workflows");

/** What touching the backups from a runner looks like. */
const BACKUP_PATTERNS = [
  { name: "the backups bucket", re: /poke-memory-backups/ },
  { name: "the R2 REST API", re: /\/r2\/buckets/i },
  { name: "the R2 jurisdiction header", re: /cf-r2-jurisdiction/i },
  { name: "wrangler r2", re: /\bwrangler\s+r2\b/i },
  { name: "a full D1 dump", re: /\bd1\s+export\b/i },
  { name: "a backup object key", re: /\bd1\/[\w-]*\/?(?:latest\.json|\d{4}-\d{2}-\d{2}\.(?:sql|json))/ },
];

/** The backup patterns `text` matches. */
function backupTouches(text) {
  return BACKUP_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name);
}

describe("no workflow touches the D1 backups", () => {
  it("recognises the GitHub restore job this replaced", () => {
    const removed = [
      'api="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects"',
      "BUCKET: poke-memory-backups",
      'curl -fsS -H "cf-r2-jurisdiction: eu" -o "$RUNNER_TEMP/backup.sql" "${api}/${key}"',
      "npx wrangler r2 object get poke-memory-backups/d1/poke-memory/latest.json",
      "npx wrangler d1 export DB --remote --output dump.sql",
    ];
    for (const line of removed) expect(backupTouches(line), line).not.toEqual([]);
    expect(backupTouches("npx wrangler d1 migrations apply DB --local")).toEqual([]);
    expect(backupTouches("npx wrangler d1 execute DB --remote --env preview --file seed.sql")).toEqual([]);
  });

  it("every workflow file is free of backup access", () => {
    const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((f) => {
      const hits = backupTouches(readFileSync(join(WORKFLOWS, f), "utf8"));
      return hits.length ? [`${f}: ${hits.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});

/** What reading the production database from a runner looks like. */
const DATA_READ_PATTERNS = [
  // `--env preview` targets the preview database (deploy.yml seeds it), never production.
  { name: "a remote D1 query on production", re: /\bd1\s+execute\b(?![^\n]*--env[ =]preview)[^\n]*--remote/i },
  { name: "the D1 REST query API", re: /\/d1\/database\//i },
  { name: "the D1 query helper", re: /d1-query\.mjs|\bqueryD1\b/ },
  { name: "the removed monitor scripts", re: /refresh-user-count\.mjs|check-grade-log-divergence\.mjs/ },
];

/** The only workflow allowed to read the production token: it deploys and applies migrations. */
const TOKEN_HOLDERS = ["deploy.yml"];
/** The only workflow allowed to read the preview token (F4: a name of its own, never the production one). */
const PREVIEW_TOKEN_HOLDERS = ["preview-upload.yml"];

function dataReads(text) {
  return DATA_READ_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name);
}

describe("no workflow reads production data", () => {
  it("recognises the monitor steps this replaced, and allows the preview seed and migrations", () => {
    const removed = [
      "run: node scripts/refresh-user-count.mjs",
      "OUTPUT=$(node .github/scripts/check-grade-log-divergence.mjs)",
      'npx wrangler d1 execute DB --remote --json --command "SELECT COUNT(*) AS n FROM \\"user\\""',
      "curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/d1/database/$DB/query",
    ];
    for (const line of removed) expect(dataReads(line), line).not.toEqual([]);
    expect(dataReads('npx wrangler d1 execute DB --remote --env preview --yes --file "$RUNNER_TEMP/seed-preview.sql"')).toEqual([]);
    expect(dataReads("npx wrangler d1 migrations apply DB --remote")).toEqual([]);
    expect(dataReads("npx wrangler d1 migrations apply DB --local")).toEqual([]);
  });

  it("every workflow file is free of production data reads", () => {
    const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    const offenders = files.flatMap((f) => {
      const hits = dataReads(readFileSync(join(WORKFLOWS, f), "utf8"));
      return hits.length ? [`${f}: ${hits.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("only the deploy workflow holds the Cloudflare token", () => {
    const holders = readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .filter((f) => /secrets\.CLOUDFLARE_API_TOKEN\b/.test(readFileSync(join(WORKFLOWS, f), "utf8")));
    expect(holders).toEqual(TOKEN_HOLDERS);
  });

  it("only the preview upload workflow holds the preview token", () => {
    const holders = readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .filter((f) => /secrets\.CLOUDFLARE_PREVIEW_API_TOKEN\b/.test(readFileSync(join(WORKFLOWS, f), "utf8")));
    expect(holders).toEqual(PREVIEW_TOKEN_HOLDERS);
  });
});

// Deploy guard (Fraser's ruling of 19 November 2026, ops #610): only `main` may use the token that
// writes the live D1 and the production Worker. It lives in the GitHub environment `Production`,
// whose deployment branch rule admits only `main`; there is no repository-level copy.
/** The job ids under `jobs:` in `text`. */
function jobNames(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === "jobs:");
  if (start === -1) return [];
  return lines
    .slice(start + 1)
    .map((l) => /^ {2}([\w-]+):\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** Whether a workflow runs on pull requests (pull_request or pull_request_target). */
function onPullRequest(text) {
  return /^ {2}pull_request(_target)?:/m.test(text) || /^on:.*\bpull_request/m.test(text);
}

/** The block of `jobs:` in `text` for job `name`, up to the next job. */
function jobBlock(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}[\w-]+:\s*$/.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

describe("deploy guard", () => {
  const deploy = readFileSync(join(WORKFLOWS, "deploy.yml"), "utf8");

  it("runs the production job in the Production environment, on main only", () => {
    const production = jobBlock(deploy, "production");
    expect(production).toMatch(/^ {4}environment: Production$/m);
    expect(production).toMatch(/^ {4}if: .*github\.ref == 'refs\/heads\/main'/m);
  });

  it("builds the pull request preview with no environment and no secret", () => {
    const preview = jobBlock(deploy, "preview");
    expect(preview).not.toBe("");
    expect(preview).not.toMatch(/^\s+environment:/m);
    expect(preview).not.toMatch(/\$\{\{[^}]*secrets\./);
    expect(preview).toMatch(/actions\/upload-artifact@/);
    expect(preview).toMatch(/^ {10}name: preview-bundle$/m);
  });

  it("is not started by a published Release, whose tag ref the environment refuses", () => {
    expect(deploy).not.toMatch(/^ {2}release:/m);
    expect(deploy).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("is dispatched on main by auto-release.yml after the [skip ci] release commit", () => {
    const release = readFileSync(join(WORKFLOWS, "auto-release.yml"), "utf8");
    expect(release).toMatch(/gh workflow run deploy\.yml [^\n]*--ref main/);
    expect(jobBlock(release, "release")).toMatch(/^ {6}actions: write\b/m);
  });
});

describe("production Worker address", () => {
  it("serves production only on its custom domain, and keeps the preview's workers.dev address", () => {
    const wrangler = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
    const [top, preview] = wrangler.split(/^ {4}"preview": \{$/m);
    expect(preview, "wrangler.jsonc has no env.preview block").toBeDefined();
    expect(top).toMatch(/^ {2}"workers_dev": false,$/m);
    expect(preview).toMatch(/^ {6}"workers_dev": true,$/m);
  });
});

// Preview guard (koinori #2925 F3 and F4; change preview-deploy-guard). A pull request can edit its own
// workflow and wrangler.jsonc, so no pull_request job may name the Preview environment or a
// Cloudflare secret. The preview is uploaded by preview-upload.yml, a workflow_run workflow that GitHub
// always runs from the default branch, with everything that runs or configures a run checked out from
// `main` (never the PR's base: `qa` takes any CI-green change, #2415), so the preview bindings are never
// the PR's. It never writes D1, so its token can be Workers-only; deploy.yml's production job applies
// `main`'s migrations and seed to the preview database instead (change preview-upload-trust-main).
describe("preview guard", () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
  const text = (f) => readFileSync(join(WORKFLOWS, f), "utf8");

  it("recognises a pull request job that reaches for the preview environment or a token", () => {
    const old = [
      "on:\n  pull_request:\n    branches: [qa]\njobs:\n  preview:\n    environment: Preview\n    runs-on: ubuntu-latest",
      "on:\n  pull_request:\njobs:\n  preview:\n    steps:\n      - env:\n          T: ${{ secrets.CLOUDFLARE_PREVIEW_API_TOKEN }}",
    ];
    for (const yml of old) expect(pullRequestOffenders("old.yml", yml), yml).not.toEqual([]);
    const production = "on:\n  pull_request:\njobs:\n  production:\n    environment: Production\n    steps:\n      - env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}";
    expect(pullRequestOffenders("deploy.yml", production)).toEqual([]);
  });

  it("no pull_request job names the Preview environment or a Cloudflare secret", () => {
    const offenders = files.flatMap((f) => pullRequestOffenders(f, text(f)));
    expect(offenders).toEqual([]);
  });

  it("uploads preview versions only from preview-upload.yml", () => {
    const uploaders = files.filter((f) => /versions upload|cf:upload-preview|--preview-alias/.test(text(f)));
    expect(uploaders).toEqual(["preview-upload.yml"]);
  });

  it("runs the upload on workflow_run of Deploy, in Preview, on a GitHub-hosted runner", () => {
    const upload = text("preview-upload.yml");
    expect(upload).toMatch(/^ {2}workflow_run:$/m);
    expect(upload).toMatch(/^ {4}workflows: \[Deploy\]$/m);
    expect(onPullRequest(upload)).toBe(false);
    const job = jobBlock(upload, "upload");
    expect(job).toMatch(/^ {4}environment: Preview$/m);
    expect(job).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
    expect(job).toMatch(/github\.event\.workflow_run\.event == 'pull_request'/);
    expect(job).toMatch(/github\.event\.workflow_run\.conclusion == 'success'/);
    expect(job).toMatch(/github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
    expect(job).toMatch(/contains\(fromJSON\('\["qa","main"\]'\), github\.event\.workflow_run\.pull_requests\[0\]\.base\.ref\)/);
  });

  it("checks out only main, never the pull request's base or head, and names the trusted config", () => {
    const upload = text("preview-upload.yml");
    const refs = [...upload.matchAll(/^ {10}ref: (.*)$/gm)].map((m) => m[1]);
    const checkouts = (upload.match(/uses: actions\/checkout@/g) ?? []).length;
    expect(checkouts).toBeGreaterThan(0);
    expect(refs.length, "every checkout names its ref").toBe(checkouts);
    for (const ref of refs) expect(ref).toBe("main");
    for (const line of upload.split("\n").filter((l) => /npx wrangler /.test(l))) {
      expect(line, line).toMatch(/--config wrangler\.jsonc/);
    }
    expect(upload).toMatch(/--no-bundle/);
    // `find | grep -q` would pass under pipefail when grep exits early (SIGPIPE); -print -quit cannot.
    expect(upload).toMatch(/\[ -n "\$\(find "\$BUNDLE" -type l -print -quit\)" \]/);
    expect(upload).not.toMatch(/\| grep -q \./);
    expect(upload).toMatch(/^permissions: \{\}$/m);
  });

  it("never writes D1 or runs the seed, so its token can be Workers-only", () => {
    const upload = code(text("preview-upload.yml"));
    expect(upload).not.toMatch(/\bwrangler\s+d1\b/);
    expect(upload).not.toMatch(/seed-preview/);
    // The artefact's migrations are neither read nor moved into place.
    expect(upload).not.toMatch(/\$BUNDLE\/migrations|rm -r db\/d1\/migrations/);
    expect(upload).not.toMatch(/PREVIEW_TEST_PASSWORD/);
  });

  it("lists what differs from main with a read-only compare call, checking out nothing", () => {
    const compare = steps(jobBlock(text("preview-upload.yml"), "upload")).filter((s) => /compare\/main\.\.\./.test(s));
    expect(compare).toHaveLength(1);
    expect(compare[0]).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
    expect(compare[0]).not.toMatch(/secrets\./);
    expect(compare[0]).not.toMatch(/actions\/checkout@|git (fetch|checkout|clone)/);
  });

  it("leaves the migrations out of the pull request's bundle", () => {
    expect(code(jobBlock(text("deploy.yml"), "preview"))).not.toMatch(/db\/d1\/migrations/);
  });

  it("migrates and seeds the preview database from the production job, after production deploys", () => {
    const production = steps(jobBlock(text("deploy.yml"), "production"));
    const at = (re) => production.findIndex((s) => re.test(code(s)));
    const deployed = at(/name: Deploy the Worker/);
    const migrate = at(/npx wrangler d1 migrations apply DB --remote --env preview\b/);
    const seed = at(/node scripts\/cloudflare\/seed-preview\.mjs\b/);
    const load = at(/npx wrangler d1 execute DB --remote --env preview --yes --file\b/);
    expect(deployed).toBeGreaterThan(-1);
    expect(migrate, "preview migrations after the production deploy").toBeGreaterThan(deployed);
    expect(seed, "seed after the preview migrations").toBeGreaterThan(migrate);
    expect(load, "seed loaded after it is written").toBeGreaterThan(seed);
    // The seed step runs repository code, so it gets no Cloudflare token.
    expect(production[seed]).not.toMatch(/CLOUDFLARE_API_TOKEN/);
  });
});

/** `text` without its comment lines, so prose about a command does not count as running it. */
function code(text) {
  return text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** The steps of a job block, each from its `- ` line to the next. */
function steps(job) {
  return job.split(/^ {6}- /m).slice(1);
}

/** The jobs in a pull_request workflow that name the Preview environment or a Cloudflare secret. */
function pullRequestOffenders(file, yml) {
  if (!onPullRequest(yml)) return [];
  return jobNames(yml).flatMap((name) => {
    const job = jobBlock(yml, name);
    // The production job is refused on any ref but main by its environment (deploy guard above).
    if (/^ {4}environment: Production$/m.test(job)) return [];
    const hits = [];
    if (/environment:\s*["']?preview\b/i.test(job)) hits.push("the Preview environment");
    if (/secrets\.CLOUDFLARE_/.test(job)) hits.push("a Cloudflare secret");
    return hits.length ? [`${file} ${name}: ${hits.join(", ")}`] : [];
  });
}

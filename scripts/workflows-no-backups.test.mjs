// No GitHub workflow may read, write or list the D1 backups (owner ruling 20 November 2026,
// OpenSpec change move-to-cloudflare, design D10). The backups hold every player's data, and copying
// them to a GitHub-hosted runner is a transfer the privacy notice does not cover, so the export and
// the monthly restore check run inside Cloudflare, in the production Worker's Cron Triggers. This
// test fails if a workflow names the backups bucket, calls R2 (REST API or wrangler), dumps D1, or
// fetches a backup object.
//
// The same goes for reading production data at all (owner ruling 20 November 2026, design D13): the
// user-count badge and the grade_log divergence check run in the Worker, so no workflow may query the
// production D1, and only the deploy workflow may hold the Cloudflare token, which can write D1.
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

/** The only workflow allowed to hold CLOUDFLARE_API_TOKEN: it deploys and applies migrations. */
const TOKEN_HOLDERS = ["deploy.yml"];

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
      .filter((f) => /CLOUDFLARE_API_TOKEN/.test(readFileSync(join(WORKFLOWS, f), "utf8")));
    expect(holders).toEqual(TOKEN_HOLDERS);
  });
});

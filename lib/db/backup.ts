/**
 * The nightly D1 backup and the monthly restore check (design D10). Both run
 * inside Cloudflare through the production Worker's own bindings, so no GitHub
 * runner or other machine ever holds the backups (owner ruling 20 November
 * 2026; the pattern is koinori-web's worker/d1-backup.ts).
 *
 * Export, POST /api/cron/backup at 02:00 UTC: every table as SQL INSERT
 * statements, gzipped, written to R2 under the prefix in D1_BACKUP_PREFIX as
 * `<prefix>/YYYY-MM-DD.sql.gz`, then `<prefix>/YYYY-MM-DD.json` (the manifest:
 * time, key, size, SHA-256 and per-table counts) and last `<prefix>/latest.json`
 * (the same manifest), then dumps and manifests older than 90 days deleted.
 *
 * Restore check, the Worker's monthly Cron Trigger (04:00 UTC on the 1st,
 * worker/index.ts): reads latest.json and the dump it names, and fails unless
 * the checksum matches, the dump decompresses, every table holds the
 * manifest's number of INSERT lines (an empty table has none, so absent counts
 * as 0) and the export is at most MAX_BACKUP_AGE_DAYS old. It logs one
 * "d1-backup: restore-check ok|FAILED: ..." line (keys and counts, never row
 * data), emails the FAILED line through Resend (lib/alertEmail.ts) and
 * rethrows on failure, so the invocation shows as failed in the Worker's Cron
 * Events and Workers Logs. A failed export (app/api/cron/backup) emails too.
 *
 * Dump format (gunzipped):
 *
 *   -- poke-memory D1 backup 2026-11-20T02:00:03.120Z
 *   -- rows user: 21
 *   -- rows card_reviews: 4812
 *   ... one `-- rows <table>: <count>` line for every table, empty ones too
 *   INSERT INTO "user" ("id", "name", ...) VALUES (...);
 *
 *   DROP TRIGGER IF EXISTS "card_reviews_reject_regression_trigger";
 *   ... every trigger, then one INSERT per row ...
 *   CREATE TRIGGER card_reviews_reject_regression_trigger ... END;
 *
 * One statement a line: text holding a line break or other control character
 * is written as UTF-8 hex (CAST(X'..' AS TEXT)), so the restore check can
 * count rows by line. A restore gunzips the file, applies db/d1/migrations to
 * a fresh database, then runs the file with `wrangler d1 execute --file`. Tables come in BACKUP_TABLE_ORDER,
 * parents first. The file drops the database's triggers before the rows and
 * recreates them verbatim after, so rows go back exactly as stored: rows the
 * copy from Supabase kept with triggers bypassed (more than 10 push rows for
 * one user, a streak date in the future) are neither trimmed nor refused, and
 * push_subscriptions.last_seen_at keeps its value. No PRAGMA or transaction
 * statements.
 */
import { type AlertEnv, sendAlertEmail } from "../alertEmail";
import type { D1DatabaseLike, R2BucketLike } from "./d1";
import { backupTables, databaseTriggers, readTablePages } from "./system/backup";

export const BACKUP_RETENTION_DAYS = 90;
/** The restore check fails when the newest export is older than this. */
export const MAX_BACKUP_AGE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const INSERT_LINE = /^INSERT INTO "([A-Za-z_][A-Za-z0-9_]*)" \(/;

export type BackupManifest = {
  exportedAt: string;
  key: string;
  bytes: number;
  sha256: string;
  counts: Record<string, number>;
};

/** The export's object keys for `now`'s UTC date. `prefix` has no trailing slash. */
export function backupKeys(prefix: string, now: Date) {
  const day = now.toISOString().slice(0, 10);
  return { dump: `${prefix}/${day}.sql.gz`, counts: `${prefix}/${day}.json`, latest: `${prefix}/latest.json` };
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** One stored value as an SQL literal. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot back up the number ${value}`);
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") {
    if (/[\u0000-\u001f\u007f]/.test(value)) return `CAST(X'${hex(new TextEncoder().encode(value))}' AS TEXT)`;
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes =
      value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return `X'${hex(bytes)}'`;
  }
  if (Array.isArray(value)) return sqlLiteral(Uint8Array.from(value as number[]));
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The whole database as backup SQL, with the row-count header. */
export async function dumpDatabase(db: D1DatabaseLike, now: Date = new Date()): Promise<{
  sql: string;
  counts: Record<string, number>;
}> {
  const { tables, unlisted } = await backupTables(db);
  if (unlisted.length > 0) {
    console.warn(`[backup] tables missing from BACKUP_TABLE_ORDER, dumped last: ${unlisted.join(", ")}`);
  }
  const counts: Record<string, number> = {};
  const statements: string[] = [];
  for (const table of tables) {
    counts[table] = 0;
    await readTablePages(db, table, (columns, rows) => {
      const prefix = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (`;
      for (const row of rows) {
        statements.push(`${prefix}${row.map(sqlLiteral).join(", ")});`);
      }
      counts[table] += rows.length;
    });
  }
  const triggers = await databaseTriggers(db);
  const header = [
    `-- poke-memory D1 backup ${now.toISOString()}`,
    ...tables.map((t) => `-- rows ${t}: ${counts[t]}`),
  ];
  return {
    sql:
      [
        ...header,
        ...triggers.map((t) => `DROP TRIGGER IF EXISTS ${quoteIdentifier(t.name)};`),
        ...statements,
        ...triggers.map((t) => `${t.sql};`),
      ].join("\n") + "\n",
    counts,
  };
}

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"))).text();
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/**
 * Deletes the dumps and manifests under `prefix` whose key date is more than
 * BACKUP_RETENTION_DAYS before `now`'s UTC date. latest.json and any other
 * key are kept.
 */
export async function pruneBackups(bucket: R2BucketLike, prefix: string, now: Date = new Date()): Promise<string[]> {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const cutoff = today - BACKUP_RETENTION_DAYS * DAY_MS;
  const listed = `${prefix}/`;
  const keyDate = /^(\d{4}-\d{2}-\d{2})\.(?:sql\.gz|json)$/;
  const expired: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: listed, cursor });
    for (const { key } of page.objects) {
      const match = keyDate.exec(key.slice(listed.length));
      if (match && Date.parse(`${match[1]}T00:00:00Z`) < cutoff) expired.push(key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // R2 deletes up to 1000 keys per call.
  for (let i = 0; i < expired.length; i += 1000) {
    await bucket.delete(expired.slice(i, i + 1000));
  }
  return expired;
}

export type BackupResult = BackupManifest & { pruned: string[] };

/** Dumps the database to `bucket` under `prefix`, then prunes old backups. */
export async function runBackup(
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  prefix: string,
  now: Date = new Date(),
): Promise<BackupResult> {
  const { sql, counts } = await dumpDatabase(db, now);
  const keys = backupKeys(prefix, now);
  const bytes = await gzip(sql);
  const manifest: BackupManifest = {
    exportedAt: now.toISOString(),
    key: keys.dump,
    bytes: bytes.byteLength,
    sha256: await sha256(bytes),
    counts,
  };
  const json = JSON.stringify(manifest, null, 2);
  // The dump first and latest.json last, so latest.json never names an object that is not there.
  await bucket.put(keys.dump, bytes, { httpMetadata: { contentType: "application/gzip" } });
  await bucket.put(keys.counts, json, { httpMetadata: { contentType: "application/json" } });
  await bucket.put(keys.latest, json, { httpMetadata: { contentType: "application/json" } });
  const pruned = await pruneBackups(bucket, prefix, now);
  return { ...manifest, pruned };
}

/** The restore check: throws with every problem found in the newest export. */
export async function checkLatestBackup({
  bucket,
  prefix,
  now = new Date(),
}: {
  bucket: R2BucketLike;
  prefix: string;
  now?: Date;
}): Promise<{ key: string; exportedAt: string; counts: Record<string, number> }> {
  const latestKey = backupKeys(prefix, now).latest;
  const latest = await bucket.get(latestKey);
  if (!latest) throw new Error(`no latest.json at ${latestKey}: the nightly export has not run`);
  const manifest = JSON.parse(await latest.text()) as BackupManifest;

  const problems: string[] = [];
  if (!manifest.counts || Object.keys(manifest.counts).length === 0) {
    problems.push("latest.json lists no tables, so the export is empty");
  }
  const ageDays = (now.getTime() - new Date(manifest.exportedAt).getTime()) / DAY_MS;
  if (!(ageDays <= MAX_BACKUP_AGE_DAYS)) {
    problems.push(`the newest export is stale: ${manifest.exportedAt}, more than ${MAX_BACKUP_AGE_DAYS} days ago`);
  }
  const dump = await bucket.get(manifest.key);
  if (!dump) {
    problems.push(`${manifest.key} is missing`);
  } else {
    const bytes = new Uint8Array(await dump.arrayBuffer());
    const digest = await sha256(bytes);
    if (digest !== manifest.sha256) problems.push(`${manifest.key}: sha256 ${digest}, latest.json says ${manifest.sha256}`);
    let sql: string | undefined;
    try {
      sql = await gunzip(bytes);
    } catch (err) {
      problems.push(`${manifest.key} does not decompress: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (sql !== undefined) {
      const found: Record<string, number> = {};
      for (const line of sql.split("\n")) {
        const table = INSERT_LINE.exec(line)?.[1];
        if (table) found[table] = (found[table] ?? 0) + 1;
      }
      for (const [table, expected] of Object.entries(manifest.counts ?? {})) {
        // An empty table has no INSERT lines, so absent means 0; the manifest still has to list it.
        if ((found[table] ?? 0) !== expected) problems.push(`${table}: counts file ${expected}, dump ${found[table] ?? 0}`);
      }
    }
  }
  if (problems.length) throw new Error(`the restore check failed for ${manifest.key}: ${problems.join("; ")}`);
  return { key: manifest.key, exportedAt: manifest.exportedAt, counts: manifest.counts };
}

type Sink = { log: (message: string) => void; error: (message: string) => void };

/**
 * Emails a failed backup task's FAILED line (design D10). Never throws; without
 * RESEND_API_KEY it logs "d1-backup: alert not sent: no RESEND_API_KEY".
 */
export function sendBackupAlert(
  env: AlertEnv,
  task: "export" | "restore-check",
  line: string,
  now: Date,
  options: { fetch?: typeof fetch; out?: Pick<Console, "error"> } = {},
): Promise<boolean> {
  return sendAlertEmail(
    env,
    {
      tag: "d1-backup",
      subject: `Poké Memory: D1 ${task} FAILED`,
      text: `${line}\n\nFrom the poke-memory Worker at ${now.toISOString()}. Details: Workers Logs, search "d1-backup".\n`,
    },
    options,
  );
}

/**
 * The monthly Cron Trigger's body (worker/index.ts): runs checkLatestBackup
 * and logs one line; on failure logs "d1-backup: restore-check FAILED: ...",
 * emails that line and rethrows.
 */
export async function runRestoreCheck(
  env: AlertEnv & { BACKUPS?: R2BucketLike; D1_BACKUP_PREFIX?: string },
  now: Date = new Date(),
  out: Sink = console,
  send: typeof fetch = fetch,
): Promise<void> {
  try {
    if (!env.BACKUPS || !env.D1_BACKUP_PREFIX) {
      throw new Error("the BACKUPS binding or the D1_BACKUP_PREFIX variable is missing (wrangler.jsonc)");
    }
    const result = await checkLatestBackup({ bucket: env.BACKUPS, prefix: env.D1_BACKUP_PREFIX, now });
    out.log(`d1-backup: restore-check ok, ${result.key} (exported ${result.exportedAt}), counts ${JSON.stringify(result.counts)}`);
  } catch (error) {
    const line = `d1-backup: restore-check FAILED: ${error instanceof Error ? error.message : String(error)}`;
    out.error(line);
    await sendBackupAlert(env, "restore-check", line, now, { fetch: send, out });
    throw error;
  }
}

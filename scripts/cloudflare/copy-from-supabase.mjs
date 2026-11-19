#!/usr/bin/env node
// The data copy from Supabase (Postgres) to D1 (OpenSpec change move-to-cloudflare, task 8.3,
// design D12). Reads the Supabase data and writes ONE SQL file for
// `wrangler d1 execute <db> --remote --file <file>`, plus a JSON manifest of row counts for
// scripts/cloudflare/compare-counts.mjs.
//
//   node scripts/cloudflare/copy-from-supabase.mjs --dump public.sql --dump auth.sql \
//     --out import.sql [--manifest import.counts.json]
//   DATABASE_URL=postgres://... node scripts/cloudflare/copy-from-supabase.mjs --out import.sql
//
// Sources (either):
//   --dump <file>   files written by `supabase db dump --data-only` (pg_dump --column-inserts),
//                   one for the public schema and one for auth (users and identities). Repeatable.
//   DATABASE_URL    a Postgres connection; every query runs in a READ ONLY transaction.
//
// What it writes, in foreign-key order:
//   "user"     one per auth.users row: the SAME id, email, name (raw_user_meta_data full_name,
//              name or user_name, else the username), emailVerified from email_confirmed_at,
//              image from avatar_url, createdAt/updatedAt, username and displayUsername from
//              public.usernames; a GitHub user without a username gets their GitHub login
//              (raw_user_meta_data user_name) as displayUsername, the trainer card handle.
//   "account"  auth.identities for github and google (providerId as is, accountId = the
//              provider's user id), and a "credential" account for every user with an
//              encrypted_password (the bcrypt hash as is; accountId = the user id).
//              No sessions and no verification rows: everyone signs in again.
//   app tables row for row, converted per the header of db/d1/migrations/0001_schema.sql
//              (timestamptz to ISO UTC with milliseconds and Z, booleans 0/1, jsonb as JSON
//              text, dates YYYY-MM-DD).
//
// Skipped and counted (never silently):
//   rate_limit_buckets  every row: transient one-hour windows of hashed IPs, rebuilt by use.
//   push_subscriptions  rows on a host outside the known-host CHECK (the send path ignored them).
//   any row with NaN or Infinity in a REAL column (SQLite stores no NaN).
//   identities for "email" (the credential account covers them) and any other provider.
//
// Fidelity: the migrations' triggers would rewrite or reject copied rows (the push insert
// trigger stamps last_seen_at and trims to 10 rows; the reset tombstones and the future-date
// check reject rows). The file drops every trigger the migrations define after a guard that
// aborts unless the target is empty, inserts the rows, then recreates each trigger verbatim
// from the migration SQL. Run it once on a freshly migrated, empty database.
//
// Output privacy: the SQL file holds personal data (emails, password hashes). Keep it out of the
// repository and delete it after the import. This script prints counts only, never row contents.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const D1_MIGRATIONS_DIR = path.join(REPO_ROOT, "db", "d1", "migrations");

/** Same as lib/auth/username.ts INTERNAL_DOMAIN. */
const INTERNAL_DOMAIN = "users.noreply.pokememory.internal";

/**
 * Same as KNOWN_PUSH_ENDPOINT_PATTERN in lib/push/endpoints.ts (a test compares them) and the
 * push_subscriptions_endpoint_known_host CHECK in 0001_schema.sql.
 */
export const KNOWN_PUSH_ENDPOINT_PATTERN = String.raw`^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/`;
const KNOWN_PUSH_ENDPOINT = new RegExp(KNOWN_PUSH_ENDPOINT_PATTERN);

/**
 * The copied app tables in insert order, with each D1 column's type (lib/db/tables.ts for the
 * per-user tables; a test keeps both in step with the migrations). Source and target columns must
 * match exactly, so schema drift fails the copy instead of dropping or defaulting a column.
 */
export const APP_TABLES = {
  user_settings: {
    user_id: "text",
    settings: "json",
    updated_at: "timestamp",
    timezone: "text",
    date_format: "text",
    last_reset_at: "timestamp",
    push_notification_hour: "int",
  },
  card_reviews: {
    id: "text",
    user_id: "text",
    card_type: "text",
    subject_key: "text",
    locale: "text",
    due_date: "date",
    last_review: "date",
    first_seen: "date",
    updated_at: "timestamp",
    stability: "real",
    difficulty: "real",
    elapsed_days: "int",
    scheduled_days: "int",
    reps: "int",
    lapses: "int",
    fsrs_state: "text",
    hidden_since: "date",
    seen_in_pasture: "bool",
  },
  streak_days: { id: "text", user_id: "text", review_date: "date" },
  grade_log: {
    id: "text",
    user_id: "text",
    occurred_at: "int",
    entry_date: "date",
    card_type: "text",
    grade: "int",
    subject_key: "text",
    locale: "text",
    learning_step: "int",
    step_started_at: "int",
  },
  push_subscriptions: {
    id: "text",
    user_id: "text",
    endpoint: "text",
    p256dh: "text",
    auth_secret: "text",
    created_at: "timestamp",
    last_seen_at: "timestamp",
  },
  feedback: {
    id: "text",
    user_id: "text",
    category: "text",
    message: "text",
    page: "text",
    app_version: "text",
    created_at: "timestamp",
  },
  feedback_discord_posts: { feedback_id: "text", discord_message_id: "text", created_at: "timestamp" },
};

/** Public tables read but not copied row for row, with the reason. */
export const NOT_COPIED_PUBLIC_TABLES = {
  usernames: "folded into \"user\".username",
  rate_limit_buckets: "transient one-hour rate-limit windows",
};

/** Every table the guard checks is empty before the import. */
export const TARGET_TABLES = ["user", "account", "session", ...Object.keys(APP_TABLES), "rate_limit_buckets"];

const OAUTH_PROVIDERS = new Set(["github", "google"]);

// ── Reading a pg_dump --column-inserts file ────────────────────────────────

function isSpace(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function isWordChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Parses the INSERT statements of a pg_dump --column-inserts file (what `supabase db dump
 * --data-only` writes). Returns Map<"schema.table", rows[]>, each row an object of column name to
 * the value's Postgres text form (string) or null. Booleans read as "true"/"false"; numbers keep
 * their exact text. Other statements (SET, SELECT setval, comments) are skipped. Errors give a
 * position, never row contents.
 */
export function parseDump(text, into = new Map()) {
  let i = 0;
  const n = text.length;
  const fail = (what) => {
    throw new Error(`Dump parse error at offset ${i}: ${what}`);
  };

  function skipSpaceAndComments() {
    for (;;) {
      while (i < n && isSpace(text[i])) i++;
      if (text.startsWith("--", i)) {
        const end = text.indexOf("\n", i);
        i = end === -1 ? n : end + 1;
      } else if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) fail("unterminated comment");
        i = end + 2;
      } else return;
    }
  }

  function readQuoted(quote) {
    // Standard-conforming string or quoted identifier: the quote is doubled to escape it.
    i++;
    let out = "";
    for (;;) {
      const end = text.indexOf(quote, i);
      if (end === -1) fail("unterminated quoted value");
      out += text.slice(i, end);
      i = end + 1;
      if (text[i] === quote) {
        out += quote;
        i++;
      } else return out;
    }
  }

  function readEscapeString() {
    // E'...' with backslash escapes (pg_dump writes these only without standard_conforming_strings).
    i += 2;
    let out = "";
    while (i < n) {
      const ch = text[i];
      if (ch === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        i++;
        return out;
      }
      if (ch === "\\") {
        const next = text[i + 1];
        const simple = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (next in simple) {
          out += simple[next];
          i += 2;
        } else if (next === "x" && /^[0-9A-Fa-f]{1,2}/.test(text.slice(i + 2, i + 4))) {
          const hex = text.slice(i + 2, i + 4).match(/^[0-9A-Fa-f]{1,2}/)[0];
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2 + hex.length;
        } else if (next === "u" && /^[0-9A-Fa-f]{4}$/.test(text.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else if (/[0-7]/.test(next)) {
          const oct = text.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
          out += String.fromCharCode(parseInt(oct, 8));
          i += 1 + oct.length;
        } else {
          out += next;
          i += 2;
        }
        continue;
      }
      out += ch;
      i++;
    }
    fail("unterminated escape string");
  }

  function readIdentifier() {
    if (text[i] === '"') return readQuoted('"');
    const start = i;
    while (i < n && isWordChar(text[i])) i++;
    if (i === start) fail("expected an identifier");
    return text.slice(start, i).toLowerCase();
  }

  function expect(ch) {
    skipSpaceAndComments();
    if (text[i] !== ch) fail(`expected "${ch}"`);
    i++;
  }

  function readValue() {
    skipSpaceAndComments();
    const ch = text[i];
    let value;
    if (ch === "'") value = readQuoted("'");
    else if ((ch === "E" || ch === "e") && text[i + 1] === "'") value = readEscapeString();
    else {
      const start = i;
      while (i < n && /[A-Za-z0-9_.+-]/.test(text[i])) i++;
      const word = text.slice(start, i);
      if (word === "") fail("expected a value");
      const lower = word.toLowerCase();
      if (lower === "null") value = null;
      else if (lower === "true" || lower === "false") value = lower;
      else if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(word)) value = word;
      else fail("unsupported value literal");
    }
    // Skip an explicit cast (value::type), which pg_dump does not normally write.
    skipSpaceAndComments();
    while (text.startsWith("::", i)) {
      i += 2;
      skipSpaceAndComments();
      readIdentifier();
      while (text[i] === "." || text[i] === "[" || text[i] === "]") {
        i++;
        if (isWordChar(text[i] ?? "") || text[i] === '"') readIdentifier();
      }
      skipSpaceAndComments();
    }
    return value;
  }

  function skipStatement() {
    while (i < n) {
      const ch = text[i];
      if (ch === ";") {
        i++;
        return;
      }
      if (ch === "'") readQuoted("'");
      else if (ch === '"') readQuoted('"');
      else if (text.startsWith("--", i) || text.startsWith("/*", i)) skipSpaceAndComments();
      else i++;
    }
  }

  function readInsert() {
    i += "insert".length;
    skipSpaceAndComments();
    if (text.slice(i, i + 4).toLowerCase() !== "into") fail('expected "INTO"');
    i += 4;
    skipSpaceAndComments();
    let schema = "public";
    let table = readIdentifier();
    if (text[i] === ".") {
      i++;
      schema = table;
      table = readIdentifier();
    }
    expect("(");
    const columns = [];
    for (;;) {
      skipSpaceAndComments();
      columns.push(readIdentifier());
      skipSpaceAndComments();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === ")") {
        i++;
        break;
      }
      fail("expected , or ) in the column list");
    }
    skipSpaceAndComments();
    if (text.slice(i, i + 6).toLowerCase() !== "values") fail('expected "VALUES"');
    i += 6;
    const key = `${schema}.${table}`;
    if (!into.has(key)) into.set(key, []);
    const rows = into.get(key);
    for (;;) {
      expect("(");
      const row = {};
      for (let c = 0; c < columns.length; c++) {
        row[columns[c]] = readValue();
        skipSpaceAndComments();
        if (c < columns.length - 1) {
          if (text[i] !== ",") fail("expected , between values");
          i++;
        }
      }
      expect(")");
      rows.push(row);
      skipSpaceAndComments();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === ";") {
        i++;
        return;
      }
      fail("expected , or ; after a row");
    }
  }

  while (i < n) {
    skipSpaceAndComments();
    if (i >= n) break;
    if (text.slice(i, i + 6).toLowerCase() === "insert" && !isWordChar(text[i + 6] ?? "")) readInsert();
    else skipStatement();
  }
  return into;
}

/** Reads and merges several dump files. */
export function readDumpFiles(files) {
  const tables = new Map();
  for (const file of files) parseDump(readFileSync(file, "utf8"), tables);
  return tables;
}

// ── Reading a live Postgres connection (read only) ─────────────────────────

const SOURCE_TABLES = [
  "auth.users",
  "auth.identities",
  ...Object.keys(APP_TABLES).map((t) => `public.${t}`),
  ...Object.keys(NOT_COPIED_PUBLIC_TABLES).map((t) => `public.${t}`),
];

/**
 * Reads the source tables over a Postgres connection, every value in its text form (the same
 * shape parseDump returns, except booleans as t/f). `client` is a connected pg Client or anything
 * with query(sql).
 * Runs in a READ ONLY transaction with the session time zone at UTC, then rolls back.
 */
export async function readPostgres(client) {
  const tables = new Map();
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const { rows: present } = await client.query(
      "SELECT table_schema || '.' || table_name AS name FROM information_schema.tables " +
        "WHERE table_type = 'BASE TABLE' AND table_schema IN ('public', 'auth')",
    );
    const names = new Set(present.map((r) => r.name));
    for (const name of names) {
      if (name.startsWith("public.")) tables.set(name, []);
    }
    for (const name of SOURCE_TABLES) {
      if (!names.has(name)) continue;
      const [schema, table] = name.split(".");
      const { rows } = await client.query(`SELECT * FROM "${schema}"."${table}"`);
      tables.set(name, rows);
    }
  } finally {
    await client.query("ROLLBACK");
  }
  return tables;
}

async function connectPostgres(connectionString) {
  const pg = (await import("pg")).default;
  // Every type as its raw text, so timestamps keep their precision and numbers their digits.
  const client = new pg.Client({ connectionString, types: { getTypeParser: () => (value) => value } });
  await client.connect();
  return client;
}

// ── Value conversion ───────────────────────────────────────────────────────

class SkipRow extends Error {}

/** Postgres timestamptz text to ISO 8601 UTC with milliseconds (sub-millisecond digits dropped). */
export function toIsoTimestamp(value) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)?$/.exec(value);
  if (!m) throw new Error("unsupported timestamp value");
  const [, date, time, fraction = "", zone = "Z"] = m;
  const ms = (fraction + "000").slice(0, 3);
  let offset = zone;
  if (zone !== "Z") {
    const [sign, digits] = [zone[0], zone.slice(1).replaceAll(":", "")];
    if (digits.length > 4 && digits.slice(4) !== "00") throw new Error("unsupported timestamp offset");
    offset = `${sign}${digits.slice(0, 2)}:${(digits.slice(2, 4) || "00")}`;
  }
  const parsed = new Date(`${date}T${time}.${ms}${offset}`);
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid timestamp value");
  return parsed.toISOString();
}

function convertValue(type, value) {
  if (value === null) return null;
  switch (type) {
    case "text":
      return { text: value };
    case "int":
      if (!/^[+-]?\d+$/.test(value)) throw new Error("expected an integer");
      return { raw: value.replace(/^\+/, "") };
    case "real": {
      if (/^[+-]?(nan|infinity|inf)$/i.test(value)) throw new SkipRow("non-finite number in a REAL column");
      if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(value)) throw new Error("expected a number");
      // The exact source text: SQLite parses it to the nearest double, as JavaScript would.
      return { raw: value.replace(/^\+/, "") };
    }
    case "bool":
      if (value === "t" || value === "true") return { raw: "1" };
      if (value === "f" || value === "false") return { raw: "0" };
      throw new Error("expected a boolean");
    case "json":
      JSON.parse(value); // jsonb output is valid JSON; fail loudly if not
      return { text: value };
    case "timestamp":
      return { text: toIsoTimestamp(value) };
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("expected a YYYY-MM-DD date");
      return { text: value };
    default:
      throw new Error(`unknown column type ${type}`);
  }
}

function literal(converted) {
  if (converted === null) return "NULL";
  if ("raw" in converted) return converted.raw;
  return `'${converted.text.replaceAll("'", "''")}'`;
}

function insertSql(table, columns, literals) {
  const cols = columns.map((c) => `"${c}"`).join(", ");
  return `INSERT INTO "${table}" (${cols}) VALUES (${literals.join(", ")});`;
}

/** A stable UUID-shaped id from a key, so the same source gives the same file. */
export function stableId(key) {
  const h = createHash("sha256").update(key).digest("hex");
  const variant = "89ab"[parseInt(h[16], 16) % 4];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseJsonObject(value) {
  if (value === null || value === undefined) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function nonEmptyString(...candidates) {
  for (const c of candidates) if (typeof c === "string" && c.trim() !== "") return c;
  return null;
}

// ── Triggers ───────────────────────────────────────────────────────────────

/**
 * Every trigger the D1 migrations leave in place, as [name, verbatim CREATE TRIGGER statement],
 * in migration order. A later DROP TRIGGER removes one.
 */
export function migrationTriggers(migrationsDir = D1_MIGRATIONS_DIR) {
  const triggers = new Map();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    const pattern = /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)(\w+)\1[\s\S]*?\bEND\s*;|DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?("?)(\w+)\3\s*;/gi;
    for (const m of sql.matchAll(pattern)) {
      if (m[2]) triggers.set(m[2], m[0]);
      else triggers.delete(m[4]);
    }
  }
  return [...triggers.entries()];
}

// ── The conversion ─────────────────────────────────────────────────────────

/**
 * Converts the source tables (from parseDump or readPostgres) into the import SQL and a manifest
 * of counts. Throws on schema drift or a value it cannot convert; never includes row contents in
 * an error.
 *
 * @returns {{ sql: string, manifest: { tables: { table: string, source: number, expected: number, skipped: Record<string, number> }[] } }}
 */
export function convert(source, { migrationsDir = D1_MIGRATIONS_DIR } = {}) {
  const rowsOf = (name) => source.get(name) ?? [];

  const unknown = [...source.keys()].filter(
    (k) => k.startsWith("public.") && !(k.slice(7) in APP_TABLES) && !(k.slice(7) in NOT_COPIED_PUBLIC_TABLES),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown public tables in the source (copy or skip them explicitly): ${unknown.join(", ")}`);
  }

  const manifest = [];
  const out = [];
  const record = (table, sourceCount, expected, skipped) =>
    manifest.push({ table, source: sourceCount, expected, skipped });
  const bump = (skipped, reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  // Users.
  const usernames = new Map();
  for (const row of rowsOf("public.usernames")) usernames.set(row.user_id, row.username);
  const githubUserIds = new Set(
    rowsOf("auth.identities")
      .filter((i) => i.provider === "github")
      .map((i) => i.user_id),
  );
  const users = rowsOf("auth.users");
  const userIds = new Set();
  const userCols = ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt", "username", "displayUsername"];
  const userLines = [];
  for (const u of users) {
    if (!UUID.test(u.id ?? "")) throw new Error("auth.users row without a UUID id");
    userIds.add(u.id);
    const meta = parseJsonObject(u.raw_user_meta_data);
    const username = usernames.get(u.id) ?? null;
    const email = nonEmptyString(u.email) ?? `${username ?? u.id}@${INTERNAL_DOMAIN}`;
    const name = nonEmptyString(meta.full_name, meta.name, meta.user_name, username) ?? "";
    const githubLogin = githubUserIds.has(u.id) ? nonEmptyString(meta.user_name) : null;
    const displayUsername = username ?? githubLogin;
    const createdAt = toIsoTimestamp(u.created_at);
    const updatedAt = u.updated_at ? toIsoTimestamp(u.updated_at) : createdAt;
    userLines.push(
      insertSql("user", userCols, [
        literal({ text: u.id }),
        literal({ text: name }),
        literal({ text: email }),
        u.email_confirmed_at ? "1" : "0",
        literal(nonEmptyString(meta.avatar_url) ? { text: meta.avatar_url } : null),
        literal({ text: createdAt }),
        literal({ text: updatedAt }),
        literal(username ? { text: username } : null),
        literal(displayUsername ? { text: displayUsername } : null),
      ]),
    );
  }
  for (const [userId] of usernames) {
    if (!userIds.has(userId)) throw new Error("public.usernames row for a user missing from auth.users");
  }
  record("user", users.length, userLines.length, {});

  // Accounts.
  const accountCols = ["id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt"];
  const accountLines = [];
  const accountSkipped = {};
  const identities = rowsOf("auth.identities");
  for (const ident of identities) {
    const provider = ident.provider;
    if (!OAUTH_PROVIDERS.has(provider)) {
      bump(accountSkipped, provider === "email" ? "email identity (the credential account covers it)" : `provider ${provider} not supported`);
      continue;
    }
    if (!userIds.has(ident.user_id)) throw new Error("auth.identities row for a user missing from auth.users");
    const providerUserId = nonEmptyString(ident.provider_id, parseJsonObject(ident.identity_data).sub);
    if (!providerUserId) throw new Error(`auth.identities ${provider} row without a provider user id`);
    const createdAt = toIsoTimestamp(ident.created_at);
    accountLines.push(
      insertSql("account", accountCols, [
        literal({ text: UUID.test(ident.id ?? "") ? ident.id : stableId(`${provider}:${providerUserId}`) }),
        literal({ text: providerUserId }),
        literal({ text: provider }),
        literal({ text: ident.user_id }),
        "NULL",
        literal({ text: createdAt }),
        literal({ text: ident.updated_at ? toIsoTimestamp(ident.updated_at) : createdAt }),
      ]),
    );
  }
  let credentialSource = 0;
  for (const u of users) {
    if (!nonEmptyString(u.encrypted_password)) continue;
    credentialSource++;
    const createdAt = toIsoTimestamp(u.created_at);
    accountLines.push(
      insertSql("account", accountCols, [
        literal({ text: stableId(`credential:${u.id}`) }),
        literal({ text: u.id }),
        literal({ text: "credential" }),
        literal({ text: u.id }),
        literal({ text: u.encrypted_password }),
        literal({ text: createdAt }),
        literal({ text: u.updated_at ? toIsoTimestamp(u.updated_at) : createdAt }),
      ]),
    );
  }
  record("account", identities.length + credentialSource, accountLines.length, accountSkipped);

  // App tables.
  const appLines = [];
  for (const [table, types] of Object.entries(APP_TABLES)) {
    const rows = rowsOf(`public.${table}`);
    const columns = Object.keys(types);
    const skipped = {};
    let written = 0;
    for (const row of rows) {
      const sourceCols = Object.keys(row);
      const extra = sourceCols.filter((c) => !(c in types));
      const missing = columns.filter((c) => !sourceCols.includes(c));
      if (extra.length || missing.length) {
        throw new Error(
          `public.${table} columns differ from D1: extra [${extra.join(", ")}], missing [${missing.join(", ")}]`,
        );
      }
      if (table === "push_subscriptions" && !KNOWN_PUSH_ENDPOINT.test(row.endpoint ?? "")) {
        bump(skipped, "endpoint host outside the known-host CHECK");
        continue;
      }
      try {
        const literals = columns.map((c) => {
          try {
            return literal(convertValue(types[c], row[c]));
          } catch (err) {
            if (err instanceof SkipRow) throw err;
            throw new Error(`public.${table}.${c}: ${err.message}`);
          }
        });
        appLines.push(insertSql(table, columns, literals));
        written++;
      } catch (err) {
        if (!(err instanceof SkipRow)) throw err;
        bump(skipped, err.message);
      }
    }
    record(table, rows.length, written, skipped);
  }
  const rateLimitRows = rowsOf("public.rate_limit_buckets").length;
  record("rate_limit_buckets", rateLimitRows, 0, rateLimitRows ? { [NOT_COPIED_PUBLIC_TABLES.rate_limit_buckets]: rateLimitRows } : {});

  // Assemble: guard, drop triggers, rows, recreate triggers.
  const triggers = migrationTriggers(migrationsDir);
  const guardSum = TARGET_TABLES.map((t) => `(SELECT count(*) FROM "${t}")`).join(" + ");
  out.push(
    "-- Generated by scripts/cloudflare/copy-from-supabase.mjs. HOLDS PERSONAL DATA: never commit it;",
    "-- delete it after the import. Run once on a freshly migrated, empty D1 database.",
    "-- Guard: aborts here unless every target table is empty.",
    "CREATE TABLE IF NOT EXISTS _copy_guard (rows_in_target INTEGER NOT NULL CHECK (rows_in_target = 0));",
    `INSERT INTO _copy_guard (rows_in_target) SELECT ${guardSum};`,
    "DROP TABLE _copy_guard;",
    "-- Triggers would rewrite or reject copied rows; they are recreated verbatim at the end.",
    ...triggers.map(([name]) => `DROP TRIGGER IF EXISTS "${name}";`),
    ...userLines,
    ...accountLines,
    ...appLines,
    "-- Recreate the triggers exactly as the migrations define them.",
    ...triggers.map(([, sql]) => sql),
  );
  return { sql: `${out.join("\n")}\n`, manifest: { tables: manifest } };
}

/** The counts as a fixed-width table (counts only). */
export function formatManifest(manifest) {
  const lines = [`${"table".padEnd(24)} ${"source".padStart(8)} ${"to write".padStart(8)}  skipped`];
  for (const t of manifest.tables) {
    const skipped = Object.entries(t.skipped).map(([r, n]) => `${n} (${r})`).join("; ");
    lines.push(`${t.table.padEnd(24)} ${String(t.source).padStart(8)} ${String(t.expected).padStart(8)}  ${skipped}`);
  }
  return lines.join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dumps: [], out: null, manifest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dump") args.dumps.push(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--manifest") args.manifest = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.out) throw new Error("--out <import.sql> is required");
  args.manifest ??= args.out.replace(/\.sql$/, "") + ".counts.json";
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let source;
  if (args.dumps.length > 0) {
    source = readDumpFiles(args.dumps);
  } else if (process.env.DATABASE_URL) {
    const client = await connectPostgres(process.env.DATABASE_URL);
    try {
      source = await readPostgres(client);
    } finally {
      await client.end();
    }
  } else {
    throw new Error("Give --dump <file> (repeatable) or set DATABASE_URL");
  }
  const { sql, manifest } = convert(source);
  writeFileSync(args.out, sql, { mode: 0o600 });
  writeFileSync(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(formatManifest(manifest));
  console.log(`\nWrote ${args.out} and ${args.manifest} (counts only printed).`);
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

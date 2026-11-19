/**
 * Better Auth in-process against the node:sqlite D1 stand-in (design D6):
 * username sign-up and sign-in, the per-IP throttle, bcrypt hashes copied
 * from Supabase, the privacy settings and the social redirect. No network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { forUser } from "@/lib/db/scope";
import { createSqliteD1, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { createAuth, type Auth, type AuthEnv } from "./server";
import { syntheticEmail } from "./username";

const BASE = "http://localhost:3000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let d1: SqliteD1;
let auth: Auth;

function env(): AuthEnv {
  return {
    DB: d1,
    BETTER_AUTH_URL: BASE,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
    GITHUB_CLIENT_ID: "test-github-client",
    GITHUB_CLIENT_SECRET: "test-github-secret",
    GOOGLE_CLIENT_ID: "test-google-client",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    RATE_LIMIT_SALT: "test-salt",
  };
}

beforeEach(() => {
  d1 = createSqliteD1();
  auth = createAuth(env());
});
afterEach(() => d1.close());

async function post(path: string, body: unknown, { ip = "203.0.113.7", cookie }: { ip?: string; cookie?: string } = {}) {
  const res = await auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        "cf-connecting-ip": ip,
        "user-agent": "vitest-agent/1.0",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json, cookie: sessionCookie(res) };
}

function sessionCookie(res: Response): string | undefined {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="));
  return raw?.split(";")[0];
}

const signUp = (name: string, password = "correct horse", ip?: string) =>
  post("/sign-up/email", { email: syntheticEmail(name), password, name, username: name }, { ip });
const signIn = (name: string, password = "correct horse", ip?: string) =>
  post("/sign-in/username", { username: name, password }, { ip });

function row<T>(sql: string, ...params: (string | number)[]): T {
  return d1.sqlite.prepare(sql).get(...params) as T;
}

describe("username sign-up and sign-in", () => {
  it("creates a user with a UUID id, the username and the synthetic email, and signs them in", async () => {
    const res = await signUp("ash_ketchum");
    expect(res.status).toBe(200);
    const user = row<{ id: string; username: string; email: string }>(`SELECT id, username, email FROM "user"`);
    expect(user.id).toMatch(UUID);
    expect(user.username).toBe("ash_ketchum");
    expect(user.email).toBe(syntheticEmail("ash_ketchum"));
    const session = await auth.api.getSession({ headers: new Headers({ cookie: res.cookie! }) });
    expect(session?.user.id).toBe(user.id);
  });

  it("keeps no IP address or user agent on the session row", async () => {
    await signUp("misty");
    const session = row<{ ipAddress: string | null; userAgent: string | null }>(
      `SELECT ipAddress, userAgent FROM "session"`,
    );
    expect(session).toEqual({ ipAddress: null, userAgent: null });
  });

  it("refuses a taken username (also in another case) with USERNAME_IS_ALREADY_TAKEN", async () => {
    expect((await signUp("brock")).status).toBe(200);
    const again = await post("/sign-up/email", {
      email: syntheticEmail("brock"),
      password: "another pass",
      name: "Brock",
      username: "Brock",
    });
    expect(again.status).toBe(400);
    expect(again.json?.code).toBe("USERNAME_IS_ALREADY_TAKEN");
  });

  it("refuses a password sign-up with a real email or no username", async () => {
    const realEmail = await post("/sign-up/email", {
      email: "someone@example.com",
      password: "correct horse",
      name: "x",
      username: "someone",
    });
    expect(realEmail.status).toBe(400);
    expect(realEmail.json?.code).toBe("USERNAME_REQUIRED");
    const noUsername = await post("/sign-up/email", { email: syntheticEmail("x_y"), password: "correct horse", name: "x" });
    expect(noUsername.status).toBe(400);
    expect(row<{ n: number }>(`SELECT COUNT(*) AS n FROM "user"`).n).toBe(0);
  });

  it("refuses usernames outside the app's rule", async () => {
    expect((await signUp("ab")).status).toBe(400);
    expect((await signUp("dots.not.allowed")).status).toBe(400);
  });

  it("gives one answer for a wrong password and an unknown username", async () => {
    await signUp("gary");
    const wrong = await signIn("gary", "wrong password");
    const unknown = await signIn("nobody", "wrong password");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json?.code).toBe("INVALID_USERNAME_OR_PASSWORD");
    expect(unknown.json?.code).toBe(wrong.json?.code);
  });

  it("signs in with the right password", async () => {
    await signUp("oak");
    const res = await signIn("OAK");
    expect(res.status).toBe(200);
    expect(res.cookie).toBeDefined();
  });
});

describe("per-IP throttle (rate_limit_buckets)", () => {
  it("refuses the 11th sign-in from one IP in 10 minutes with RATE_LIMITED, and leaves other IPs alone", async () => {
    for (let i = 0; i < 10; i++) expect((await signIn("nobody", "wrong password", "198.51.100.1")).status).toBe(401);
    const blocked = await signIn("nobody", "wrong password", "198.51.100.1");
    expect(blocked.status).toBe(429);
    expect(blocked.json?.code).toBe("RATE_LIMITED");
    expect((await signIn("nobody", "wrong password", "198.51.100.2")).status).toBe(401);
  });

  it("refuses the 6th sign-up from one IP in 10 minutes", async () => {
    for (let i = 0; i < 5; i++) expect((await signUp(`trainer${i}`, "correct horse", "198.51.100.3")).status).toBe(200);
    const blocked = await signUp("trainer5", "correct horse", "198.51.100.3");
    expect(blocked.status).toBe(429);
    expect(blocked.json?.code).toBe("RATE_LIMITED");
    expect(row<{ n: number }>(`SELECT COUNT(*) AS n FROM "user"`).n).toBe(5);
  });

  it("also throttles the email sign-in door", async () => {
    for (let i = 0; i < 10; i++) await post("/sign-in/email", { email: "x@example.com", password: "wrong pass" }, { ip: "198.51.100.4" });
    const blocked = await post("/sign-in/email", { email: "x@example.com", password: "wrong pass" }, { ip: "198.51.100.4" });
    expect(blocked.status).toBe(429);
  });

  it("stores only a salted hash of the IP", async () => {
    await signIn("nobody", "wrong password", "198.51.100.9");
    const bucket = row<{ ip_hash: string }>(`SELECT ip_hash FROM rate_limit_buckets`);
    expect(bucket.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket.ip_hash).not.toContain("198.51.100.9");
  });
});

describe("a user copied from Supabase (bcrypt hash, fixed id, linked GitHub)", () => {
  const COPIED_ID = "11111111-2222-4333-8444-555555555555";
  const PASSWORD = "pikachu-forever";

  beforeEach(async () => {
    const now = new Date().toISOString();
    const hash = bcrypt.hashSync(PASSWORD, 4);
    expect(hash.startsWith("$2")).toBe(true);
    d1.sqlite
      .prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, username, displayUsername)
         VALUES (?, 'red', ?, 0, ?, ?, 'red', 'red')`,
      )
      .run(COPIED_ID, syntheticEmail("red"), now, now);
    d1.sqlite
      .prepare(
        `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
         VALUES ('acc-credential', ?, 'credential', ?, ?, ?, ?)`,
      )
      .run(COPIED_ID, COPIED_ID, hash, now, now);
    d1.sqlite
      .prepare(
        `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
         VALUES ('acc-github', '424242', 'github', ?, ?, ?)`,
      )
      .run(COPIED_ID, now, now);
    // A data row keyed by the copied id.
    await forUser(d1, COPIED_ID).insert("streak_days", { review_date: "2026-11-18" });
  });

  const storedHash = () =>
    row<{ password: string }>(`SELECT password FROM account WHERE providerId = 'credential'`).password;

  it("signs in with username and password as the SAME user id, so their data rows are theirs", async () => {
    const res = await signIn("red", PASSWORD);
    expect(res.status).toBe(200);
    const session = await auth.api.getSession({ headers: new Headers({ cookie: res.cookie! }) });
    expect(session?.user.id).toBe(COPIED_ID);
    expect(await forUser(d1, session!.user.id).count("streak_days")).toBe(1);
    // The GitHub link is untouched.
    expect(row<{ n: number }>(`SELECT COUNT(*) AS n FROM account WHERE providerId = 'github' AND userId = ?`, COPIED_ID).n).toBe(1);
  });

  it("replaces the bcrypt hash with scrypt after a successful sign-in, and the new hash works", async () => {
    expect((await signIn("red", PASSWORD)).status).toBe(200);
    const rehashed = storedHash();
    expect(rehashed.startsWith("$2")).toBe(false);
    expect((await signIn("red", PASSWORD)).status).toBe(200);
    expect(storedHash()).toBe(rehashed);
  });

  it("refuses a wrong password and leaves the bcrypt hash in place", async () => {
    const before = storedHash();
    expect((await signIn("red", "not-the-password")).status).toBe(401);
    expect(storedHash()).toBe(before);
  });
});

describe("OAuth", () => {
  it("starts a GitHub sign-in with a redirect to GitHub and the callback-complete page as callbackURL", async () => {
    const res = await post("/sign-in/social", { provider: "github", callbackURL: "/auth/callback-complete" });
    expect(res.status).toBe(200);
    const url = new URL(String(res.json?.url));
    expect(url.host).toBe("github.com");
    expect(url.searchParams.get("client_id")).toBe("test-github-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/github`);
  });

  it("does not store OAuth access, refresh or id tokens", async () => {
    const userId = "22222222-3333-4444-8555-666666666666";
    const now = new Date().toISOString();
    d1.sqlite
      .prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'g', 'g@example.com', 1, ?, ?)`)
      .run(userId, now, now);
    const ctx = await auth.$context;
    await ctx.internalAdapter.createAccount({
      userId,
      providerId: "google",
      accountId: "g-1",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      idToken: "id-secret",
    });
    const account = row<Record<string, unknown>>(
      `SELECT accessToken, refreshToken, idToken FROM account WHERE userId = ?`,
      userId,
    );
    expect(account).toEqual({ accessToken: null, refreshToken: null, idToken: null });
    const created = row<{ id: string }>(`SELECT id FROM account WHERE userId = ?`, userId);
    await ctx.internalAdapter.updateAccount(created.id, { accessToken: "new-access-secret" });
    expect(row<{ accessToken: unknown }>(`SELECT accessToken FROM account WHERE userId = ?`, userId).accessToken).toBeNull();
  });
});

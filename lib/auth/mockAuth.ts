/**
 * Test-only mock-auth seam (issue #751, Option 2 of #742).
 *
 * `e2e/` is otherwise guest-mode only. To exercise the signed-in render path
 * (avatar, sign-out button, signed-in nav, the conflict picker, the superuser
 * cloud-write-guard surfaces) in a real browser without a real OAuth handshake,
 * this module provides a hard-coded fake `User` plus a fake `SupabaseClient`
 * whose `.from()` calls resolve from an in-memory fixture instead of the
 * network.
 *
 * SECURITY-CRITICAL — this seam is an auth bypass if it ever leaks into a
 * production build. It is gated two ways and CANNOT activate in production:
 *
 *   1. `NEXT_PUBLIC_E2E_AUTH_MOCK` must be exactly `"1"`.
 *   2. `process.env.NODE_ENV` must NOT be `"production"`.
 *
 * Both conditions are checked by `isMockAuthEnabled()`. Production Vercel
 * builds run with `NODE_ENV === "production"`, so even if the flag were ever
 * set there the seam would stay inert. As defence-in-depth,
 * `assertMockAuthNotInProduction()` is invoked from `next.config.ts` and fails
 * the build loudly if both the flag and a production `NODE_ENV` are present at
 * build time. The flag is never set in any production Vercel environment — it
 * is set only by `e2e.yml`, only against preview deployments.
 *
 * See `lib/auth/mockAuth.test.ts` for the assertion proving the seam is
 * unreachable in production builds.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Public env var that opts a build into the mock-auth seam. */
export const MOCK_AUTH_ENV_VAR = "NEXT_PUBLIC_E2E_AUTH_MOCK";

/** The single value of {@link MOCK_AUTH_ENV_VAR} that enables the seam. */
export const MOCK_AUTH_ENABLED_VALUE = "1";

/**
 * Returns true only when the mock-auth seam should activate. The seam is
 * unreachable in production: `NODE_ENV === "production"` short-circuits to
 * false regardless of the flag.
 *
 * Both reads are static `process.env.*` member expressions so Next.js inlines
 * them at build time — a production bundle has this collapse to `false` and
 * the mock code becomes dead code the minifier can drop.
 */
export function isMockAuthEnabled(): boolean {
  // Production short-circuit FIRST — this is the security gate. Even if the
  // flag is somehow set, a production build can never enable the seam.
  if (process.env.NODE_ENV === "production") return false;
  return process.env[MOCK_AUTH_ENV_VAR] === MOCK_AUTH_ENABLED_VALUE;
}

/**
 * Build-time guard. Throws loudly when a production build is configured with
 * the mock-auth flag set — a misconfiguration that must never ship. Invoked
 * from `next.config.ts` so `next build` fails before producing an artefact.
 *
 * This is defence-in-depth: `isMockAuthEnabled()` already returns false in
 * production, so the seam is inert even without this guard. The guard exists
 * to turn a silent misconfiguration into a hard, visible build failure.
 */
export function assertMockAuthNotInProduction(): void {
  const flagSet = process.env[MOCK_AUTH_ENV_VAR] === MOCK_AUTH_ENABLED_VALUE;
  if (flagSet && process.env.NODE_ENV === "production") {
    throw new Error(
      `[mock-auth] SECURITY: ${MOCK_AUTH_ENV_VAR}=${MOCK_AUTH_ENABLED_VALUE} ` +
        "is set in a production build (NODE_ENV=production). The mock-auth " +
        "seam is a test-only auth bypass and must never be enabled in " +
        "production. Unset the flag, or build with a non-production " +
        "NODE_ENV. This guard lives in lib/auth/mockAuth.ts.",
    );
  }
}

/**
 * The hard-coded fake user the seam returns. The UUID is a fixed,
 * obviously-fake value so any cloud row it ever produced would be trivially
 * identifiable. The metadata mirrors what GitHub OAuth populates so the
 * `AuthButton` avatar and display-name code paths render normally.
 */
export const MOCK_USER: User = {
  id: "e2e00000-0000-4000-8000-000000000751",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e-trainer@poke-memory.test",
  app_metadata: { provider: "github", providers: ["github"] },
  user_metadata: {
    user_name: "e2e-trainer",
    full_name: "E2E Trainer",
    name: "E2E Trainer",
    avatar_url: "https://avatars.githubusercontent.com/u/0?v=4",
  },
  identities: [],
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};

/**
 * A row count + table fixture for the fake `.from()` query builder. The seam
 * deliberately resolves every cloud table to EMPTY: zero `card_reviews`, zero
 * `streak_days`, zero `grade_log`, and no `user_settings` row.
 *
 * Empty cloud is what the signed-in E2E spec needs:
 *  - With no cloud `card_reviews` rows, `hasCloudData` is false. Seeding any
 *    local session then drives the callback-complete page down its "local
 *    only" push branch, NOT the conflict picker. The conflict spec instead
 *    seeds a non-empty `card_reviews` fixture via `createMockClient({...})`.
 *  - The avatar / sign-out / signed-in-nav specs don't touch `.from()` at all.
 */
export type MockCloudFixture = {
  /** Rows returned for `from("card_reviews")` reads. */
  cardReviews: Record<string, unknown>[];
  /** Rows returned for `from("streak_days")` reads. */
  streakDays: Record<string, unknown>[];
  /** Rows returned for `from("grade_log")` reads. */
  gradeLog: Record<string, unknown>[];
  /** Single row returned for `from("user_settings")` reads, or null. */
  userSettings: Record<string, unknown> | null;
};

const EMPTY_FIXTURE: MockCloudFixture = {
  cardReviews: [],
  streakDays: [],
  gradeLog: [],
  userSettings: null,
};

/**
 * A minimal PostgREST-style query builder. Every chain method returns `this`
 * so the call chains in `lib/sync/*` (`.select().eq().range()` etc.) work, and
 * the object is thenable so `await client.from(...).select(...)` resolves.
 *
 * Reads resolve from the in-memory fixture. Writes (`upsert` / `update`)
 * resolve successfully without doing anything — the seam never persists.
 */
class MockQueryBuilder<Row extends Record<string, unknown>>
  implements PromiseLike<{ data: Row[] | Row | null; error: null; count: number }>
{
  private rows: Row[];
  private headOnly = false;

  constructor(rows: Row[]) {
    this.rows = rows;
  }

  select(_columns?: string, opts?: { head?: boolean; count?: string }): this {
    if (opts?.head) this.headOnly = true;
    return this;
  }
  eq(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  order(): this {
    return this;
  }
  range(): this {
    return this;
  }
  upsert(): this {
    // Writes are a no-op success. The mock never persists anything.
    this.rows = [];
    return this;
  }
  update(): this {
    this.rows = [];
    return this;
  }
  delete(): this {
    this.rows = [];
    return this;
  }

  /** Resolves to a single row (or null) — mirrors PostgREST `.maybeSingle()`. */
  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  single(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }

  then<TResult1 = { data: Row[] | Row | null; error: null; count: number }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | Row | null; error: null; count: number }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const value = {
      data: this.headOnly ? null : this.rows,
      error: null as null,
      count: this.rows.length,
    };
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}

/**
 * localStorage key an E2E spec can seed to override the cloud fixture for a
 * single test. Lets one preview deployment serve every signed-in scenario
 * (empty cloud for the avatar/nav specs, a non-empty `card_reviews` fixture
 * for the conflict-picker spec) without rebuilding. The value is a JSON
 * `Partial<MockCloudFixture>`. Absent / unparseable → empty cloud.
 */
export const MOCK_CLOUD_FIXTURE_STORAGE_KEY = "poke-memory:e2e:mock-cloud-fixture";

/** Reads the per-test cloud-fixture override from localStorage, if any. */
function readFixtureOverride(): Partial<MockCloudFixture> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MOCK_CLOUD_FIXTURE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Builds the fake `SupabaseClient` the seam injects into `AuthProvider`.
 *
 * `.auth.getUser()` resolves to {@link MOCK_USER}. `.auth.onAuthStateChange()`
 * returns an inert subscription. `.from(table)` returns a {@link MockQueryBuilder}
 * backed by the fixture for that table — no network call is ever made.
 *
 * The cloud fixture is, in priority order: the explicit `fixture` argument,
 * then a localStorage override (see {@link MOCK_CLOUD_FIXTURE_STORAGE_KEY}),
 * then an entirely empty cloud.
 *
 * @param fixture overrides for the in-memory cloud fixture.
 */
export function createMockClient(
  fixture: Partial<MockCloudFixture> = {},
): SupabaseClient {
  const data: MockCloudFixture = {
    ...EMPTY_FIXTURE,
    ...readFixtureOverride(),
    ...fixture,
  };

  const client = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: MOCK_USER }, error: null }),
      getSession: () =>
        Promise.resolve({ data: { session: { user: MOCK_USER } }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { id: "mock", callback: () => {}, unsubscribe: () => {} } },
      }),
      signOut: () => Promise.resolve({ error: null }),
      signInWithOAuth: () => Promise.resolve({ data: {}, error: null }),
    },
    from: (table: string) => {
      switch (table) {
        case "card_reviews":
          return new MockQueryBuilder(data.cardReviews);
        case "streak_days":
          return new MockQueryBuilder(data.streakDays);
        case "grade_log":
          return new MockQueryBuilder(data.gradeLog);
        case "user_settings":
          return new MockQueryBuilder(
            data.userSettings ? [data.userSettings] : [],
          );
        default:
          return new MockQueryBuilder([]);
      }
    },
    // `rpc` is used by reset_all_progress; resolve it as a harmless no-op.
    rpc: () => Promise.resolve({ data: null, error: null }),
  };

  // Cast via `unknown` to sidestep the deep generic signature of
  // SupabaseClient<Database, ...> — the same pattern the sync test suite uses
  // (FAKE_CLIENT = {} as unknown as SupabaseClient).
  return client as unknown as SupabaseClient;
}

/**
 * Tests for the test-only mock-auth seam (lib/auth/mockAuth.ts, issue #751).
 *
 * The headline tests here are the SECURITY assertions: they prove the seam is
 * unreachable in a production build. `isMockAuthEnabled()` must return false
 * whenever `NODE_ENV === "production"`, regardless of the flag, and
 * `assertMockAuthNotInProduction()` must throw when both are set together.
 *
 * Runs in the `node` vitest project - pure logic, no DOM.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isMockAuthEnabled,
  assertMockAuthNotInProduction,
  createMockClient,
  MOCK_USER,
  MOCK_AUTH_ENV_VAR,
  MOCK_AUTH_ENABLED_VALUE,
} from "@/lib/auth/mockAuth";

// `process.env.NODE_ENV` is read-only under some TS lib configs; cast through
// a mutable record so the tests can simulate each environment.
function setEnv(nodeEnv: string | undefined, flag: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  if (flag === undefined) delete env[MOCK_AUTH_ENV_VAR];
  else env[MOCK_AUTH_ENV_VAR] = flag;
}

describe("isMockAuthEnabled - production unreachability (SECURITY)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setEnv("test", undefined);
  });

  it("returns FALSE in a production build even when the flag is set", () => {
    // This is the core security guarantee: a leaked flag in production must
    // not enable the auth-bypass seam.
    setEnv("production", MOCK_AUTH_ENABLED_VALUE);
    expect(isMockAuthEnabled()).toBe(false);
  });

  it("returns false in production when the flag is unset", () => {
    setEnv("production", undefined);
    expect(isMockAuthEnabled()).toBe(false);
  });

  it("returns true only in a non-production build with the flag set", () => {
    setEnv("test", MOCK_AUTH_ENABLED_VALUE);
    expect(isMockAuthEnabled()).toBe(true);

    setEnv("development", MOCK_AUTH_ENABLED_VALUE);
    expect(isMockAuthEnabled()).toBe(true);
  });

  it("returns false in a non-production build when the flag is unset", () => {
    setEnv("development", undefined);
    expect(isMockAuthEnabled()).toBe(false);
  });

  it("requires the flag to be exactly \"1\" - other truthy values do not enable it", () => {
    for (const value of ["0", "true", "yes", "", "01", " 1"]) {
      setEnv("development", value);
      expect(isMockAuthEnabled()).toBe(false);
    }
  });
});

describe("assertMockAuthNotInProduction - build-time guard (SECURITY)", () => {
  afterEach(() => {
    setEnv("test", undefined);
  });

  it("throws loudly when a production build has the flag set", () => {
    setEnv("production", MOCK_AUTH_ENABLED_VALUE);
    expect(() => assertMockAuthNotInProduction()).toThrow(/SECURITY/);
    expect(() => assertMockAuthNotInProduction()).toThrow(MOCK_AUTH_ENV_VAR);
  });

  it("does not throw in a production build when the flag is unset", () => {
    setEnv("production", undefined);
    expect(() => assertMockAuthNotInProduction()).not.toThrow();
  });

  it("does not throw in a non-production build with the flag set", () => {
    setEnv("test", MOCK_AUTH_ENABLED_VALUE);
    expect(() => assertMockAuthNotInProduction()).not.toThrow();
  });

  it("does not throw in a non-production build with the flag unset", () => {
    setEnv("development", undefined);
    expect(() => assertMockAuthNotInProduction()).not.toThrow();
  });
});

describe("MOCK_USER", () => {
  it("is a hard-coded, obviously-fake authenticated user", () => {
    expect(MOCK_USER.id).toBe("e2e00000-0000-4000-8000-000000000751");
    expect(MOCK_USER.aud).toBe("authenticated");
    expect(MOCK_USER.email).toContain(".test");
    // The avatar + display-name metadata mirror GitHub OAuth so AuthButton
    // renders its signed-in branch normally.
    expect(MOCK_USER.user_metadata.avatar_url).toBeTruthy();
    expect(MOCK_USER.user_metadata.user_name).toBe("e2e-trainer");
  });
});

describe("createMockClient", () => {
  it("auth.getUser() resolves to the fake user", async () => {
    const client = createMockClient();
    const { data } = await client.auth.getUser();
    expect(data.user?.id).toBe(MOCK_USER.id);
  });

  it("auth.onAuthStateChange() returns an inert unsubscribable subscription", () => {
    const client = createMockClient();
    const { data } = client.auth.onAuthStateChange(() => {});
    expect(typeof data.subscription.unsubscribe).toBe("function");
    expect(() => data.subscription.unsubscribe()).not.toThrow();
  });

  it("from('card_reviews') resolves to an empty array by default (no cloud data)", async () => {
    const client = createMockClient();
    const { data, error, count } = await client
      .from("card_reviews")
      .select("card_type", { count: "exact", head: true })
      .eq("user_id", MOCK_USER.id)
      .limit(1);
    expect(error).toBeNull();
    expect(count).toBe(0);
    // head:true read returns null data - matches PostgREST head-select.
    expect(data).toBeNull();
  });

  it("from('card_reviews') resolves to the supplied fixture rows", async () => {
    const client = createMockClient({
      cardReviews: [{ card_type: "name", subject_key: "1" }],
    });
    const { count } = await client
      .from("card_reviews")
      .select("card_type", { count: "exact", head: true })
      .eq("user_id", MOCK_USER.id);
    expect(count).toBe(1);

    const { data } = await client
      .from("card_reviews")
      .select("*")
      .eq("user_id", MOCK_USER.id)
      .range(0, 999);
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBe(1);
  });

  it("from('user_settings').maybeSingle() resolves to null by default", async () => {
    const client = createMockClient();
    const { data, error } = await client
      .from("user_settings")
      .select("settings, updated_at, last_reset_at")
      .eq("user_id", MOCK_USER.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("upsert / update resolve successfully without persisting (writes are no-ops)", async () => {
    const client = createMockClient({
      cardReviews: [{ card_type: "name", subject_key: "1" }],
    });
    const upsertResult = await client.from("card_reviews").upsert([{}]);
    expect(upsertResult.error).toBeNull();
    const updateResult = await client
      .from("user_settings")
      .update({ timezone: "UTC" })
      .eq("user_id", MOCK_USER.id);
    expect(updateResult.error).toBeNull();
  });
});

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
import { createSqliteD1, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { syntheticEmail } from "./username";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

import { requireAuth } from "./requireAuth";
import { createAuth } from "./server";

const BASE = "http://localhost:3000";
let d1: SqliteD1;
let env: Record<string, unknown>;

beforeEach(() => {
  d1 = createSqliteD1();
  env = { DB: d1, BETTER_AUTH_URL: BASE, BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123" };
  getCloudflareContext.mockResolvedValue({ env });
});
afterEach(() => {
  d1.close();
  getCloudflareContext.mockReset();
});

/** Signs up a username account in-process and returns its session cookie and id. */
async function signedIn(): Promise<{ cookie: string; userId: string }> {
  const auth = createAuth(env as never);
  const res = await auth.handler(
    new Request(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email: syntheticEmail("dawn"), password: "correct horse", name: "dawn", username: "dawn" }),
    }),
  );
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="))!.split(";")[0];
  return { cookie, userId: body.user.id };
}

const request = (cookie?: string) =>
  new Request(`${BASE}/api/export`, { headers: cookie ? { cookie } : {} });

describe("requireAuth", () => {
  it("returns { user } when the request carries a valid session cookie", async () => {
    const { cookie, userId } = await signedIn();

    const result = await requireAuth(request(cookie));

    expect(result).not.toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) throw new Error("unreachable");
    expect(result.user).toEqual({ id: userId });
  });

  it("returns 401 { error } when there is no session", async () => {
    const result = await requireAuth(request());

    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for a forged cookie", async () => {
    const result = await requireAuth(request("better-auth.session_token=forged.value"));

    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(401);
  });

  it("returns 401 when the session lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getCloudflareContext.mockResolvedValue({ env: {} });

    const result = await requireAuth(request());

    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(401);
  });

  it("includes ok: false in the error body when withOkField is set", async () => {
    const result = await requireAuth(request(), { withOkField: true });

    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ ok: false, error: "unauthorized" });
  });
});

/** The Better Auth catch-all route (app/api/auth/[...all]/route.ts); kept here for the node test project, which has node:sqlite. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, type SqliteD1 } from "@/lib/db/testing/sqliteD1";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

import { GET, POST } from "@/app/api/auth/[...all]/route";

const BASE = "http://localhost:3000";
let d1: SqliteD1;

beforeEach(() => {
  d1 = createSqliteD1();
  getCloudflareContext.mockResolvedValue({
    env: {
      DB: d1,
      BETTER_AUTH_URL: BASE,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
      GOOGLE_CLIENT_ID: "test-google-client",
      GOOGLE_CLIENT_SECRET: "test-google-secret",
    },
  });
});
afterEach(() => d1.close());

describe("/api/auth/[...all]", () => {
  it("GET get-session answers null without a session", async () => {
    const res = await GET(new Request(`${BASE}/api/auth/get-session`));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("POST sign-in/social returns the Google authorisation URL", async () => {
    const res = await POST(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ provider: "google", callbackURL: "/auth/callback-complete" }),
      }),
    );
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).host).toBe("accounts.google.com");
  });
});

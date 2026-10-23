import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { supabasePublishableKey, supabaseSecretKey } from "./keys";

const NAMES = [
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
});

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("supabaseSecretKey (#2162)", () => {
  it("prefers the new secret key", () => {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_new";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy-jwt";
    expect(supabaseSecretKey()).toBe("sb_secret_new");
  });

  it("falls back to the legacy service_role key", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy-jwt";
    expect(supabaseSecretKey()).toBe("legacy-jwt");
  });

  it("treats an empty new key as unset", () => {
    process.env.SUPABASE_SECRET_KEY = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy-jwt";
    expect(supabaseSecretKey()).toBe("legacy-jwt");
  });

  it("is undefined when neither is set", () => {
    expect(supabaseSecretKey()).toBeUndefined();
  });
});

describe("supabasePublishableKey (#2162)", () => {
  it("prefers the new publishable key", () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_new";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon";
    expect(supabasePublishableKey()).toBe("sb_publishable_new");
  });

  it("falls back to the legacy anon key", () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon";
    expect(supabasePublishableKey()).toBe("legacy-anon");
  });

  it("is undefined when neither is set", () => {
    expect(supabasePublishableKey()).toBeUndefined();
  });
});

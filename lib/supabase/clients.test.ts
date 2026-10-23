import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The browser and server Supabase clients must read the anon-level key through
// supabasePublishableKey(), so the new publishable key wins and the legacy anon
// key still works as a fallback (#2162). All values here are fakes.

const { mockCreateBrowserClient, mockCreateServerClient } = vi.hoisted(() => ({
  mockCreateBrowserClient: vi.fn(() => ({ kind: "browser" })),
  mockCreateServerClient: vi.fn(() => ({ kind: "server" })),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mockCreateBrowserClient,
  createServerClient: mockCreateServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import { createClient as createBrowserSupabaseClient } from "./client";
import { createClient as createServerSupabaseClient } from "./server";

const FAKE_URL = "http://localhost:54321";
const NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
  process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
  mockCreateBrowserClient.mockClear();
  mockCreateServerClient.mockClear();
});

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("browser client key (#2162)", () => {
  it("uses the new publishable key when both keys are set", () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "fake-publishable";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-legacy-anon";
    createBrowserSupabaseClient();
    expect(mockCreateBrowserClient).toHaveBeenCalledWith(FAKE_URL, "fake-publishable");
  });

  it("falls back to the legacy anon key when the new key is unset", () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-legacy-anon";
    createBrowserSupabaseClient();
    expect(mockCreateBrowserClient).toHaveBeenCalledWith(FAKE_URL, "fake-legacy-anon");
  });

  it("throws when neither key is set", () => {
    expect(() => createBrowserSupabaseClient()).toThrow("Supabase env vars not configured");
    expect(mockCreateBrowserClient).not.toHaveBeenCalled();
  });
});

describe("server client key (#2162)", () => {
  it("uses the new publishable key when both keys are set", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "fake-publishable";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-legacy-anon";
    await createServerSupabaseClient();
    expect(mockCreateServerClient).toHaveBeenCalledWith(FAKE_URL, "fake-publishable", expect.any(Object));
  });

  it("falls back to the legacy anon key when the new key is unset", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-legacy-anon";
    await createServerSupabaseClient();
    expect(mockCreateServerClient).toHaveBeenCalledWith(FAKE_URL, "fake-legacy-anon", expect.any(Object));
  });
});

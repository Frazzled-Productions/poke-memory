import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "./requireAuth";

function fakeSupabase(result: {
  user: { id: string } | null;
  error: { message: string } | null;
}): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({
        data: { user: result.user },
        error: result.error,
      }),
    },
  } as unknown as SupabaseClient;
}

describe("requireAuth", () => {
  it("returns { user } when a valid session exists", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, error: null });

    const result = await requireAuth(supabase);

    expect(result).not.toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) throw new Error("unreachable");
    expect(result.user.id).toBe("user-1");
  });

  it("returns 401 { error } when getUser reports an error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      error: { message: "expired" },
    });

    const result = await requireAuth(supabase);

    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when no user is present", async () => {
    const supabase = fakeSupabase({ user: null, error: null });

    const result = await requireAuth(supabase);

    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(401);
  });

  it("includes ok: false in the error body when withOkField is set", async () => {
    const supabase = fakeSupabase({ user: null, error: null });

    const result = await requireAuth(supabase, { withOkField: true });

    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ ok: false, error: "unauthorized" });
  });
});

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Shared `getUser()` + 401 guard for authenticated API routes.
 *
 * Returns `{ user }` when a valid session exists, otherwise a ready-made
 * 401 `NextResponse`. Callers discriminate with `instanceof`:
 *
 * ```ts
 * const auth = await requireAuth(supabase);
 * if (auth instanceof NextResponse) return auth;
 * const { user } = auth;
 * ```
 *
 * Two error-body shapes exist among the callers: routes with an `ok`
 * envelope (`/api/sync`, `/api/push/resubscribe`) return
 * `{ ok: false, error: "unauthorized" }`; the rest (`/api/export`,
 * `/api/srs/optimize`) return `{ error: "unauthorized" }`. Pass
 * `withOkField: true` for the former.
 */
export async function requireAuth(
  supabase: SupabaseClient,
  options: { withOkField?: boolean } = {},
): Promise<{ user: User } | NextResponse> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    const body = options.withOkField
      ? { ok: false, error: "unauthorized" }
      : { error: "unauthorized" };
    return NextResponse.json(body, { status: 401 });
  }

  return { user };
}

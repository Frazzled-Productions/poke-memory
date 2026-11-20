import { NextResponse } from "next/server";
import { getAuth } from "./server";

/**
 * Shared session check + 401 guard for authenticated API routes.
 *
 * Reads the Better Auth session from the request's cookies (design D6).
 * Returns `{ user }` when a valid session exists, otherwise a ready-made
 * 401 `NextResponse`. Callers discriminate with `instanceof`:
 *
 * ```ts
 * const auth = await requireAuth(request);
 * if (auth instanceof NextResponse) return auth;
 * const { user } = auth;
 * ```
 *
 * Two error-body shapes exist among the callers: routes with an `ok`
 * envelope (`/api/sync`, `/api/push/resubscribe`) return
 * `{ ok: false, error: "unauthorized" }`; the rest (`/api/export`) return
 * `{ error: "unauthorized" }`. Pass
 * `withOkField: true` for the former.
 */
export async function requireAuth(
  request: Request,
  options: { withOkField?: boolean } = {},
): Promise<{ user: { id: string } } | NextResponse> {
  let userId: string | undefined;
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    userId = session?.user.id;
  } catch (err) {
    // As before, a failed session lookup is answered as unauthorised.
    console.error("[requireAuth] session lookup failed", err instanceof Error ? err.message : err);
  }

  if (!userId) {
    const body = options.withOkField
      ? { ok: false, error: "unauthorized" }
      : { error: "unauthorized" };
    return NextResponse.json(body, { status: 401 });
  }

  return { user: { id: userId } };
}

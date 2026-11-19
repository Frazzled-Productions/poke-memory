/**
 * The session check for POST /api/db, in the call shape the Better Auth change
 * gives lib/auth/requireAuth.ts: `requireAuth(request)` returning
 * `{ user: { id } }` or a 401 response. Until that change merges, this adapter
 * reads the session the current way; on merge the route imports requireAuth
 * from "@/lib/auth/requireAuth" and this file goes.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth as requireSupabaseAuth } from "@/lib/auth/requireAuth";

// The request is unused until Better Auth, which reads the session from it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function requireAuth(_request: Request): Promise<{ user: { id: string } } | NextResponse> {
  try {
    const auth = await requireSupabaseAuth(await createClient());
    if (auth instanceof NextResponse) return auth;
    return { user: { id: auth.user.id } };
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

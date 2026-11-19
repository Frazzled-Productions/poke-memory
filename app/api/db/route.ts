/**
 * POST /api/db: the data gateway for the browser's data client (design D5).
 * Validation and execution live in lib/db/gateway.ts (wire format there);
 * this handler adds the request checks:
 *
 *   - same origin only: the Origin header must equal this request's origin
 *     (a cross-site page cannot drive the session cookie here);
 *   - a session (401 otherwise); the user id comes only from the session;
 *   - a body of at most MAX_BODY_BYTES that is JSON;
 *   - no caching of any answer.
 *
 * After delete_account the Discord posts of the account's bug reports are
 * deleted once the response is sent (ctx.waitUntil).
 */
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db/env";
import { handleGatewayRequest, MAX_BODY_BYTES, type GatewayResponseBody } from "@/lib/db/gateway";
import { requireAuth } from "./session";
import { deleteDiscordPosts } from "./discordDeletes";

const NO_STORE = { "Cache-Control": "no-store" };

function answer(body: GatewayResponseBody, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function refused(status: number, code: string, message: string): NextResponse {
  return answer({ data: null, error: { code, message, details: null, hint: null } }, status);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** The body as text, or null when it is larger than MAX_BODY_BYTES. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOrigin(request)) return refused(403, "42501", "cross-origin request refused");

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return refused(401, "PGRST301", "not signed in");

  const text = await readBody(request);
  if (text === null) return refused(413, "54000", "request body too large");
  let query: unknown;
  try {
    query = JSON.parse(text);
  } catch {
    return refused(400, "42601", "request body is not JSON");
  }

  const result = await handleGatewayRequest(await getDb(), auth.user.id, query);

  if (result.discordPostsToDelete && result.discordPostsToDelete.length > 0) {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(deleteDiscordPosts(result.discordPostsToDelete));
  }
  return answer(result.body, result.status);
}

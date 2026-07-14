import { NextResponse } from "next/server";

/**
 * Shared JSON-body parse guard for API routes.
 *
 * Returns `{ ok: true, data }` on success, otherwise a ready-made
 * `400 { ok: false, error: "invalid_json" }` response (the shape every
 * caller used before extraction). Callers discriminate with `instanceof`:
 *
 * ```ts
 * const parsed = await parseJsonBody<MyBody>(request);
 * if (parsed instanceof NextResponse) return parsed;
 * const body = parsed.data;
 * ```
 *
 * Note: like the inline `(await request.json()) as T` it replaces, this is
 * a cast, not validation - callers still validate the parsed shape.
 */
export async function parseJsonBody<T>(
  request: Request,
): Promise<{ ok: true; data: T } | NextResponse> {
  try {
    return { ok: true, data: (await request.json()) as T };
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
}

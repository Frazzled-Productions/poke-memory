// POST /api/event: counts one `app_open` per UTC day and bucket (logic in lib/analytics/events.ts).
// Other methods get Next's own 405, since only POST is exported.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { handleEvent, type EventEnv } from "@/lib/analytics/events";

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  return handleEvent(request, env as unknown as EventEnv);
}
// Preview proof for ops #612: throwaway branch, closed unmerged.

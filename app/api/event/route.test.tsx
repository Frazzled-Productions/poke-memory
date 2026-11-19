/**
 * POST /api/event hands the request and the Worker's bindings to handleEvent
 * (behaviour tested in lib/analytics/events.test.ts).
 */
import { describe, it, expect, vi } from "vitest";

const { mockGetCloudflareContext, mockHandleEvent } = vi.hoisted(() => ({
  mockGetCloudflareContext: vi.fn(),
  mockHandleEvent: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: mockGetCloudflareContext }));
vi.mock("@/lib/analytics/events", () => ({ handleEvent: mockHandleEvent }));

import { POST } from "./route";

describe("POST /api/event", () => {
  it("passes the request and the Cloudflare env to handleEvent", async () => {
    const env = { DB: {}, EVENT_LIMITER: {} };
    mockGetCloudflareContext.mockResolvedValue({ env });
    mockHandleEvent.mockResolvedValue(new Response(null, { status: 204 }));
    const request = new Request("https://pokememory.com/api/event", { method: "POST" });

    const res = await POST(request);

    expect(mockGetCloudflareContext).toHaveBeenCalledWith({ async: true });
    expect(mockHandleEvent).toHaveBeenCalledWith(request, env);
    expect(res.status).toBe(204);
  });
});

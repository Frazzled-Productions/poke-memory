import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetAllProgress } from "./reset";

function makeRpcClient(rpcError: null | object = null) {
  const rpcSpy = vi.fn().mockResolvedValue({ error: rpcError, data: null });
  const client = {
    rpc: rpcSpy,
  };
  return client as unknown as import("@supabase/supabase-js").SupabaseClient & {
    rpc: ReturnType<typeof vi.fn>;
  };
}

describe("resetAllProgress", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the reset_all_progress RPC", async () => {
    const client = makeRpcClient();
    await resetAllProgress(client);
    expect(client.rpc).toHaveBeenCalledWith("reset_all_progress");
  });

  it("returns true when the RPC succeeds", async () => {
    const client = makeRpcClient();
    const result = await resetAllProgress(client);
    expect(result).toBe(true);
  });

  it("returns false when the RPC returns an error", async () => {
    const client = makeRpcClient({ message: "insufficient_privilege" });
    const result = await resetAllProgress(client);
    expect(result).toBe(false);
  });

  it("logs an error when the RPC returns an error", async () => {
    const client = makeRpcClient({ message: "insufficient_privilege" });
    await resetAllProgress(client);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("reset_all_progress"),
      expect.any(Object),
    );
  });

  it("returns false and logs when the RPC throws", async () => {
    const client = {
      rpc: vi.fn().mockRejectedValue(new Error("network error")),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    const result = await resetAllProgress(client);
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("reset_all_progress"),
      expect.any(Error),
    );
  });
});

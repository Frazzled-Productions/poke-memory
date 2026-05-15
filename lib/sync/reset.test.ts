import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetAllProgress, resetAllProgressEverywhere } from "./reset";
import { clearLocalProgress } from "@/lib/storage/reset";

vi.mock("@/lib/storage/reset", () => ({
  clearLocalProgress: vi.fn(async () => {}),
}));

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
    } as unknown as import("@supabase/supabase-js").SupabaseClient & {
      rpc: ReturnType<typeof vi.fn>;
    };
    const result = await resetAllProgress(client);
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("reset_all_progress"),
      expect.any(Error),
    );
  });
});

describe("resetAllProgress — cooldown error path", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when the RPC returns the cooldown SQLSTATE P0001", async () => {
    // PostgreSQL RAISE EXCEPTION ... USING ERRCODE = 'P0001' surfaces through
    // Supabase/PostgREST as a PostgrestError with code 'P0001'. The function
    // must surface this as a failure without throwing.
    const cooldownError = {
      code: "P0001",
      message: "reset_all_progress: cooldown active, retry shortly",
      details: null,
      hint: null,
    };
    const client = makeRpcClient(cooldownError);
    const result = await resetAllProgress(client);
    expect(result).toBe(false);
  });

  it("logs the cooldown error to console.error", async () => {
    const cooldownError = {
      code: "P0001",
      message: "reset_all_progress: cooldown active, retry shortly",
      details: null,
      hint: null,
    };
    const client = makeRpcClient(cooldownError);
    await resetAllProgress(client);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("reset_all_progress"),
      expect.objectContaining({ code: "P0001" }),
    );
  });

  it("resetAllProgressEverywhere returns cloud-reset-failed on cooldown", async () => {
    // When the cooldown fires the cloud reset fails; local progress must NOT
    // be cleared (otherwise the user loses local state without a successful
    // cloud wipe).
    const cooldownError = {
      code: "P0001",
      message: "reset_all_progress: cooldown active, retry shortly",
      details: null,
      hint: null,
    };
    const client = makeRpcClient(cooldownError);
    const result = await resetAllProgressEverywhere(client);
    expect(result).toEqual({ ok: false, reason: "cloud-reset-failed" });
    expect(clearLocalProgress).not.toHaveBeenCalled();
  });
});

describe("resetAllProgressEverywhere", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(clearLocalProgress).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wipes cloud first, then local, on the happy path", async () => {
    const calls: string[] = [];
    vi.mocked(clearLocalProgress).mockImplementation(async () => {
      calls.push("local");
    });
    const client = {
      rpc: vi.fn().mockImplementation(async () => {
        calls.push("cloud");
        return { error: null, data: null };
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const result = await resetAllProgressEverywhere(client);

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["cloud", "local"]);
  });

  it("does not clear local when the cloud reset fails", async () => {
    const client = makeRpcClient({ message: "boom" });
    const result = await resetAllProgressEverywhere(client);
    expect(result).toEqual({ ok: false, reason: "cloud-reset-failed" });
    expect(clearLocalProgress).not.toHaveBeenCalled();
  });
});

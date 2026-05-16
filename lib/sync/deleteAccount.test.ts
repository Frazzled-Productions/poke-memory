import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deleteAccount, deleteAccountEverywhere } from "./deleteAccount";
import { clearLocalProgress } from "@/lib/storage/reset";

// Note: the tests that exercise the localStorage settings-key sweep inside
// deleteAccountEverywhere live in components/settings/deleteAccount-local.test.tsx
// — they need a DOM (jsdom), and lib/ tests run in the DOM-free `node` project.

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

describe("deleteAccount", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the delete_account RPC", async () => {
    const client = makeRpcClient();
    await deleteAccount(client);
    expect(client.rpc).toHaveBeenCalledWith("delete_account");
  });

  it("returns true when the RPC succeeds", async () => {
    const client = makeRpcClient();
    expect(await deleteAccount(client)).toBe(true);
  });

  it("returns false when the RPC returns an error", async () => {
    const client = makeRpcClient({ message: "insufficient_privilege" });
    expect(await deleteAccount(client)).toBe(false);
  });

  it("logs an error when the RPC returns an error", async () => {
    const client = makeRpcClient({ message: "insufficient_privilege" });
    await deleteAccount(client);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("delete_account"),
      expect.any(Object),
    );
  });

  it("returns false and logs when the RPC throws", async () => {
    const client = {
      rpc: vi.fn().mockRejectedValue(new Error("network error")),
    } as unknown as import("@supabase/supabase-js").SupabaseClient & {
      rpc: ReturnType<typeof vi.fn>;
    };
    expect(await deleteAccount(client)).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("delete_account"),
      expect.any(Error),
    );
  });
});

describe("deleteAccountEverywhere", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(clearLocalProgress).mockClear();
    vi.mocked(clearLocalProgress).mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes cloud first, then clears local, on the happy path", async () => {
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

    const result = await deleteAccountEverywhere(client);

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["cloud", "local"]);
  });

  it("does not clear local when the cloud delete fails", async () => {
    const client = makeRpcClient({ message: "boom" });
    const result = await deleteAccountEverywhere(client);
    expect(result).toEqual({ ok: false, reason: "cloud-delete-failed" });
    expect(clearLocalProgress).not.toHaveBeenCalled();
  });
});

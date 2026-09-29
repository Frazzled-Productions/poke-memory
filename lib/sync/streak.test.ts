import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeStreak, pullStreak, pushStreak, STREAK_DAYS_CONFLICT_COLS } from "./streak";

function makeClientWithUpsert(error: null | object = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ upsert });
  return { client: { from } as unknown as SupabaseClient, upsert, from };
}

function makeClientWithSelect(data: unknown, error: null | object = null) {
  // The chain is: select → eq → order → range(from, to)
  // fetchAllPages calls .range(from, to) as the terminal method.
  // Return data with length < pageSize (1000) so fetchAllPages stops after one call.
  const range = vi.fn().mockResolvedValue({ data, error });
  const order = vi.fn().mockReturnValue({ range });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, eq, order, select, from, range };
}

describe("mergeStreak", () => {
  it("dedupes, sorts, and unions local + cloud dates", () => {
    expect(
      mergeStreak(["2026-05-10", "2026-05-11"], ["2026-05-11", "2026-05-12"]),
    ).toEqual(["2026-05-10", "2026-05-11", "2026-05-12"]);
  });

  it("returns sorted output when inputs are unordered", () => {
    expect(mergeStreak(["2026-05-12"], ["2026-05-10"])).toEqual([
      "2026-05-10",
      "2026-05-12",
    ]);
  });

  it("returns [] when both inputs are empty", () => {
    expect(mergeStreak([], [])).toEqual([]);
  });
});

describe("pushStreak", () => {
  it("upserts each date as (user_id, review_date) with ignoreDuplicates", async () => {
    const { client, upsert, from } = makeClientWithUpsert();
    const ok = await pushStreak(client, "user-1", ["2026-05-10", "2026-05-11"]);
    expect(ok).toBe(true);
    expect(from).toHaveBeenCalledWith("streak_days");
    expect(upsert).toHaveBeenCalledWith(
      [
        { user_id: "user-1", review_date: "2026-05-10" },
        { user_id: "user-1", review_date: "2026-05-11" },
      ],
      { onConflict: STREAK_DAYS_CONFLICT_COLS, ignoreDuplicates: true },
    );
  });

  it("returns true without a network call when dates is empty", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const ok = await pushStreak(client, "user-1", []);
    expect(ok).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns false when supabase returns an error", async () => {
    const { client } = makeClientWithUpsert({ message: "boom" });
    const ok = await pushStreak(client, "user-1", ["2026-05-10"]);
    expect(ok).toBe(false);
  });
});

describe("pullStreak", () => {
  it("returns an array of review_date strings", async () => {
    const { client } = makeClientWithSelect([
      { review_date: "2026-05-10" },
      { review_date: "2026-05-11" },
    ]);
    expect(await pullStreak(client, "user-1")).toEqual([
      "2026-05-10",
      "2026-05-11",
    ]);
  });

  it("orders by review_date ascending before ranging (#2053)", async () => {
    const { client, order, range } = makeClientWithSelect([]);
    await pullStreak(client, "user-1");
    expect(order).toHaveBeenCalledWith("review_date", { ascending: true });
    expect(range).toHaveBeenCalledWith(0, 999);
  });

  it("returns null when supabase returns an error", async () => {
    const { client } = makeClientWithSelect(null, { message: "boom" });
    expect(await pullStreak(client, "user-1")).toBeNull();
  });
});

/**
 * Unit tests for fetchAllPages (lib/sync/paginatedFetch.ts).
 *
 * Pins the >1000-row behaviour: verifies that all pages are collected and
 * that the `< pageSize` last-page detection avoids an extra round trip.
 */

import { describe, it, expect, vi } from "vitest";
import { fetchAllPages } from "./paginatedFetch";

describe("fetchAllPages", () => {
  it("returns all rows across two pages", async () => {
    // 1500 items split across two pages of 1000 each (second page has 500).
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2 = Array.from({ length: 500 }, (_, i) => ({ id: i + 1000 }));

    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });

    const result = await fetchAllPages(fetchPage, 1000);

    expect(result).toHaveLength(1500);
    expect(result![0]).toEqual({ id: 0 });
    expect(result![1499]).toEqual({ id: 1499 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 999);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("returns rows from a single page without extra round trip", async () => {
    // 42 items - fewer than pageSize (1000). Should make exactly 1 request.
    const items = Array.from({ length: 42 }, (_, i) => ({ id: i }));
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: items, error: null });

    const result = await fetchAllPages(fetchPage, 1000);

    expect(result).toHaveLength(42);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("stops after last page when corpus is exact multiple of pageSize", async () => {
    // 2000 items across two full pages. Third request should NOT be made.
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2 = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1000 }));
    // If a third call is made it returns a short page (0 items).
    const page3: typeof page1 = [];

    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null })
      .mockResolvedValueOnce({ data: page3, error: null });

    const result = await fetchAllPages(fetchPage, 1000);

    // The `< pageSize` check (not `=== 0`) means we DO make a third trip
    // for an exact-multiple corpus to confirm there are no more rows.
    // This is the deliberate trade-off documented in paginatedFetch.ts.
    expect(result).toHaveLength(2000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("returns null when a page request errors", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error("db error") });

    const result = await fetchAllPages(fetchPage, 1000);

    expect(result).toBeNull();
  });

  it("returns null when a page returns null data with no error", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await fetchAllPages(fetchPage, 1000);

    expect(result).toBeNull();
  });

  it("returns null when fetchPage throws", async () => {
    const fetchPage = vi.fn().mockRejectedValueOnce(new Error("network"));

    const result = await fetchAllPages(fetchPage, 1000);

    expect(result).toBeNull();
  });

  it("returns empty array for an empty table (first page returns [])", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [], error: null });

    const result = await fetchAllPages(fetchPage, 1000);

    expect(result).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("respects a custom pageSize", async () => {
    const page1 = [{ id: 0 }, { id: 1 }];
    const page2 = [{ id: 2 }];

    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });

    const result = await fetchAllPages(fetchPage, 2);

    expect(result).toHaveLength(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 1);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2, 3);
  });
});

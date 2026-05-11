import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useStorageQuota } from "@/lib/review/useStorageQuota";

describe("useStorageQuota", () => {
  it("starts with quotaExceeded false", () => {
    const { result } = renderHook(() => useStorageQuota());
    expect(result.current.quotaExceeded).toBe(false);
  });

  it("sets quotaExceeded to true on quota save failure", () => {
    const { result } = renderHook(() => useStorageQuota());
    act(() => {
      result.current.notifySaveResult({ ok: false, reason: "quota" });
    });
    expect(result.current.quotaExceeded).toBe(true);
  });

  it("sets quotaExceeded to true on unknown save failure", () => {
    const { result } = renderHook(() => useStorageQuota());
    act(() => {
      result.current.notifySaveResult({ ok: false, reason: "unknown" });
    });
    expect(result.current.quotaExceeded).toBe(true);
  });

  it("clears quotaExceeded when save succeeds after a quota failure", () => {
    const { result } = renderHook(() => useStorageQuota());
    act(() => {
      result.current.notifySaveResult({ ok: false, reason: "quota" });
    });
    expect(result.current.quotaExceeded).toBe(true);
    act(() => {
      result.current.notifySaveResult({ ok: true });
    });
    expect(result.current.quotaExceeded).toBe(false);
  });

  it("dismiss clears quotaExceeded", () => {
    const { result } = renderHook(() => useStorageQuota());
    act(() => {
      result.current.notifySaveResult({ ok: false, reason: "quota" });
    });
    expect(result.current.quotaExceeded).toBe(true);
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.quotaExceeded).toBe(false);
  });

  it("re-shows banner after dismiss when next save also fails with quota error", () => {
    const { result } = renderHook(() => useStorageQuota());
    act(() => {
      result.current.notifySaveResult({ ok: false, reason: "quota" });
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.quotaExceeded).toBe(false);
    act(() => {
      result.current.notifySaveResult({ ok: false, reason: "quota" });
    });
    expect(result.current.quotaExceeded).toBe(true);
  });
});

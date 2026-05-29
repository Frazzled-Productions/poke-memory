/**
 * jsdom tests for useLabsFlag (#1258).
 *
 * The hook lives in lib/ but its tests must live under components/ so the
 * jsdom vitest project picks them up (AGENTS.md "Testing — Unit / component
 * tests"). lib/ tests run in the `node` project which has no DOM, and
 * renderHook requires jsdom.
 *
 * Because LabsFlagKey is `never` while the LABS_FLAGS registry is empty
 * (infrastructure-only ship), we cast the key argument via `as LabsFlagKey`
 * throughout — the same pattern used in lib/labs/flags.test.ts.
 *
 * Covers:
 *   - Returns false on initial render when settings have no labsFlags blob.
 *   - Returns true when the settings blob has the flag explicitly set to true.
 *   - Returns the registry default when the flag key is absent from the blob.
 *   - Re-reads and re-renders when a `storage` event fires.
 *   - Removes the storage listener on unmount (no stale updates).
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LabsFlagKey } from "@/lib/labs/flags";

// ---------------------------------------------------------------------------
// Module mock: loadSettings from lib/settings/persistence
// ---------------------------------------------------------------------------

const mockLoadSettings = vi.fn();

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
}));

// ---------------------------------------------------------------------------
// Import the hook AFTER the mock is registered.
// ---------------------------------------------------------------------------

import { useLabsFlag } from "@/lib/labs/useLabsFlag";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal UserSettings stub — only labsFlags matters to this hook. */
function settingsWithFlags(labsFlags: Record<string, boolean> | undefined) {
  return { labsFlags } as ReturnType<typeof mockLoadSettings>;
}

/**
 * Fire a synthetic storage event on window to simulate a cross-tab write or
 * a saveSettings dispatch (which also fires a storage event).
 */
function fireStorageEvent() {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage"));
  });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLoadSettings.mockReset();
});

// ---------------------------------------------------------------------------

describe("useLabsFlag (#1258)", () => {
  it("returns false when there is no labsFlags blob in settings", () => {
    mockLoadSettings.mockReturnValue(settingsWithFlags(undefined));

    const { result } = renderHook(() =>
      useLabsFlag("nonexistent" as LabsFlagKey),
    );

    expect(result.current).toBe(false);
  });

  it("returns false when the flag is explicitly false in the settings blob", () => {
    mockLoadSettings.mockReturnValue(
      settingsWithFlags({ someFeature: false }),
    );

    const { result } = renderHook(() =>
      useLabsFlag("someFeature" as LabsFlagKey),
    );

    expect(result.current).toBe(false);
  });

  it("returns true when the flag is explicitly true in the settings blob", () => {
    mockLoadSettings.mockReturnValue(
      settingsWithFlags({ someFeature: true }),
    );

    const { result } = renderHook(() =>
      useLabsFlag("someFeature" as LabsFlagKey),
    );

    expect(result.current).toBe(true);
  });

  it("returns false (registry default) when the key is absent from the blob", () => {
    // The blob exists but does not contain the requested key.
    mockLoadSettings.mockReturnValue(settingsWithFlags({ otherFlag: true }));

    const { result } = renderHook(() =>
      useLabsFlag("someFeature" as LabsFlagKey),
    );

    // Registry is empty → DEFAULT_LABS_FLAGS has no entry → falls back to false.
    expect(result.current).toBe(false);
  });

  it("re-reads settings and updates when a storage event fires (false → true)", () => {
    // Initial state: flag is off.
    mockLoadSettings.mockReturnValue(
      settingsWithFlags({ liveFlag: false }),
    );

    const { result } = renderHook(() =>
      useLabsFlag("liveFlag" as LabsFlagKey),
    );

    expect(result.current).toBe(false);

    // Simulate a cross-tab write or saveSettings dispatch that enables the flag.
    mockLoadSettings.mockReturnValue(
      settingsWithFlags({ liveFlag: true }),
    );

    fireStorageEvent();

    expect(result.current).toBe(true);
  });

  it("re-reads settings and updates when a storage event fires (true → false)", () => {
    mockLoadSettings.mockReturnValue(
      settingsWithFlags({ liveFlag: true }),
    );

    const { result } = renderHook(() =>
      useLabsFlag("liveFlag" as LabsFlagKey),
    );

    expect(result.current).toBe(true);

    mockLoadSettings.mockReturnValue(
      settingsWithFlags({ liveFlag: false }),
    );

    fireStorageEvent();

    expect(result.current).toBe(false);
  });

  it("stops updating after unmount (no stale storage listener)", () => {
    mockLoadSettings.mockReturnValue(
      settingsWithFlags({ liveFlag: false }),
    );

    const { result, unmount } = renderHook(() =>
      useLabsFlag("liveFlag" as LabsFlagKey),
    );

    expect(result.current).toBe(false);

    unmount();

    // Storage event fires after unmount: the value must NOT change (no stale update).
    mockLoadSettings.mockReturnValue(
      settingsWithFlags({ liveFlag: true }),
    );

    // Dispatch outside of act — we expect no state update; no warning should appear.
    window.dispatchEvent(new StorageEvent("storage"));

    // Value stays at the pre-unmount reading because the listener was removed.
    expect(result.current).toBe(false);
  });

  it("calls loadSettings on every storage event (not just once)", () => {
    mockLoadSettings.mockReturnValue(settingsWithFlags({}));

    renderHook(() => useLabsFlag("anyKey" as LabsFlagKey));

    const callsAfterMount = mockLoadSettings.mock.calls.length;

    fireStorageEvent();
    fireStorageEvent();

    // Two more reads: one per storage event.
    expect(mockLoadSettings.mock.calls.length).toBe(callsAfterMount + 2);
  });
});

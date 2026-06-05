import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionReloadListeners } from "@/components/review/useSessionReloadListeners";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockLoadSettings } = vi.hoisted(() => ({
  mockLoadSettings: vi.fn(() => ({ activePokemonNameLocale: "en" })),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
  DEFAULT_ONBOARDING: {},
}));

vi.mock("@/lib/sync/pullAndMerge", () => ({
  SYNC_PULL_APPLIED_EVENT: "poke-memory:sync-pull-applied",
}));

vi.mock("@/lib/storage/keys", () => ({
  KEY_SETTINGS: "poke-memory:settings:v1",
  KEY_HAS_MASTERED: "poke-memory:has-mastered",
}));

// ---------------------------------------------------------------------------
// reload spy - jsdom's window.location is non-configurable, so we replace
// the property descriptor with a writable one before spying (#1520).
// ---------------------------------------------------------------------------

const mockReload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload: mockReload },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  mockReload.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessionReloadListeners - cross-tab storage event", () => {
  it("reloads when storage event fires with KEY_SETTINGS key", () => {
    renderHook(() => useSessionReloadListeners("en"));

    window.dispatchEvent(
      new StorageEvent("storage", { key: "poke-memory:settings:v1" }),
    );

    expect(mockReload).toHaveBeenCalledOnce();
  });

  it("does not reload when storage event fires with a different key", () => {
    renderHook(() => useSessionReloadListeners("en"));

    window.dispatchEvent(
      new StorageEvent("storage", { key: "poke-memory:some-other-key" }),
    );

    expect(mockReload).not.toHaveBeenCalled();
  });
});

describe("useSessionReloadListeners - same-tab locale switch", () => {
  it("reloads when SETTINGS_SAVED_EVENT fires and locale changed", () => {
    // Current locale is "en"; settings now return "ja".
    mockLoadSettings.mockReturnValue({ activePokemonNameLocale: "ja" });
    renderHook(() => useSessionReloadListeners("en"));

    window.dispatchEvent(new Event("poke-memory:settings-saved"));

    expect(mockReload).toHaveBeenCalledOnce();
  });

  it("does not reload when SETTINGS_SAVED_EVENT fires but locale is unchanged", () => {
    mockLoadSettings.mockReturnValue({ activePokemonNameLocale: "en" });
    renderHook(() => useSessionReloadListeners("en"));

    window.dispatchEvent(new Event("poke-memory:settings-saved"));

    expect(mockReload).not.toHaveBeenCalled();
  });
});

describe("useSessionReloadListeners - sync pull applied", () => {
  it("reloads when SYNC_PULL_APPLIED_EVENT fires", () => {
    renderHook(() => useSessionReloadListeners("en"));

    window.dispatchEvent(new Event("poke-memory:sync-pull-applied"));

    expect(mockReload).toHaveBeenCalledOnce();
  });
});

describe("useSessionReloadListeners - cleanup on unmount", () => {
  it("removes all listeners on unmount so no reload fires after unmount", () => {
    const { unmount } = renderHook(() => useSessionReloadListeners("en"));

    unmount();

    window.dispatchEvent(
      new StorageEvent("storage", { key: "poke-memory:settings:v1" }),
    );
    window.dispatchEvent(new Event("poke-memory:settings-saved"));
    window.dispatchEvent(new Event("poke-memory:sync-pull-applied"));

    expect(mockReload).not.toHaveBeenCalled();
  });
});

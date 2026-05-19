/**
 * Tests for lib/sync/backgroundSync.ts (#1054).
 *
 * Covers feature detection and the sync-tag registration helper. The hook-level
 * integration (SW message listener in useOnlineReconnectSync, registration on
 * push failure in useSyncOnUnload) is tested in the jsdom suite under
 * components/sync/.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isBackgroundSyncSupported,
  registerBackgroundSync,
  BACKGROUND_SYNC_TAG,
} from "./backgroundSync";

// ─── isBackgroundSyncSupported ────────────────────────────────────────────────

describe("isBackgroundSyncSupported", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("window", { SyncManager: class {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when SyncManager and serviceWorker are both present", () => {
    expect(isBackgroundSyncSupported()).toBe(true);
  });

  it("returns false when navigator is undefined (SSR)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isBackgroundSyncSupported()).toBe(false);
  });

  it("returns false when serviceWorker is absent from navigator", () => {
    vi.stubGlobal("navigator", {}); // no serviceWorker property
    expect(isBackgroundSyncSupported()).toBe(false);
  });

  it("returns false when window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(isBackgroundSyncSupported()).toBe(false);
  });

  it("returns false when SyncManager is absent from window", () => {
    vi.stubGlobal("window", {}); // no SyncManager property
    expect(isBackgroundSyncSupported()).toBe(false);
  });
});

// ─── registerBackgroundSync ───────────────────────────────────────────────────

describe("registerBackgroundSync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op and does not throw when Background Sync is not supported", async () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("window", {}); // no SyncManager
    await expect(registerBackgroundSync()).resolves.toBeUndefined();
  });

  it("registers the correct tag via SyncManager.register", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const readyRegistration = { sync: { register } };

    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve(readyRegistration),
      },
    });
    vi.stubGlobal("window", { SyncManager: class {} });

    await registerBackgroundSync();

    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(BACKGROUND_SYNC_TAG);
  });

  it("swallows errors and does not throw when registration fails", async () => {
    const register = vi.fn().mockRejectedValue(new DOMException("NotAllowedError"));
    const readyRegistration = { sync: { register } };

    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve(readyRegistration),
      },
    });
    vi.stubGlobal("window", { SyncManager: class {} });

    // Should not throw — errors are swallowed and logged.
    await expect(registerBackgroundSync()).resolves.toBeUndefined();
  });

  it("is a no-op when the registration object has no sync property", async () => {
    // Some browsers support serviceWorker but not the sync API.
    const readyRegistration = {}; // no `sync` property
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve(readyRegistration),
      },
    });
    vi.stubGlobal("window", { SyncManager: class {} });

    await expect(registerBackgroundSync()).resolves.toBeUndefined();
  });
});

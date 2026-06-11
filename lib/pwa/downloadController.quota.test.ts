/**
 * Unit tests for checkStorageHeadroom() in downloadController.ts.
 *
 * Tests the four cases for the #1846 pre-flight quota check:
 *   (a) API available + enough headroom → { hasHeadroom: true }
 *   (b) API available + insufficient headroom → { hasHeadroom: false }
 *   (c) API unavailable (navigator.storage absent) → null (fall through)
 *   (d) API throws → null (fall through)
 *
 * The test file lives in lib/pwa/ so the "node" vitest project picks it up.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// navigator stub helpers
// ---------------------------------------------------------------------------

function stubNavigator(storageValue: unknown) {
  vi.stubGlobal("navigator", { storage: storageValue });
}

function removeNavigator() {
  vi.stubGlobal("navigator", undefined);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// (a) API available + enough headroom → hasHeadroom: true
// ---------------------------------------------------------------------------

describe("checkStorageHeadroom - (a) sufficient headroom", () => {
  it("returns hasHeadroom: true when free space exceeds the required amount", async () => {
    // Required = OFFLINE_PACK_EXPECTED_BYTES + OFFLINE_SAVE_BUFFER_BYTES
    //           = 166 MB + 20 MB = 186 MB.
    // Free = quota - usage = 2000 MB - 50 MB = 1950 MB. Well above 186 MB.
    const estimateMock = vi.fn().mockResolvedValue({
      usage: 50 * 1024 * 1024,    // 50 MB used
      quota: 2000 * 1024 * 1024,  // 2 GB quota
    });
    stubNavigator({ estimate: estimateMock });

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).not.toBeNull();
    expect(result!.hasHeadroom).toBe(true);
  });

  it("includes freeBytes and requiredBytes in the result", async () => {
    const usedBytes = 50 * 1024 * 1024;
    const quotaBytes = 2000 * 1024 * 1024;
    const estimateMock = vi.fn().mockResolvedValue({ usage: usedBytes, quota: quotaBytes });
    stubNavigator({ estimate: estimateMock });

    const { checkStorageHeadroom, } = await import("./downloadController");
    const { OFFLINE_PACK_EXPECTED_BYTES, OFFLINE_SAVE_BUFFER_BYTES } = await import("./precache");
    const result = await checkStorageHeadroom();

    expect(result!.freeBytes).toBe(quotaBytes - usedBytes);
    expect(result!.requiredBytes).toBe(OFFLINE_PACK_EXPECTED_BYTES + OFFLINE_SAVE_BUFFER_BYTES);
  });
});

// ---------------------------------------------------------------------------
// (b) API available + insufficient headroom → hasHeadroom: false
// ---------------------------------------------------------------------------

describe("checkStorageHeadroom - (b) insufficient headroom", () => {
  it("returns hasHeadroom: false when free space is less than the required amount", async () => {
    // Required = 186 MB. Free = quota - usage = 250 MB - 200 MB = 50 MB. Not enough.
    const estimateMock = vi.fn().mockResolvedValue({
      usage: 200 * 1024 * 1024,  // 200 MB used
      quota: 250 * 1024 * 1024,  // 250 MB quota
    });
    stubNavigator({ estimate: estimateMock });

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).not.toBeNull();
    expect(result!.hasHeadroom).toBe(false);
  });

  it("returns hasHeadroom: false when free space equals exactly the required amount minus 1 byte", async () => {
    const { OFFLINE_PACK_EXPECTED_BYTES, OFFLINE_SAVE_BUFFER_BYTES } = await import("./precache");
    const required = OFFLINE_PACK_EXPECTED_BYTES + OFFLINE_SAVE_BUFFER_BYTES;
    const quota = required + 1000; // a bit above required
    const usage = quota - required + 1; // free = required - 1: one byte short

    const estimateMock = vi.fn().mockResolvedValue({ usage, quota });
    stubNavigator({ estimate: estimateMock });

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).not.toBeNull();
    expect(result!.hasHeadroom).toBe(false);
  });

  it("returns hasHeadroom: true when free space equals exactly the required amount", async () => {
    const { OFFLINE_PACK_EXPECTED_BYTES, OFFLINE_SAVE_BUFFER_BYTES } = await import("./precache");
    const required = OFFLINE_PACK_EXPECTED_BYTES + OFFLINE_SAVE_BUFFER_BYTES;
    const quota = required + 1000;
    const usage = quota - required; // free = exactly required

    const estimateMock = vi.fn().mockResolvedValue({ usage, quota });
    stubNavigator({ estimate: estimateMock });

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).not.toBeNull();
    expect(result!.hasHeadroom).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) API unavailable → null
// ---------------------------------------------------------------------------

describe("checkStorageHeadroom - (c) API unavailable", () => {
  it("returns null when navigator is undefined (SSR / server context)", async () => {
    removeNavigator();

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).toBeNull();
  });

  it("returns null when navigator.storage is absent", async () => {
    // navigator exists but has no .storage property.
    stubNavigator(undefined);

    // Re-define navigator without storage:
    vi.stubGlobal("navigator", {});

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).toBeNull();
  });

  it("returns null when navigator.storage.estimate is absent", async () => {
    // storage exists but has no .estimate method.
    stubNavigator({});

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).toBeNull();
  });

  it("returns null when usage is undefined in the estimate result", async () => {
    const estimateMock = vi.fn().mockResolvedValue({ quota: 2000 * 1024 * 1024 }); // no usage
    stubNavigator({ estimate: estimateMock });

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).toBeNull();
  });

  it("returns null when quota is undefined in the estimate result", async () => {
    const estimateMock = vi.fn().mockResolvedValue({ usage: 50 * 1024 * 1024 }); // no quota
    stubNavigator({ estimate: estimateMock });

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) API throws → null
// ---------------------------------------------------------------------------

describe("checkStorageHeadroom - (d) API throws", () => {
  it("returns null when navigator.storage.estimate() rejects", async () => {
    const estimateMock = vi.fn().mockRejectedValue(new Error("storage estimate failed"));
    stubNavigator({ estimate: estimateMock });

    const { checkStorageHeadroom } = await import("./downloadController");
    const result = await checkStorageHeadroom();

    expect(result).toBeNull();
  });
});

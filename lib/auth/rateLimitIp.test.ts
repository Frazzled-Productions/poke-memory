/**
 * Unit tests for lib/auth/rateLimitIp.ts (#1768).
 *
 * The hashIp helper must:
 *  - Return a 64-character lowercase hex string (sha256 output).
 *  - Never return the raw IP.
 *  - Be deterministic: same input -> same output.
 *  - Produce different digests for different IPs.
 *  - Produce different digests when the salt changes (proves the salt is used).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

describe("hashIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a 64-character hex string", async () => {
    vi.stubEnv("RATE_LIMIT_SALT", "test-salt");
    const { hashIp } = await import("./rateLimitIp");
    const result = hashIp("1.2.3.4");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never equals the raw IP", async () => {
    vi.stubEnv("RATE_LIMIT_SALT", "test-salt");
    const { hashIp } = await import("./rateLimitIp");
    const rawIp = "192.168.1.100";
    const result = hashIp(rawIp);
    expect(result).not.toBe(rawIp);
    expect(result).not.toContain(rawIp);
  });

  it("is deterministic: same IP + same salt -> same digest", async () => {
    vi.stubEnv("RATE_LIMIT_SALT", "stable-salt");
    const { hashIp } = await import("./rateLimitIp");
    const a = hashIp("10.0.0.1");
    const b = hashIp("10.0.0.1");
    expect(a).toBe(b);
  });

  it("produces different digests for different IPs", async () => {
    vi.stubEnv("RATE_LIMIT_SALT", "stable-salt");
    const { hashIp } = await import("./rateLimitIp");
    const a = hashIp("10.0.0.1");
    const b = hashIp("10.0.0.2");
    expect(a).not.toBe(b);
  });

  it("produces different digests when the salt changes", async () => {
    vi.stubEnv("RATE_LIMIT_SALT", "salt-a");
    const { hashIp: hashA } = await import("./rateLimitIp");
    const digestA = hashA("10.0.0.1");

    vi.stubEnv("RATE_LIMIT_SALT", "salt-b");
    // Re-import to pick up the new env var (module cache reset handled by vi.stubEnv).
    // Node's module cache means the same module instance is returned; we call the
    // function again with the updated env.
    const { hashIp: hashB } = await import("./rateLimitIp");
    const digestB = hashB("10.0.0.1");

    expect(digestA).not.toBe(digestB);
  });

  it("falls back to dev-salt when RATE_LIMIT_SALT is not set", async () => {
    vi.stubEnv("RATE_LIMIT_SALT", "");
    const { hashIp } = await import("./rateLimitIp");
    // Should not throw; returns a valid 64-char hex.
    const result = hashIp("1.2.3.4");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

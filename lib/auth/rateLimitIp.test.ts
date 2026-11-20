/**
 * Unit tests for lib/auth/rateLimitIp.ts (#1768).
 *
 * The hashIp helper must:
 *  - Return a 64-character lowercase hex string (sha256 output).
 *  - Never return the raw IP.
 *  - Be deterministic: same input -> same output.
 *  - Produce different digests for different IPs.
 *  - Produce different digests when the salt changes (proves the salt is used).
 *  - Take the salt from the Worker env passed in, never from process.env.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { hashIp } from "./rateLimitIp";

describe("hashIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a 64-character hex string", () => {
    const result = hashIp("1.2.3.4", "test-salt");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never equals the raw IP", () => {
    const rawIp = "192.168.1.100";
    const result = hashIp(rawIp, "test-salt");
    expect(result).not.toBe(rawIp);
    expect(result).not.toContain(rawIp);
  });

  it("is deterministic: same IP + same salt -> same digest", () => {
    expect(hashIp("10.0.0.1", "stable-salt")).toBe(hashIp("10.0.0.1", "stable-salt"));
  });

  it("produces different digests for different IPs", () => {
    expect(hashIp("10.0.0.1", "stable-salt")).not.toBe(hashIp("10.0.0.2", "stable-salt"));
  });

  it("produces different digests when the salt changes", () => {
    expect(hashIp("10.0.0.1", "salt-a")).not.toBe(hashIp("10.0.0.1", "salt-b"));
  });

  it("falls back to dev-salt when the Worker has no RATE_LIMIT_SALT", () => {
    expect(hashIp("1.2.3.4", undefined)).toBe(hashIp("1.2.3.4", "dev-salt"));
    expect(hashIp("1.2.3.4", "")).toBe(hashIp("1.2.3.4", "dev-salt"));
  });

  it("takes the salt only from its argument (the Worker env), never process.env", () => {
    vi.stubEnv("RATE_LIMIT_SALT", "env-salt");
    expect(hashIp("10.0.0.1", undefined)).toBe(hashIp("10.0.0.1", "dev-salt"));
    expect(hashIp("10.0.0.1", undefined)).not.toBe(hashIp("10.0.0.1", "env-salt"));
  });
});

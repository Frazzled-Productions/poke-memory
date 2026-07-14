import { describe, expect, it } from "vitest";
import { isAuthorized } from "./bearerAuth";

const SECRET = "test-secret-abc123";

describe("isAuthorized", () => {
  it("accepts the exact Bearer header for the secret", () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorized(null, SECRET)).toBe(false);
  });

  it("rejects an empty header", () => {
    expect(isAuthorized("", SECRET)).toBe(false);
  });

  it("rejects when the configured secret is empty", () => {
    expect(isAuthorized(`Bearer ${SECRET}`, "")).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    const wrong = "x".repeat(SECRET.length);
    expect(isAuthorized(`Bearer ${wrong}`, SECRET)).toBe(false);
  });

  it("rejects a header of the wrong length without throwing", () => {
    expect(isAuthorized("Bearer short", SECRET)).toBe(false);
    expect(isAuthorized(`Bearer ${SECRET}-longer`, SECRET)).toBe(false);
  });

  it("rejects the bare secret without the Bearer prefix", () => {
    expect(isAuthorized(SECRET, SECRET)).toBe(false);
  });

  it("rejects a lowercase bearer prefix", () => {
    expect(isAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
  });

  it("handles multi-byte header values without throwing", () => {
    // A multi-byte string can pass the UTF-16 length check while producing a
    // different Buffer byte length; timingSafeEqual then throws, and the
    // helper must swallow that and return false.
    const multiByte = "£".repeat(`Bearer ${SECRET}`.length);
    expect(isAuthorized(multiByte, SECRET)).toBe(false);
  });
});

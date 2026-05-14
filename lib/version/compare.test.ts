import { describe, expect, it } from "vitest";
import { compareSemver, parseSemver } from "./compare";

describe("parseSemver", () => {
  it("parses well-formed versions", () => {
    expect(parseSemver("0.9.55")).toEqual([0, 9, 55]);
    expect(parseSemver("1.0.0")).toEqual([1, 0, 0]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseSemver("  1.2.3  ")).toEqual([1, 2, 3]);
  });

  it("returns null for non-SemVer strings", () => {
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1.2.3-rc.1")).toBeNull();
    expect(parseSemver("dev")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("returns negative when a < b", () => {
    expect(compareSemver("0.9.54", "0.9.55")).toBeLessThan(0);
    expect(compareSemver("0.9.99", "0.10.0")).toBeLessThan(0);
    expect(compareSemver("0.9.55", "1.0.0")).toBeLessThan(0);
  });

  it("returns positive when a > b", () => {
    expect(compareSemver("0.9.55", "0.9.54")).toBeGreaterThan(0);
    expect(compareSemver("0.10.0", "0.9.99")).toBeGreaterThan(0);
  });

  it("returns 0 when equal", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns 0 when either operand is unparseable (no spurious unseen state)", () => {
    expect(compareSemver("dev", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3", "garbage")).toBe(0);
  });
});

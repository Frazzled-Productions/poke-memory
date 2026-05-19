import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins multiple strings with a space", () => {
    expect(cn("foo", "bar", "baz")).toBe("foo bar baz");
  });

  it("returns a single string unchanged", () => {
    expect(cn("only")).toBe("only");
  });

  it("returns an empty string when called with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("drops false values", () => {
    expect(cn("a", false, "b")).toBe("a b");
  });

  it("drops null values", () => {
    expect(cn("a", null, "b")).toBe("a b");
  });

  it("drops undefined values", () => {
    expect(cn("a", undefined, "b")).toBe("a b");
  });

  it("drops all falsy values together", () => {
    expect(cn(false, null, undefined, "real")).toBe("real");
  });

  it("returns empty string when all values are falsy", () => {
    expect(cn(false, null, undefined)).toBe("");
  });

  it("supports conditional class via short-circuit expression", () => {
    const active = true;
    const inactive = false;
    expect(cn("base", active && "active", inactive && "inactive")).toBe(
      "base active",
    );
  });

  it("preserves class order", () => {
    expect(cn("z-10", "p-4", "rounded-xl")).toBe("z-10 p-4 rounded-xl");
  });
});

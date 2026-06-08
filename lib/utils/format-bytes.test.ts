import { describe, it, expect } from "vitest";
import { formatGb } from "./format-bytes";

describe("formatGb", () => {
  it("formats zero bytes as 0.0 GB", () => {
    expect(formatGb(0)).toBe("0.0 GB");
  });

  it("formats 100 MB as 0.1 GB", () => {
    // 100_000_000 / 1_000_000_000 = 0.1
    expect(formatGb(100_000_000)).toBe("0.1 GB");
  });

  it("formats 200 MB as 0.2 GB", () => {
    expect(formatGb(200_000_000)).toBe("0.2 GB");
  });

  it("formats 64 GB as 64.0 GB", () => {
    expect(formatGb(64_000_000_000)).toBe("64.0 GB");
  });

  it("formats 2 GB as 2.0 GB", () => {
    expect(formatGb(2_000_000_000)).toBe("2.0 GB");
  });

  it("formats 50 MB as 0.1 GB (rounded to one decimal)", () => {
    // 50_000_000 / 1_000_000_000 = 0.05 → rounds to 0.1
    expect(formatGb(50_000_000)).toBe("0.1 GB");
  });

  it("formats 96 MB (real precache size) as 0.1 GB", () => {
    // ~96 MB is the real precache on disk (#1789).
    expect(formatGb(96_000_000)).toBe("0.1 GB");
  });

  it("always has exactly one decimal place", () => {
    const result = formatGb(1_500_000_000);
    expect(result).toMatch(/^\d+\.\d GB$/);
    expect(result).toBe("1.5 GB");
  });
});

import { describe, it, expect } from "vitest";
import { formatGb, formatDownloadBytes } from "./format-bytes";

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

describe("formatDownloadBytes", () => {
  it("formats zero bytes as 0.0 MB", () => {
    expect(formatDownloadBytes(0)).toBe("0.0 MB");
  });

  it("formats a small download (25 KB) as 0.0 MB", () => {
    // 25_000 bytes = 0.025 MB, rounds to 0.0
    expect(formatDownloadBytes(25_000)).toBe("0.0 MB");
  });

  it("formats 1 MB as 1.0 MB (not 0.0 GB)", () => {
    // This was the key failure with formatGb: 1_000_000 / 1e9 = 0.001 → 0.0 GB
    expect(formatDownloadBytes(1_000_000)).toBe("1.0 MB");
  });

  it("formats 60 MB as 60.0 MB", () => {
    expect(formatDownloadBytes(60_000_000)).toBe("60.0 MB");
  });

  it("formats 166 MB (realistic precache size) as 166.0 MB", () => {
    expect(formatDownloadBytes(166_000_000)).toBe("166.0 MB");
  });

  it("formats 999 MB as 999.0 MB (stays in MB below 1 GB)", () => {
    expect(formatDownloadBytes(999_000_000)).toBe("999.0 MB");
  });

  it("switches to GB at exactly 1,000 MB (1 GB)", () => {
    expect(formatDownloadBytes(1_000_000_000)).toBe("1.0 GB");
  });

  it("formats 1.2 GB as 1.2 GB", () => {
    expect(formatDownloadBytes(1_200_000_000)).toBe("1.2 GB");
  });

  it("always shows exactly one decimal place (MB range)", () => {
    const result = formatDownloadBytes(123_456_789);
    // 123_456_789 / 1e6 = 123.456789 → 123.5 MB
    expect(result).toBe("123.5 MB");
    expect(result).toMatch(/^\d+\.\d MB$/);
  });

  it("always shows exactly one decimal place (GB range)", () => {
    const result = formatDownloadBytes(1_500_000_000);
    expect(result).toBe("1.5 GB");
    expect(result).toMatch(/^\d+\.\d GB$/);
  });
});

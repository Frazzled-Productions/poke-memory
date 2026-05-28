import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSet = vi.fn();
const mockHeaders = vi.fn<() => Headers>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mockSet }),
  headers: async () => mockHeaders(),
}));

// Dynamic import after the mock is installed.
const { setLocaleCookie } = await import("./actions");

describe("setLocaleCookie", () => {
  beforeEach(() => {
    mockSet.mockClear();
    mockHeaders.mockClear();
  });

  it("sets secure: true when x-forwarded-proto is https", async () => {
    mockHeaders.mockReturnValue(new Headers({ "x-forwarded-proto": "https" }));
    await setLocaleCookie("ja");
    expect(mockSet).toHaveBeenCalledWith(
      "poke-memory:locale",
      "ja",
      expect.objectContaining({ secure: true, path: "/", sameSite: "lax" }),
    );
  });

  it("sets secure: false when x-forwarded-proto is http (e2e CI on localhost)", async () => {
    mockHeaders.mockReturnValue(new Headers({ "x-forwarded-proto": "http" }));
    await setLocaleCookie("en");
    expect(mockSet).toHaveBeenCalledWith(
      "poke-memory:locale",
      "en",
      expect.objectContaining({ secure: false }),
    );
  });

  it("sets secure: false when x-forwarded-proto is absent", async () => {
    mockHeaders.mockReturnValue(new Headers());
    await setLocaleCookie("zh-Hans");
    expect(mockSet).toHaveBeenCalledWith(
      "poke-memory:locale",
      "zh-Hans",
      expect.objectContaining({ secure: false }),
    );
  });

  it("ignores unsupported locale values", async () => {
    mockHeaders.mockReturnValue(new Headers({ "x-forwarded-proto": "https" }));
    await setLocaleCookie("invalid" as never);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";

import { buildOfflineAssetResponse, parseRangeHeader } from "./rangeResponse";

describe("parseRangeHeader", () => {
  const TOTAL = 1000;

  it("parses an explicit closed range", () => {
    expect(parseRangeHeader("bytes=0-499", TOTAL)).toEqual({ start: 0, end: 499 });
  });

  it("parses an open-ended range to the last byte", () => {
    expect(parseRangeHeader("bytes=200-", TOTAL)).toEqual({ start: 200, end: 999 });
  });

  it("treats the common WebKit media probe (bytes=0-) as the whole resource", () => {
    expect(parseRangeHeader("bytes=0-", TOTAL)).toEqual({ start: 0, end: 999 });
  });

  it("parses a suffix range as the final N bytes", () => {
    expect(parseRangeHeader("bytes=-300", TOTAL)).toEqual({ start: 700, end: 999 });
  });

  it("clamps a suffix larger than the resource to the whole resource", () => {
    expect(parseRangeHeader("bytes=-5000", TOTAL)).toEqual({ start: 0, end: 999 });
  });

  it("clamps an end past the resource size to the last byte", () => {
    expect(parseRangeHeader("bytes=900-9999", TOTAL)).toEqual({ start: 900, end: 999 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRangeHeader("  bytes=0-99  ", TOTAL)).toEqual({ start: 0, end: 99 });
  });

  it("returns null for a start past the end (unsatisfiable)", () => {
    expect(parseRangeHeader("bytes=1000-1100", TOTAL)).toBeNull();
  });

  it("returns null when end is before start", () => {
    expect(parseRangeHeader("bytes=500-200", TOTAL)).toBeNull();
  });

  it("returns null for a multi-range header", () => {
    expect(parseRangeHeader("bytes=0-99,200-299", TOTAL)).toBeNull();
  });

  it("returns null for a non-bytes unit", () => {
    expect(parseRangeHeader("items=0-99", TOTAL)).toBeNull();
  });

  it("returns null for an empty/garbage range", () => {
    expect(parseRangeHeader("bytes=-", TOTAL)).toBeNull();
    expect(parseRangeHeader("bytes=abc", TOTAL)).toBeNull();
  });
});

describe("buildOfflineAssetResponse", () => {
  const makeBlob = (size: number, type = "audio/ogg") =>
    new Blob([new Uint8Array(size)], { type });

  it("returns a full 200 with Accept-Ranges when there is no Range header", async () => {
    const blob = makeBlob(500);
    const res = buildOfflineAssetResponse(new Request("https://x/cries/25.ogg"), blob, "audio/ogg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Type")).toBe("audio/ogg");
    expect(res.headers.get("Content-Length")).toBe("500");
    expect((await res.blob()).size).toBe(500);
  });

  it("returns 206 with Content-Range for a ranged media request", async () => {
    const blob = makeBlob(1000);
    const req = new Request("https://x/cries/25.ogg", { headers: { Range: "bytes=0-" } });
    const res = buildOfflineAssetResponse(req, blob, "audio/ogg");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-999/1000");
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect((await res.blob()).size).toBe(1000);
  });

  it("slices the blob for a partial range", async () => {
    const blob = makeBlob(1000);
    const req = new Request("https://x/cries/25.ogg", { headers: { Range: "bytes=100-199" } });
    const res = buildOfflineAssetResponse(req, blob, "audio/ogg");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 100-199/1000");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect((await res.blob()).size).toBe(100);
  });

  it("falls back to a full 200 for an unsatisfiable range", async () => {
    const blob = makeBlob(500);
    const req = new Request("https://x/cries/25.ogg", { headers: { Range: "bytes=9999-" } });
    const res = buildOfflineAssetResponse(req, blob, "audio/ogg");
    expect(res.status).toBe(200);
    expect((await res.blob()).size).toBe(500);
  });
});

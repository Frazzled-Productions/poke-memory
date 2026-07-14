import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { parseJsonBody } from "./parseJsonBody";

function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("parseJsonBody", () => {
  it("returns { ok: true, data } for a valid JSON body", async () => {
    const result = await parseJsonBody<{ cards: number[] }>(
      jsonRequest(JSON.stringify({ cards: [1, 2, 3] })),
    );

    expect(result).not.toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) throw new Error("unreachable");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ cards: [1, 2, 3] });
  });

  it("returns 400 { ok: false, error: invalid_json } for a malformed body", async () => {
    const result = await parseJsonBody(jsonRequest("{not json"));

    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ ok: false, error: "invalid_json" });
  });

  it("returns 400 for an empty body", async () => {
    const result = await parseJsonBody(jsonRequest(""));

    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error("unreachable");
    expect(result.status).toBe(400);
  });
});

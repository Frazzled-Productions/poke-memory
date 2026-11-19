import { describe, expect, it } from "vitest";
import { parseWranglerJson } from "./d1-query.mjs";

// The shape `wrangler d1 execute --json` prints: one entry per statement.
const ok = (results) => ({ results, success: true, meta: { duration: 0 } });

describe("parseWranglerJson", () => {
  it("returns the rows of the last statement", () => {
    const out = JSON.stringify([ok([{ x: 1 }]), ok([{ n: 20 }])]);
    expect(parseWranglerJson(out)).toEqual([{ n: 20 }]);
  });

  it("refuses output that is not JSON", () => {
    expect(() => parseWranglerJson("Authentication error")).toThrow(/did not print JSON/);
  });

  it("refuses a failed statement", () => {
    const out = JSON.stringify([{ results: [], success: false }]);
    expect(() => parseWranglerJson(out)).toThrow(/Unexpected wrangler result/);
  });
});

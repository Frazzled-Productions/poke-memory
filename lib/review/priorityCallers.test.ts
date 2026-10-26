import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Same list everywhere (#2187): every buildSessionQueues call in ReviewSession
// passes the learn-first list, so the queue the player sees, the display lock,
// the decode-ahead peek and the initial learning queue all agree.
describe("ReviewSession passes priorityNewSpeciesIds to every buildSessionQueues call", () => {
  it("each of the four calls passes the list", () => {
    const text = readFileSync(join(process.cwd(), "components/review/ReviewSession.tsx"), "utf8");
    const calls = [...text.matchAll(/buildSessionQueues\(([^;]*?)\);/gs)].map((m) => m[1]);
    expect(calls).toHaveLength(4);
    const missing = calls.filter((args) => !/priorityNewSpeciesIds\s*,?\s*$/.test(args.trim()));
    expect(missing).toEqual([]);
  });
});

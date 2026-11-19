import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, RATE_LIMIT_CAPS } from "./rateLimit";
import { createSqliteD1, type SqliteD1 } from "./testing/sqliteD1";

const IP_A = "a".repeat(64);
const IP_B = "b".repeat(64);
const T0 = new Date("2026-11-19T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let d1: SqliteD1;
beforeEach(() => {
  d1 = createSqliteD1();
});
afterEach(() => d1.close());

function rowCount(action: string): number {
  const row = d1.sqlite
    .prepare("SELECT COUNT(*) AS n FROM rate_limit_buckets WHERE action = ?")
    .get(action) as { n: number };
  return Number(row.n);
}

async function attempts(n: number, ip: string, action: "signup" | "signin" | "feedback", when: Date) {
  const results: boolean[] = [];
  for (let i = 0; i < n; i++) results.push(await checkRateLimit(d1, ip, action, when));
  return results;
}

describe("checkRateLimit (041 + 045 semantics on D1)", () => {
  it("caps sign-up at 5 per 10 minutes and records only allowed attempts", async () => {
    expect(await attempts(5, IP_A, "signup", T0)).toEqual([true, true, true, true, true]);
    expect(await checkRateLimit(d1, IP_A, "signup", T0)).toBe(false);
    expect(rowCount("signup")).toBe(5);
  });

  it("caps sign-in at 10 per 10 minutes", async () => {
    expect((await attempts(10, IP_A, "signin", T0)).every(Boolean)).toBe(true);
    expect(await checkRateLimit(d1, IP_A, "signin", T0)).toBe(false);
  });

  it("frees the 10-minute window after it slides, but holds the 1-hour cap", async () => {
    // 4 windows of 5 sign-ups, each 11 minutes apart: 20 allowed in 44 minutes.
    for (let w = 0; w < 4; w++) {
      expect((await attempts(5, IP_A, "signup", at(w * 11))).every(Boolean)).toBe(true);
    }
    // The 10-minute window is clear again at 55 minutes, but 20 fall in the hour.
    expect(await checkRateLimit(d1, IP_A, "signup", at(55))).toBe(false);
    // At 61 minutes the first window has left the hour.
    expect(await checkRateLimit(d1, IP_A, "signup", at(61))).toBe(true);
  });

  it("keeps IPs and actions apart", async () => {
    await attempts(5, IP_A, "signup", T0);
    expect(await checkRateLimit(d1, IP_B, "signup", T0)).toBe(true);
    expect(await checkRateLimit(d1, IP_A, "signin", T0)).toBe(true);
    expect(await checkRateLimit(d1, IP_A, "feedback", T0)).toBe(true);
  });

  it("matches the Postgres caps", () => {
    expect(RATE_LIMIT_CAPS).toEqual({
      signup: { per10Minutes: 5, perHour: 20 },
      signin: { per10Minutes: 10, perHour: 40 },
      feedback: { per10Minutes: 5, perHour: 20 },
    });
  });
});

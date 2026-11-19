import { describe, expect, it } from "vitest";
import { CRON_ROUTES, HALF_HOURLY_CRON, HOURLY_CRON, cronRoutesFor } from "./schedule";

const HOURLY = [CRON_ROUTES.sendDaily, CRON_ROUTES.sendStreakNudge];

// 2026-11-16 is a Monday, 2026-11-22 a Sunday, 2026-11-18 a Wednesday.
describe("cronRoutesFor (design D2 table)", () => {
  it("every hour: daily reminders and streak nudge", () => {
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(Date.UTC(2026, 10, 18, hour, 0));
      expect(cronRoutesFor(HOURLY_CRON, at).slice(0, 2)).toEqual(HOURLY);
    }
  });

  it("Monday 09:00: weekly digest", () => {
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-16T09:00:00Z"))).toEqual([
      ...HOURLY,
      CRON_ROUTES.discordDigest,
    ]);
  });

  it("03:00 every day: feedback retention", () => {
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-18T03:00:00Z"))).toEqual([
      ...HOURLY,
      CRON_ROUTES.feedbackRetention,
    ]);
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-22T03:00:00Z"))).toContain(
      CRON_ROUTES.feedbackRetention,
    );
  });

  it("Sunday 04:00: grade_log orphan reconcile", () => {
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-22T04:00:00Z"))).toEqual([
      ...HOURLY,
      CRON_ROUTES.reconcileGradeLog,
    ]);
  });

  it("every 30 minutes: rate-limit clean-up, and nothing else", () => {
    expect(cronRoutesFor(HALF_HOURLY_CRON, new Date("2026-11-18T10:30:00Z"))).toEqual([
      CRON_ROUTES.rateLimitCleanup,
    ]);
    // The half-hourly trigger also fires on the hour; hourly work stays on the
    // hourly trigger so it never runs twice.
    expect(cronRoutesFor(HALF_HOURLY_CRON, new Date("2026-11-16T09:00:00Z"))).toEqual([
      CRON_ROUTES.rateLimitCleanup,
    ]);
  });

  it("02:00 every day: nightly backup", () => {
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-18T02:00:00Z"))).toEqual([
      ...HOURLY,
      CRON_ROUTES.backup,
    ]);
  });

  it("the hourly trigger never runs the clean-up", () => {
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-18T10:00:00Z"))).not.toContain(
      CRON_ROUTES.rateLimitCleanup,
    );
  });
});

describe("cronRoutesFor: non-matching hours and days", () => {
  it("digest only on Monday at 09:00", () => {
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-16T08:00:00Z"))).toEqual(HOURLY);
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-16T10:00:00Z"))).toEqual(HOURLY);
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-17T09:00:00Z"))).toEqual(HOURLY);
  });

  it("reconcile only on Sunday at 04:00", () => {
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-21T04:00:00Z"))).toEqual(HOURLY);
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-22T05:00:00Z"))).toEqual(HOURLY);
  });

  it("an ordinary hour runs only the hourly pair", () => {
    for (const hour of [0, 1, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) {
      const at = new Date(Date.UTC(2026, 10, 16, hour, 0));
      expect(cronRoutesFor(HOURLY_CRON, at)).toEqual(HOURLY);
    }
  });

  it("uses UTC, not the host's local time", () => {
    // 09:00 UTC on Monday is 10:00 in Paris; still the digest.
    expect(cronRoutesFor(HOURLY_CRON, new Date("2026-11-16T10:00:00+01:00"))).toContain(
      CRON_ROUTES.discordDigest,
    );
  });

  it("an unknown cron string runs nothing", () => {
    expect(cronRoutesFor("15 * * * *", new Date("2026-11-16T09:00:00Z"))).toEqual([]);
    expect(cronRoutesFor("", new Date("2026-11-16T09:00:00Z"))).toEqual([]);
  });
});

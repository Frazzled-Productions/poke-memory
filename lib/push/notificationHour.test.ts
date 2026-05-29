/**
 * Unit tests for the per-user push-notification-hour selection logic (#1315).
 *
 * Tests the DST-correct UTC-hour conversion and the NULL-default behaviour.
 * All tests are pure (no network, no DB, no DOM).
 */

import { describe, it, expect } from "vitest";
import {
  localHourToUtcHour,
  shouldSendToUser,
  PUSH_DEFAULT_HOUR_UTC,
} from "./notificationHour";

// ---------------------------------------------------------------------------
// localHourToUtcHour
// ---------------------------------------------------------------------------

describe("localHourToUtcHour", () => {
  it("returns referenceHour directly when timezone is null", () => {
    const now = new Date("2026-05-20T08:00:00Z");
    expect(localHourToUtcHour(9, null, now)).toBe(9);
  });

  it("returns referenceHour directly when timezone is empty string", () => {
    const now = new Date("2026-05-20T08:00:00Z");
    expect(localHourToUtcHour(9, "", now)).toBe(9);
  });

  it("returns referenceHour directly when timezone is invalid", () => {
    const now = new Date("2026-05-20T08:00:00Z");
    // Invalid timezone → treated as UTC.
    expect(localHourToUtcHour(9, "Not/A/Real/Zone", now)).toBe(9);
  });

  it("converts a UTC+1 timezone (Europe/London in BST) correctly", () => {
    // At 08:00 UTC on a BST day, London local time is 09:00.
    // If the user wants their notification at 09:00 local (= 08:00 UTC), the
    // effective UTC hour should be 8.
    const now = new Date("2026-05-20T08:00:00Z"); // BST: UTC+1
    const utcHour = localHourToUtcHour(9, "Europe/London", now);
    expect(utcHour).toBe(8);
  });

  it("converts a UTC-5 timezone (America/New_York in EST) correctly", () => {
    // At 13:00 UTC, New York local time is 08:00 EST (UTC-5).
    // User prefers 08:00 local → effective UTC hour should be 13.
    const now = new Date("2026-01-20T13:00:00Z"); // EST: UTC-5
    const utcHour = localHourToUtcHour(8, "America/New_York", now);
    expect(utcHour).toBe(13);
  });

  it("converts a UTC+9 timezone (Asia/Tokyo) correctly", () => {
    // At 00:00 UTC, Tokyo local time is 09:00 JST (UTC+9).
    // User prefers 09:00 local → effective UTC hour should be 0.
    const now = new Date("2026-05-20T00:00:00Z");
    const utcHour = localHourToUtcHour(9, "Asia/Tokyo", now);
    expect(utcHour).toBe(0);
  });

  it("handles midnight (hour 0) correctly for UTC", () => {
    const now = new Date("2026-05-20T00:30:00Z");
    // UTC timezone: hour 0 stays 0.
    expect(localHourToUtcHour(0, "UTC", now)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shouldSendToUser
// ---------------------------------------------------------------------------

describe("shouldSendToUser", () => {
  describe("NULL preference (default behaviour)", () => {
    it("returns true when current UTC hour matches PUSH_DEFAULT_HOUR_UTC (8)", () => {
      const now = new Date(`2026-05-20T0${PUSH_DEFAULT_HOUR_UTC}:00:00Z`);
      expect(shouldSendToUser(null, null, now)).toBe(true);
    });

    it("returns true when current UTC hour matches default even with a timezone set", () => {
      // The user has a timezone set but no preferred hour → default UTC 8.
      const now = new Date("2026-05-20T08:00:00Z");
      expect(shouldSendToUser(null, "America/New_York", now)).toBe(true);
    });

    it("returns false when current UTC hour does not match PUSH_DEFAULT_HOUR_UTC", () => {
      const now = new Date("2026-05-20T09:00:00Z"); // UTC 9 ≠ default 8
      expect(shouldSendToUser(null, null, now)).toBe(false);
    });
  });

  describe("interim dormancy (set hour but cron still daily at 08:00 UTC)", () => {
    it("returns false for a user who wants 20:00 UTC+1 (= 19:00 UTC) when called at 08:00 UTC", () => {
      // User in UTC+1 wants 20:00 local = 19:00 UTC. Cron fires at 08:00 UTC.
      // In the interim (before phase-2 cron change), this user should be DORMANT.
      const now = new Date("2026-05-20T08:00:00Z");
      const result = shouldSendToUser(20, "Europe/London", now);
      // 20:00 Europe/London in BST = UTC 19. Current UTC is 8 → no match.
      expect(result).toBe(false);
    });

    it("returns true for a user who set hour 9 in Europe/London (BST=UTC+1) when UTC is 8", () => {
      // User wants 09:00 BST = 08:00 UTC. Cron fires at 08:00 UTC → match.
      const now = new Date("2026-05-20T08:00:00Z");
      const result = shouldSendToUser(9, "Europe/London", now);
      expect(result).toBe(true);
    });
  });

  describe("set hour matching", () => {
    it("returns true when the user's local preferred hour resolves to current UTC hour", () => {
      // UTC: current hour = 13. Tokyo local = 22:00 JST (UTC+9).
      // User wants 22:00 Tokyo = 13:00 UTC.
      const now = new Date("2026-05-20T13:00:00Z");
      expect(shouldSendToUser(22, "Asia/Tokyo", now)).toBe(true);
    });

    it("returns false when the user's local preferred hour does not match current UTC hour", () => {
      const now = new Date("2026-05-20T13:00:00Z");
      // User wants 08:00 Tokyo = 23:00 UTC (previous day). Current UTC is 13 → no match.
      expect(shouldSendToUser(8, "Asia/Tokyo", now)).toBe(false);
    });

    it("treats null timezone as UTC when a preferred hour is set", () => {
      // User set preferred hour 15 with no timezone → treated as UTC.
      const now = new Date("2026-05-20T15:00:00Z");
      expect(shouldSendToUser(15, null, now)).toBe(true);
    });

    it("returns false when preferred-hour/null-timezone combo does not match current UTC", () => {
      const now = new Date("2026-05-20T08:00:00Z");
      // User set preferred hour 15, no timezone (treated as UTC). Current UTC is 8 → no match.
      expect(shouldSendToUser(15, null, now)).toBe(false);
    });
  });
});

/**
 * Snapshot test for the localStorage key registry.
 *
 * These assertions are intentionally byte-exact checks against the string
 * values that are already persisted in real users' browsers. A key string
 * change would silently orphan their saved state — this test makes such a
 * change fail CI rather than ship unnoticed.
 *
 * If you legitimately need to rename a key (e.g. a v2 migration), add the
 * new key alongside the old one, run the migration, then remove the old key
 * — do not change the existing constant here.
 */
import { describe, it, expect } from "vitest";
import {
  KEY_REVIEW_SESSION,
  KEY_GRADE_LOG,
  KEY_DAILY_SUMMARY,
  KEY_SETTINGS,
  KEY_SETTINGS_LAST_PUSHED,
  KEY_SYNC_STATUS,
  KEY_PENDING_GRADE_QUEUE,
  KEY_STREAK,
  KEY_SUPERUSER_UNLOCKED,
  KEY_SUPERUSER_FLAGS,
  KEY_LAST_SEEN_VERSION,
  KEY_LEGACY_FAVOURITE_THEME,
  KEY_LEGACY_PRACTICE_SCOPE,
} from "./keys";

describe("localStorage key registry — byte-exact strings", () => {
  it("KEY_REVIEW_SESSION", () =>
    expect(KEY_REVIEW_SESSION).toBe("poke-memory:review-session:v1"));

  it("KEY_GRADE_LOG", () =>
    expect(KEY_GRADE_LOG).toBe("poke-memory:grade-log:v1"));

  it("KEY_DAILY_SUMMARY", () =>
    expect(KEY_DAILY_SUMMARY).toBe("poke-memory:daily-summary:v1"));

  it("KEY_SETTINGS", () =>
    expect(KEY_SETTINGS).toBe("poke-memory:settings:v1"));

  it("KEY_SETTINGS_LAST_PUSHED", () =>
    expect(KEY_SETTINGS_LAST_PUSHED).toBe("poke-memory:settings:last-pushed:v1"));

  it("KEY_SYNC_STATUS", () =>
    expect(KEY_SYNC_STATUS).toBe("poke-memory:sync-status:v1"));

  it("KEY_PENDING_GRADE_QUEUE", () =>
    expect(KEY_PENDING_GRADE_QUEUE).toBe("poke-memory:pending-grade-queue:v1"));

  it("KEY_STREAK", () =>
    expect(KEY_STREAK).toBe("poke-memory:streak:v1"));

  it("KEY_SUPERUSER_UNLOCKED", () =>
    expect(KEY_SUPERUSER_UNLOCKED).toBe("poke-memory:superuser"));

  it("KEY_SUPERUSER_FLAGS", () =>
    expect(KEY_SUPERUSER_FLAGS).toBe("poke-memory:superuser:flags:v1"));

  it("KEY_LAST_SEEN_VERSION", () =>
    expect(KEY_LAST_SEEN_VERSION).toBe("poke-memory:last-seen-version:v1"));

  it("KEY_LEGACY_FAVOURITE_THEME", () =>
    expect(KEY_LEGACY_FAVOURITE_THEME).toBe("poke-memory:favourite:v1"));

  it("KEY_LEGACY_PRACTICE_SCOPE", () =>
    expect(KEY_LEGACY_PRACTICE_SCOPE).toBe("poke-memory:practice-scope:v1"));
});

import { describe, it, expect } from "vitest";
import { STREAK_MILESTONES, findPendingMilestone } from "./milestones";

describe("STREAK_MILESTONES", () => {
  it("is sorted ascending", () => {
    const sorted = [...STREAK_MILESTONES].sort((a, b) => a - b);
    expect([...STREAK_MILESTONES]).toEqual(sorted);
  });

  it("contains no duplicates", () => {
    expect(new Set(STREAK_MILESTONES).size).toBe(STREAK_MILESTONES.length);
  });

  it("contains the expected values", () => {
    expect([...STREAK_MILESTONES]).toEqual([
      3, 7, 14, 30, 60, 100, 150, 200, 250, 365,
    ]);
  });

  it("has no gap larger than 120 days between consecutive milestones", () => {
    // The 250 → 365 gap is 115 days, which is the largest; post-365 gaps are
    // exactly 100 days. The ~100-day cap in the spec is approximate.
    for (let i = 1; i < STREAK_MILESTONES.length; i++) {
      const gap = STREAK_MILESTONES[i] - STREAK_MILESTONES[i - 1];
      expect(gap).toBeLessThanOrEqual(120);
    }
  });
});

describe("findPendingMilestone", () => {
  it("returns null for streak 0", () => {
    expect(findPendingMilestone(0, [])).toBeNull();
  });

  it("returns null when streak is below the smallest milestone", () => {
    expect(findPendingMilestone(2, [])).toBeNull();
  });

  it("returns the smallest milestone on the first crossing", () => {
    expect(findPendingMilestone(3, [])).toBe(3);
  });

  it("returns the next milestone when earlier ones are already seen", () => {
    expect(findPendingMilestone(7, [3])).toBe(7);
  });

  it("returns null when every reached milestone is in seen", () => {
    expect(findPendingMilestone(7, [3, 7])).toBeNull();
  });

  it("picks the smallest un-seen milestone (not the largest)", () => {
    // Streak 35 has crossed 3, 7, 14, 30. With only 3 and 7 seen, the next
    // celebration is 14 — not 30.
    expect(findPendingMilestone(35, [3, 7])).toBe(14);
  });

  it("returns the 60-day milestone when streak is 60 and earlier are seen", () => {
    expect(findPendingMilestone(60, [3, 7, 14, 30])).toBe(60);
  });

  it("returns null when all static milestones are seen and streak is exactly 365", () => {
    expect(
      findPendingMilestone(365, [3, 7, 14, 30, 60, 100, 150, 200, 250, 365]),
    ).toBeNull();
  });

  it("ignores unknown values in seen", () => {
    // Stale persisted values (e.g. an old milestone we no longer celebrate)
    // do not block the current milestone set.
    expect(findPendingMilestone(3, [99])).toBe(3);
  });

  // Post-365 tail tests
  it("returns 465 as the first post-365 milestone", () => {
    const allStatic = [3, 7, 14, 30, 60, 100, 150, 200, 250, 365];
    expect(findPendingMilestone(465, allStatic)).toBe(465);
  });

  it("returns null when streak is 400 (between 365 and 465)", () => {
    const allStatic = [3, 7, 14, 30, 60, 100, 150, 200, 250, 365];
    expect(findPendingMilestone(400, allStatic)).toBeNull();
  });

  it("returns 465 when streak is 500 and 465 has not been seen", () => {
    const allStatic = [3, 7, 14, 30, 60, 100, 150, 200, 250, 365];
    expect(findPendingMilestone(500, allStatic)).toBe(465);
  });

  it("returns 565 when streak is 600 and 465 has already been seen", () => {
    const allStaticPlus465 = [3, 7, 14, 30, 60, 100, 150, 200, 250, 365, 465];
    expect(findPendingMilestone(600, allStaticPlus465)).toBe(565);
  });

  it("post-365 milestones are every 100 days (465, 565, 665, …)", () => {
    const allStatic = [3, 7, 14, 30, 60, 100, 150, 200, 250, 365];
    const expected = [465, 565, 665, 765, 865];
    let seen = [...allStatic];
    for (const milestone of expected) {
      // Streak just at the milestone
      expect(findPendingMilestone(milestone, seen)).toBe(milestone);
      seen = [...seen, milestone];
    }
  });

  it("forceNextStreakMilestone path: returns first un-seen when streak is MAX_SAFE_INTEGER", () => {
    // StreakBadge passes Number.MAX_SAFE_INTEGER when forceNextStreakMilestone flag is on.
    expect(findPendingMilestone(Number.MAX_SAFE_INTEGER, [])).toBe(3);
    expect(findPendingMilestone(Number.MAX_SAFE_INTEGER, [3, 7])).toBe(14);
  });

  it("forceNextStreakMilestone: returns a post-365 milestone when all static are seen", () => {
    const allStatic = [3, 7, 14, 30, 60, 100, 150, 200, 250, 365];
    // With all static milestones seen and streak = MAX_SAFE_INTEGER, should
    // return 465 (the first post-365 milestone).
    expect(findPendingMilestone(Number.MAX_SAFE_INTEGER, allStatic)).toBe(465);
  });
});

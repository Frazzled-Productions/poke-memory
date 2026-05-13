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

  it("returns null when streak is far past all milestones but all are seen", () => {
    expect(findPendingMilestone(500, [3, 7, 14, 30, 100, 365])).toBeNull();
  });

  it("ignores unknown values in seen", () => {
    // Stale persisted values (e.g. an old milestone we no longer celebrate)
    // do not block the current milestone set.
    expect(findPendingMilestone(3, [99])).toBe(3);
  });
});

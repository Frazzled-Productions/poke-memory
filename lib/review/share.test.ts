import { describe, it, expect } from "vitest";
import { formatDailySummary } from "./share";

describe("formatDailySummary", () => {
  it("includes the date, counts, and grade grid", () => {
    const out = formatDailySummary({
      date: "2026-05-12",
      streak: 12,
      reviewed: 5,
      newCards: 1,
      mastered: 2,
      gradeSequence: [4, 4, 5, 1, 4],
    });
    expect(out).toContain("poke-memory · 2026-05-12");
    expect(out).toContain("12-day streak 🔥");
    expect(out).toContain("5 reviewed · 1 new · 2 mastered");
    // 4 → 🟩, 5 → 🟦, 1 → ⬛
    expect(out).toContain("🟩🟩🟦⬛🟩");
  });

  it("omits the streak line when streak is zero", () => {
    const out = formatDailySummary({
      date: "2026-05-12",
      streak: 0,
      reviewed: 1,
      newCards: 0,
      mastered: 0,
      gradeSequence: [4],
    });
    expect(out).not.toContain("streak");
  });

  it("wraps the grid every 20 squares", () => {
    const seq = Array.from({ length: 25 }, () => 4) as readonly (1 | 2 | 4 | 5)[];
    const out = formatDailySummary({
      date: "2026-05-12",
      streak: 1,
      reviewed: 25,
      newCards: 0,
      mastered: 0,
      gradeSequence: seq,
    });
    const lines = out.split("\n");
    // 3 header lines + 2 grid lines
    expect(lines).toHaveLength(5);
    // Each square is one emoji; 20 squares per first grid line, 5 on the second.
    const gridLines = lines.slice(3);
    expect([...gridLines[0]].filter((c) => c === "🟩").length).toBe(20);
    expect([...gridLines[1]].filter((c) => c === "🟩").length).toBe(5);
  });
});

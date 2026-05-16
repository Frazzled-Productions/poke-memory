import type { GradeLog } from "@/lib/gradelog/persistence";
import { isoDate } from "@/lib/utils/format-date";

export type HeatmapCell = {
  date: string;   // YYYY-MM-DD
  count: number;
};

/**
 * GitHub-style 53-week × 7-day heatmap rolling backward from `today`.
 * The grid is column-major: `cells[col][row]` where `col` is the week
 * index (0 = oldest) and `row` is the weekday index. Empty cells (dates
 * before the user's history begins) are filled with `count: 0`.
 *
 * Weeks are aligned to the user's local week — column N covers Sun…Sat
 * (Sunday-start) when `weekStart === 0`, Mon…Sun when `weekStart === 1`.
 * The default is 0 (Sunday-start) which matches the GitHub layout.
 */
export function computeReviewHeatmap(
  log: GradeLog,
  today: string,
  weekStart: 0 | 1 = 0,
): HeatmapCell[][] {
  const perDay = new Map<string, number>();
  for (const e of log) {
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1);
  }

  // Anchor on the *end* of the most recent visible week, so today always
  // appears in the rightmost column at its correct weekday.
  const todayDate = new Date(today + "T00:00:00Z");
  const todayDow = todayDate.getUTCDay(); // 0 = Sun..6 = Sat
  const daysToEndOfWeek = ((6 - (todayDow - weekStart)) + 7) % 7;

  const endOfWeek = new Date(todayDate);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysToEndOfWeek);

  const totalCells = 53 * 7;
  const cells: HeatmapCell[] = [];
  for (let i = totalCells - 1; i >= 0; i--) {
    const d = new Date(endOfWeek);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = isoDate(d);
    cells.push({ date: iso, count: perDay.get(iso) ?? 0 });
  }

  // Reshape into 53 columns of 7 rows. Row 0 of each column corresponds
  // to `weekStart` weekday.
  const columns: HeatmapCell[][] = [];
  for (let col = 0; col < 53; col++) {
    columns.push(cells.slice(col * 7, col * 7 + 7));
  }
  return columns;
}

/**
 * Bucket a daily review count into a 0..4 intensity. The buckets
 * cap near the default per-day review limit (100) so a power user
 * doesn't see the whole chart saturate.
 */
export function intensityBucket(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count < 10) return 1;
  if (count < 50) return 2;
  if (count < 100) return 3;
  return 4;
}

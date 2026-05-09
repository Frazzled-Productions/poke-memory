import { STREAK_KEY } from "./types";
import type { StreakData } from "./types";

export function loadStreakData(): StreakData {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
      return [];
    }
    return parsed as StreakData;
  } catch {
    return [];
  }
}

export function saveStreakData(data: StreakData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STREAK_KEY, JSON.stringify(data));
}

export function recordReview(date: string): void {
  const data = loadStreakData();
  if (data.includes(date)) return;
  data.push(date);
  data.sort();
  saveStreakData(data);
}

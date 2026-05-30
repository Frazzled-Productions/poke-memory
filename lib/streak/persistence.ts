import type { StreakData } from "./types";
import { KEY_STREAK } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";

const STREAK_KEY = KEY_STREAK;
export const STREAK_UPDATED_EVENT = "poke-memory:streak-updated";

// Minimum graded cards in a day for the day to count toward the streak.
// "Due queue empty" overrides this for users with a light queue. See #351.
export const STREAK_MIN_CARDS = 5;

export function loadStreakData(): StreakData {
  return readLocalStorage(
    STREAK_KEY,
    (raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
        return [];
      }
      return parsed as StreakData;
    },
    [],
  );
}

export function saveStreakData(data: StreakData): void {
  writeLocalStorage(STREAK_KEY, data);
}

export function recordReview(
  date: string,
  gradedToday: number,
  dueQueueEmpty: boolean,
): void {
  if (gradedToday < STREAK_MIN_CARDS && !dueQueueEmpty) return;
  const data = loadStreakData();
  if (data.includes(date)) return;
  data.push(date);
  data.sort();
  saveStreakData(data);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
  }
}

/**
 * Deterministic synthetic grade log for optimiser tests (#2392).
 *
 * Simulates one learner studying with the app's habits: new cards go through
 * same-day learning steps (Again/Hard re-shown minutes later until Good), and
 * graduated cards come back on a growing interval, lapsing with a probability
 * taken from the FSRS power forgetting curve. The output has the shape
 * `pullGradeLog` returns (one `GradeLogEntry` per grade, with `subjectKey` and
 * `locale`), so tests exercise the real item-building path. No real user data.
 */

import type { GradeLogEntry } from "@/lib/gradelog/persistence";

const DAY_MS = 86_400_000;
const STEP_MS = 10 * 60 * 1000;

type Options = {
  /** Number of study days to simulate. */
  days?: number;
  /** New cards introduced per study day. */
  newPerDay?: number;
  /** RNG seed, so the log is identical on every run. */
  seed?: number;
  /** Epoch ms of the first study session. */
  start?: number;
};

type SimCard = {
  key: string;
  stability: number;
  dueDay: number;
  lastDay: number;
};

/** Small linear congruential generator: deterministic and dependency-free. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function syntheticGradeLog({
  days = 120,
  newPerDay = 12,
  seed = 7,
  start = Date.UTC(2026, 0, 1, 9, 0, 0),
}: Options = {}): GradeLogEntry[] {
  const rnd = makeRng(seed);
  const entries: GradeLogEntry[] = [];
  const cards: SimCard[] = [];
  let nextId = 1;

  const push = (key: string, at: number, grade: GradeLogEntry["grade"]) => {
    entries.push({
      occurredAt: at,
      date: new Date(at).toISOString().slice(0, 10),
      grade,
      cardType: "name",
      subjectKey: key,
      locale: "en",
    });
  };

  for (let day = 0; day < days; day++) {
    // Sessions start at a slightly different time each day.
    let t = start + day * DAY_MS + Math.floor(rnd() * 3 * 60 * 60 * 1000);

    // Due reviews first.
    for (const card of cards) {
      if (card.dueDay !== day) continue;
      const elapsed = day - card.lastDay;
      const recall = Math.pow(1 + elapsed / (9 * card.stability), -1);
      t += 20_000;
      if (rnd() < recall) {
        const r = rnd();
        const grade: GradeLogEntry["grade"] = r < 0.1 ? 2 : r < 0.9 ? 4 : 5;
        push(card.key, t, grade);
        card.stability *= grade === 2 ? 1.3 : grade === 4 ? 2.4 : 3.5;
      } else {
        push(card.key, t, 1);
        // Relearning step later in the same session.
        push(card.key, t + STEP_MS, 4);
        card.stability = Math.max(0.5, card.stability * 0.3);
      }
      card.lastDay = day;
      card.dueDay = day + Math.max(1, Math.round(card.stability));
    }

    // New cards with same-day learning steps.
    for (let n = 0; n < newPerDay; n++) {
      const key = String(nextId++);
      t += 30_000;
      let at = t;
      let r = rnd();
      while (r < 0.45) {
        push(key, at, r < 0.3 ? 1 : 2);
        at += STEP_MS;
        r = rnd();
      }
      const easy = r > 0.95;
      push(key, at, easy ? 5 : 4);
      cards.push({
        key,
        stability: easy ? 4 : 1,
        lastDay: day,
        dueDay: day + (easy ? 4 : 1),
      });
    }
  }

  return entries.sort((a, b) => a.occurredAt - b.occurredAt);
}

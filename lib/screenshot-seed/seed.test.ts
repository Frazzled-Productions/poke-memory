/**
 * Unit tests for the screenshot seed builder (scripts/screenshot-seed.mjs).
 *
 * Verifies the determinism guarantees and expected card/grade-log counts
 * so CI can catch regressions in the seed without running Playwright.
 *
 * Placed in lib/ so the node vitest project picks it up; the test imports
 * the script directly using a relative path (allowJs: true in tsconfig).
 */

import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – importing an .mjs script; no TypeScript declarations needed here
import { buildScreenshotSeed } from "../../scripts/screenshot-seed.mjs";

// ─── Types ───────────────────────────────────────────────────────────────────

type CardState = {
  stability: number;
  reps: number;
  scheduledDays: number;
  learningStep: number | null;
  stepStartedAt: number | null;
  lastReview: string | null;
  dueDate: string;
  seenInPasture: boolean;
  fsrsState: string;
};

type Card = {
  cardType: string;
  id: number;
  state: CardState;
};

type Seed = {
  session: { cards: Card[]; limits: object };
  gradeLog: Array<{ date: string; grade: number; cardType: string; occurredAt: number }>;
  streakDates: string[];
  keys: Record<string, string>;
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildScreenshotSeed()", () => {
  it("returns a seed object with session, gradeLog, streakDates, and keys", () => {
    const seed: Seed = buildScreenshotSeed();
    expect(seed).toHaveProperty("session");
    expect(seed).toHaveProperty("gradeLog");
    expect(seed).toHaveProperty("streakDates");
    expect(seed).toHaveProperty("keys");
  });

  describe("session.cards", () => {
    it("is a non-empty array", () => {
      const { session } = buildScreenshotSeed() as Seed;
      expect(Array.isArray(session.cards)).toBe(true);
      expect(session.cards.length).toBeGreaterThan(0);
    });

    it("contains at least 30 mastered name cards (reps >= 3, scheduledDays >= 21)", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const mastered = session.cards.filter(
        (c) => c.cardType === "name" && c.state.reps >= 3 && c.state.scheduledDays >= 21,
      );
      expect(mastered.length).toBeGreaterThanOrEqual(30);
    });

    it("contains at least 30 mastered reverse cards alongside mastered name cards", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const mastered = session.cards.filter(
        (c) => c.cardType === "reverse" && c.state.reps >= 3 && c.state.scheduledDays >= 21,
      );
      expect(mastered.length).toBeGreaterThanOrEqual(30);
    });

    it("contains at least 10 in-learning cards (learningStep !== null)", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const learning = session.cards.filter(
        (c) => c.state.learningStep !== null,
      );
      expect(learning.length).toBeGreaterThanOrEqual(10);
    });

    it("contains at least 15 in-progress cards (reps >= 1, scheduledDays < 21)", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const inProgress = session.cards.filter(
        (c) => c.state.reps >= 1 && c.state.scheduledDays < 21,
      );
      expect(inProgress.length).toBeGreaterThanOrEqual(15);
    });

    it("includes Pikachu (#25) as a name card with learningStep: 0 and null stepStartedAt sentinel", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const pikachu = session.cards.find(
        (c) => c.id === 25 && c.cardType === "name",
      );
      expect(pikachu).toBeDefined();
      expect(pikachu!.state.learningStep).toBe(0);
      // stepStartedAt is null in the static payload; the capture script
      // replaces it with Date.now() - 120_000 before writing to the page.
      expect(pikachu!.state.stepStartedAt).toBeNull();
      expect(pikachu!.state.lastReview).toBeNull();
      // stability must be >= ts-fsrs S_MIN (0.001) so previewIntervals does not
      // throw "Invalid memory state" when computing grade button labels.
      expect(pikachu!.state.stability).toBeGreaterThanOrEqual(1);
    });

    it("all in-learning cards have stability >= 1 (ts-fsrs S_MIN guard)", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const learningCards = session.cards.filter(
        (c) => c.state.learningStep !== null,
      );
      for (const card of learningCards) {
        expect(card.state.stability).toBeGreaterThanOrEqual(1);
      }
    });

    it("has no duplicate card IDs", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const ids = session.cards.map((c) => c.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("all date strings match YYYY-MM-DD format", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      for (const card of session.cards) {
        expect(card.state.dueDate).toMatch(dateRegex);
        if (card.state.lastReview !== null) {
          expect(card.state.lastReview).toMatch(dateRegex);
        }
      }
    });

    it("mastered cards have seenInPasture: true", () => {
      const { session } = buildScreenshotSeed() as Seed;
      const masteredCards = session.cards.filter(
        (c) => c.state.reps >= 3 && c.state.scheduledDays >= 21,
      );
      for (const card of masteredCards) {
        expect(card.state.seenInPasture).toBe(true);
      }
    });
  });

  describe("gradeLog", () => {
    it("contains at least 300 entries (covering ~30 days)", () => {
      const { gradeLog } = buildScreenshotSeed() as Seed;
      expect(gradeLog.length).toBeGreaterThanOrEqual(300);
    });

    it("covers at least 30 distinct dates", () => {
      const { gradeLog } = buildScreenshotSeed() as Seed;
      const dates = new Set(gradeLog.map((e) => e.date));
      expect(dates.size).toBeGreaterThanOrEqual(30);
    });

    it("all grades are valid (1, 2, 4, or 5)", () => {
      const { gradeLog } = buildScreenshotSeed() as Seed;
      for (const entry of gradeLog) {
        expect([1, 2, 4, 5]).toContain(entry.grade);
      }
    });

    it("all occurredAt values are deterministic integer timestamps", () => {
      const { gradeLog } = buildScreenshotSeed() as Seed;
      for (const entry of gradeLog) {
        expect(typeof entry.occurredAt).toBe("number");
        expect(Number.isInteger(entry.occurredAt)).toBe(true);
      }
    });
  });

  describe("streakDates", () => {
    it("contains exactly 15 dates", () => {
      const { streakDates } = buildScreenshotSeed() as Seed;
      expect(streakDates.length).toBe(15);
    });

    it("all dates match YYYY-MM-DD format", () => {
      const { streakDates } = buildScreenshotSeed() as Seed;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      for (const d of streakDates) {
        expect(d).toMatch(dateRegex);
      }
    });

    it("dates are in ascending chronological order", () => {
      const { streakDates } = buildScreenshotSeed() as Seed;
      for (let i = 1; i < streakDates.length; i++) {
        expect(streakDates[i] > streakDates[i - 1]).toBe(true);
      }
    });
  });

  describe("determinism", () => {
    it("produces identical card IDs on consecutive calls", () => {
      const a = buildScreenshotSeed() as Seed;
      const b = buildScreenshotSeed() as Seed;
      const idsA = a.session.cards.map((c: Card) => c.id).join(",");
      const idsB = b.session.cards.map((c: Card) => c.id).join(",");
      expect(idsA).toBe(idsB);
    });

    it("produces identical grade log length on consecutive calls", () => {
      const a = buildScreenshotSeed() as Seed;
      const b = buildScreenshotSeed() as Seed;
      expect(a.gradeLog.length).toBe(b.gradeLog.length);
    });

    it("produces identical streak dates on consecutive calls", () => {
      const a = buildScreenshotSeed() as Seed;
      const b = buildScreenshotSeed() as Seed;
      expect(a.streakDates.join(",")).toBe(b.streakDates.join(","));
    });

    it("grade log occurredAt values are identical on consecutive calls", () => {
      const a = buildScreenshotSeed() as Seed;
      const b = buildScreenshotSeed() as Seed;
      const tsA = a.gradeLog.map((e) => e.occurredAt).join(",");
      const tsB = b.gradeLog.map((e) => e.occurredAt).join(",");
      expect(tsA).toBe(tsB);
    });
  });

  describe("keys", () => {
    it("exports all required storage key strings", () => {
      const { keys } = buildScreenshotSeed() as Seed;
      const required = [
        "KEY_REVIEW_SESSION",
        "KEY_GRADE_LOG",
        "KEY_STREAK",
        "KEY_SETTINGS",
        "KEY_HAS_MASTERED",
        "KEY_CLIENT_SALT",
        "KEY_SUPERUSER",
        "KEY_SUPERUSER_FLAGS",
      ];
      for (const k of required) {
        expect(typeof keys[k]).toBe("string");
        expect(keys[k].startsWith("poke-memory:")).toBe(true);
      }
    });
  });
});

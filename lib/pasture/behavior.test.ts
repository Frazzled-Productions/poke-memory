/**
 * Unit tests for lib/pasture/behavior.ts — node project (no DOM).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSpriteState,
  tickSprite,
  TICK_INTERVAL_MS,
} from "./behavior";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BAND = { x0: 0.1, x1: 0.9, y0: 0.6, y1: 0.9 };
const ANCHOR = { x: 0.5, y: 0.75 };

function makeState(now = 0) {
  return createSpriteState(
    ANCHOR.x,
    ANCHOR.y,
    BAND.x0,
    BAND.x1,
    BAND.y0,
    BAND.y1,
    now,
  );
}

// ---------------------------------------------------------------------------
// Throttle gate
// ---------------------------------------------------------------------------

describe("tickSprite — throttle gate", () => {
  it("returns changed: false within TICK_INTERVAL_MS", () => {
    const now = 1000;
    const state = makeState(now);
    // Advance by less than the interval.
    const result = tickSprite(state, now + TICK_INTERVAL_MS - 1);
    expect(result.changed).toBe(false);
  });

  it("returns changed: true at exactly TICK_INTERVAL_MS", () => {
    const now = 1000;
    const state = makeState(now);
    const result = tickSprite(state, now + TICK_INTERVAL_MS);
    expect(result.changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wander — band bounds
// ---------------------------------------------------------------------------

describe("tickSprite — wander stays within band", () => {
  beforeEach(() => {
    // Make Math.random always return 1.0 (forces extreme target picks).
    vi.spyOn(Math, "random").mockReturnValue(0.999);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("x stays within [bandX0, bandX1] over many ticks", () => {
    const state = makeState(0);
    // Force nextTargetAt to trigger immediately.
    state.nextTargetAt = 0;
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += TICK_INTERVAL_MS;
      tickSprite(state, t);
      expect(state.x).toBeGreaterThanOrEqual(BAND.x0);
      expect(state.x).toBeLessThanOrEqual(BAND.x1);
    }
  });

  it("y stays within [bandY0, bandY1] over many ticks", () => {
    const state = makeState(0);
    state.nextTargetAt = 0;
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += TICK_INTERVAL_MS;
      tickSprite(state, t);
      expect(state.y).toBeGreaterThanOrEqual(BAND.y0);
      expect(state.y).toBeLessThanOrEqual(BAND.y1);
    }
  });
});

// ---------------------------------------------------------------------------
// Wander — easing convergence
// ---------------------------------------------------------------------------

describe("tickSprite — easing converges to target", () => {
  it("x approaches targetX over many ticks", () => {
    const state = makeState(0);
    // Set a fixed target and prevent it from changing.
    state.targetX = 0.9;
    state.nextTargetAt = Number.POSITIVE_INFINITY;

    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += TICK_INTERVAL_MS;
      tickSprite(state, t);
    }
    // After 200 ticks (~24s of simulated time), should be very close.
    expect(Math.abs(state.x - state.targetX)).toBeLessThan(0.01);
  });

  it("y approaches targetY over many ticks", () => {
    const state = makeState(0);
    state.targetY = 0.85;
    state.nextTargetAt = Number.POSITIVE_INFINITY;

    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += TICK_INTERVAL_MS;
      tickSprite(state, t);
    }
    expect(Math.abs(state.y - state.targetY)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// Jump phases
// ---------------------------------------------------------------------------

describe("tickSprite — jump phase sequencing", () => {
  it("transitions grounded → rising → falling → squash → grounded", () => {
    const now = 0;
    const state = makeState(now);
    // Force the jump to trigger on the very first eligible tick.
    state.nextJumpAt = 0;
    state.nextTargetAt = Number.POSITIVE_INFINITY;

    // Tick 1 — should enter rising.
    tickSprite(state, now + TICK_INTERVAL_MS);
    expect(state.jumpPhase).toBe("rising");
    expect(state.jumpOffsetPx).toBeLessThanOrEqual(0); // negative = upward

    // Advance past the rising phase (280ms).
    tickSprite(state, now + TICK_INTERVAL_MS + 290);
    expect(state.jumpPhase).toBe("falling");

    // Advance past the falling phase (200ms).
    tickSprite(state, now + TICK_INTERVAL_MS + 290 + 210);
    expect(state.jumpPhase).toBe("squash");
    expect(state.squashX).toBeGreaterThan(1);
    expect(state.squashY).toBeLessThan(1);

    // Advance past the squash phase (120ms).
    tickSprite(state, now + TICK_INTERVAL_MS + 290 + 210 + 130);
    expect(state.jumpPhase).toBe("grounded");
    expect(state.jumpOffsetPx).toBe(0);
    expect(state.squashX).toBe(1);
    expect(state.squashY).toBe(1);
  });

  it("jumpOffsetPx is negative (upward) during rising phase", () => {
    const now = 0;
    const state = makeState(now);
    state.nextJumpAt = 0;
    state.nextTargetAt = Number.POSITIVE_INFINITY;

    // Enter rising phase.
    tickSprite(state, now + TICK_INTERVAL_MS);
    expect(state.jumpPhase).toBe("rising");

    // Mid-rise — offset should be negative.
    tickSprite(state, now + TICK_INTERVAL_MS + 140);
    expect(state.jumpOffsetPx).toBeLessThan(0);
  });

  it("does not start a new jump while not grounded", () => {
    const now = 0;
    const state = makeState(now);
    state.nextJumpAt = 0;
    state.nextTargetAt = Number.POSITIVE_INFINITY;

    // Start a jump.
    tickSprite(state, now + TICK_INTERVAL_MS);
    expect(state.jumpPhase).toBe("rising");

    // Set nextJumpAt in the past — should not interrupt current jump.
    state.nextJumpAt = 0;
    tickSprite(state, now + TICK_INTERVAL_MS * 2);
    // Phase must not reset to grounded (or re-trigger rising) mid-sequence.
    expect(state.jumpPhase).toBe("rising");
  });

  it("returns changed: true when jump phase is active", () => {
    const now = 0;
    const state = makeState(now);
    state.nextJumpAt = 0;
    state.nextTargetAt = Number.POSITIVE_INFINITY;

    const result = tickSprite(state, now + TICK_INTERVAL_MS);
    expect(result.changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createSpriteState initial values
// ---------------------------------------------------------------------------

describe("createSpriteState", () => {
  it("starts at the anchor position", () => {
    const state = makeState(0);
    expect(state.x).toBe(ANCHOR.x);
    expect(state.y).toBe(ANCHOR.y);
  });

  it("starts in the grounded phase with no jump offset", () => {
    const state = makeState(0);
    expect(state.jumpPhase).toBe("grounded");
    expect(state.jumpOffsetPx).toBe(0);
  });

  it("band values are stored correctly", () => {
    const state = makeState(0);
    expect(state.bandX0).toBe(BAND.x0);
    expect(state.bandX1).toBe(BAND.x1);
    expect(state.bandY0).toBe(BAND.y0);
    expect(state.bandY1).toBe(BAND.y1);
  });
});

/**
 * Pure tick math for Pasture idle behaviour (#402).
 *
 * No React, no DOM — only deterministic state mutations so this module is
 * fully unit-testable in a Node environment.
 *
 * Coordinates are fractional [0, 1] within the zone container, matching
 * the AnchorSlot convention already used by zones.ts.
 *
 * Jump offset is in CSS pixels (applied as translateY on the wander wrapper).
 * Squash/stretch axes are unitless scale factors.
 */

/** ~8 Hz update rate — cheap on mobile Safari with many sprites. */
export const TICK_INTERVAL_MS = 120;

/** Jump phase state machine. */
type JumpPhase = "grounded" | "rising" | "falling" | "squash";

/** Per-sprite mutable state. Mutated in-place by tickSprite. */
export type SpriteState = {
  /** Current fractional x position within zone container. */
  x: number;
  /** Current fractional y position within zone container. */
  y: number;
  /** Original anchor fractional x — used as zero-point for translate delta. */
  readonly anchorX: number;
  /** Original anchor fractional y — used as zero-point for translate delta. */
  readonly anchorY: number;
  /** Wander target fractional x. */
  targetX: number;
  /** Wander target fractional y. */
  targetY: number;
  /** Timestamp after which a new wander target is chosen. */
  nextTargetAt: number;
  /** Timestamp when the current jump was initiated. */
  jumpStartedAt: number;
  /** Timestamp after which the next jump may start. */
  nextJumpAt: number;
  /** Current jump phase. */
  jumpPhase: JumpPhase;
  /** Vertical offset in CSS px from the jump (applied on top of anchor y). */
  jumpOffsetPx: number;
  /** Horizontal scale factor for squash/stretch. */
  squashX: number;
  /** Vertical scale factor for squash/stretch. */
  squashY: number;
  /** Allowed wander band — fractional x min. */
  bandX0: number;
  /** Allowed wander band — fractional x max. */
  bandX1: number;
  /** Allowed wander band — fractional y min. */
  bandY0: number;
  /** Allowed wander band — fractional y max. */
  bandY1: number;
  /** Timestamp of the last tick that produced an update. */
  lastTickAt: number;
};

/** Return from tickSprite — only the values the DOM layer needs. */
export type TickResult = {
  x: number;
  y: number;
  jumpOffsetPx: number;
  squashX: number;
  squashY: number;
  /** True when values changed and a DOM write is warranted. */
  changed: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Seeded-ish random via Math.random — no state needed for this use case. */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Easing constant — higher → faster convergence. */
const EASE_K = 1.5;

/** Parabola height at peak in CSS px. */
const JUMP_PEAK_PX = 18;

/** Jump phase durations in ms. */
const RISING_MS = 280;
const FALLING_MS = 200;
const SQUASH_MS = 120;

/** Squash-on-landing scale values. */
const SQUASH_SCALE_X = 1.2;
const SQUASH_SCALE_Y = 0.75;

/** Arrival epsilon — stop easing when this close (fractional coords). */
const ARRIVE_EPS = 0.005;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates initial SpriteState for a sprite placed at (anchorX, anchorY),
 * allowed to wander within the band [bandX0, bandX1] × [bandY0, bandY1].
 *
 * `now` is the current `performance.now()` value.
 */
export function createSpriteState(
  anchorX: number,
  anchorY: number,
  bandX0: number,
  bandX1: number,
  bandY0: number,
  bandY1: number,
  now: number,
): SpriteState {
  return {
    x: anchorX,
    y: anchorY,
    anchorX,
    anchorY,
    targetX: anchorX,
    targetY: anchorY,
    // Stagger first target pick so not all sprites move simultaneously.
    nextTargetAt: now + rand(0, 8000),
    jumpStartedAt: 0,
    // Stagger first jump similarly.
    nextJumpAt: now + rand(3000, 18000),
    jumpPhase: "grounded",
    jumpOffsetPx: 0,
    squashX: 1,
    squashY: 1,
    bandX0,
    bandX1,
    bandY0,
    bandY1,
    lastTickAt: now,
  };
}

/**
 * Advances sprite state by one tick. Mutates `state` in place and returns the
 * values needed to update the DOM.
 *
 * Returns `changed: false` when `now - state.lastTickAt < TICK_INTERVAL_MS`
 * (throttle gate) so the caller can skip the DOM write.
 */
export function tickSprite(state: SpriteState, now: number): TickResult {
  // Throttle gate.
  if (now - state.lastTickAt < TICK_INTERVAL_MS) {
    return {
      x: state.x,
      y: state.y,
      jumpOffsetPx: state.jumpOffsetPx,
      squashX: state.squashX,
      squashY: state.squashY,
      changed: false,
    };
  }

  const dt = (now - state.lastTickAt) / 1000; // seconds
  state.lastTickAt = now;

  // ------------------------------------------------------------------
  // Wander — pick a new target when due, ease toward current target.
  // ------------------------------------------------------------------
  if (now >= state.nextTargetAt) {
    state.targetX = rand(state.bandX0, state.bandX1);
    state.targetY = rand(state.bandY0, state.bandY1);
    state.nextTargetAt = now + rand(4000, 12000);
  }

  const dxFrac = state.targetX - state.x;
  const dyFrac = state.targetY - state.y;
  const factor = 1 - Math.exp(-EASE_K * dt);

  if (Math.abs(dxFrac) > ARRIVE_EPS) {
    state.x += dxFrac * factor;
  } else {
    state.x = state.targetX;
  }

  if (Math.abs(dyFrac) > ARRIVE_EPS) {
    state.y += dyFrac * factor;
  } else {
    state.y = state.targetY;
  }

  // Clamp to band bounds in case of floating-point drift.
  state.x = Math.max(state.bandX0, Math.min(state.bandX1, state.x));
  state.y = Math.max(state.bandY0, Math.min(state.bandY1, state.y));

  // ------------------------------------------------------------------
  // Jump — phase state machine.
  // ------------------------------------------------------------------
  if (state.jumpPhase === "grounded" && now >= state.nextJumpAt) {
    state.jumpPhase = "rising";
    state.jumpStartedAt = now;
  }

  switch (state.jumpPhase) {
    case "rising": {
      const elapsed = now - state.jumpStartedAt;
      if (elapsed >= RISING_MS) {
        // Transition to falling at exactly the peak — no discontinuity.
        state.jumpPhase = "falling";
        state.jumpStartedAt = now;
        state.jumpOffsetPx = -JUMP_PEAK_PX; // peak is the falling start point
        state.squashX = 1;
        state.squashY = 1;
      } else {
        // Ease-in arc: sin(t * π/2) reaches 1.0 at t=1, so the last rising
        // tick lands at the exact peak and the falling phase starts there with
        // no discontinuity regardless of tick interval.
        const t = elapsed / RISING_MS;
        state.jumpOffsetPx = -JUMP_PEAK_PX * Math.sin(t * (Math.PI / 2));
        state.squashX = 1;
        state.squashY = 1;
      }
      break;
    }
    case "falling": {
      const elapsed = now - state.jumpStartedAt;
      if (elapsed >= FALLING_MS) {
        // Transition to squash on landing.
        state.jumpPhase = "squash";
        state.jumpStartedAt = now;
        state.jumpOffsetPx = 0;
        state.squashX = SQUASH_SCALE_X;
        state.squashY = SQUASH_SCALE_Y;
      } else {
        const t = elapsed / FALLING_MS;
        // Ease-out drop: starts at peak (-JUMP_PEAK_PX) and decelerates to 0.
        state.jumpOffsetPx = -JUMP_PEAK_PX * (1 - t * t);
        state.squashX = 1;
        state.squashY = 1;
      }
      break;
    }
    case "squash": {
      const elapsed = now - state.jumpStartedAt;
      if (elapsed >= SQUASH_MS) {
        // Return to grounded and schedule next jump.
        state.jumpPhase = "grounded";
        state.jumpOffsetPx = 0;
        state.squashX = 1;
        state.squashY = 1;
        state.nextJumpAt = now + rand(5000, 20000);
      } else {
        // Interpolate squash back toward identity.
        const t = elapsed / SQUASH_MS;
        state.squashX = SQUASH_SCALE_X + (1 - SQUASH_SCALE_X) * t;
        state.squashY = SQUASH_SCALE_Y + (1 - SQUASH_SCALE_Y) * t;
      }
      break;
    }
    case "grounded":
    default:
      // Nothing to do — waiting for nextJumpAt.
      break;
  }

  return {
    x: state.x,
    y: state.y,
    jumpOffsetPx: state.jumpOffsetPx,
    squashX: state.squashX,
    squashY: state.squashY,
    changed: true,
  };
}

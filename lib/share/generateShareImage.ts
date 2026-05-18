/**
 * Client-side canvas image generator for share cards.
 *
 * All rendering is spoiler-safe — no Pokémon names or sprites appear.
 * The card shows: logo text, date/milestone label, stat counts, and the
 * abstract grade grid (colour-coded squares, not emoji).
 *
 * Runs only in a browser context (needs `document.createElement`).
 */

import type { Grade } from "@/lib/srs/scheduler";
import type { DailySummaryParts } from "@/lib/review/share";

export type MilestoneShareData = {
  /** Human-readable milestone label, e.g. "100 Pokémon mastered". */
  label: string;
  /** Pre-formatted plain share text (kept for the text-only fallback path). */
  shareText: string;
};

// Re-export DailySummaryParts so callers can use a single import path.
export type { DailySummaryParts };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Card dimensions (CSS pixels, high-DPI-aware at 2×)
const SCALE = 2;
const CARD_W = 400;
const CARD_H_BASE = 240; // grows with grade grid rows
const GRID_COLS = 20;
const SQUARE_SIZE = 12;
const SQUARE_GAP = 3;
const GRID_STRIDE = SQUARE_SIZE + SQUARE_GAP;

// Grade colours
const GRADE_COLOUR: Record<Grade, string> = {
  5: "#3b82f6", // blue-500
  4: "#22c55e", // green-500
  2: "#eab308", // yellow-500
  1: "#71717a", // zinc-500
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gridRowCount(seqLen: number): number {
  if (seqLen === 0) return 0;
  return Math.ceil(seqLen / GRID_COLS);
}

function cardHeight(seqLen: number): number {
  const rows = gridRowCount(seqLen);
  const gridH = rows > 0 ? rows * GRID_STRIDE - SQUARE_GAP : 0;
  return CARD_H_BASE + (rows > 0 ? gridH + 24 : 0);
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Core card painter (shared between daily and milestone cards)
// ---------------------------------------------------------------------------

type PaintOptions = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Top heading line (app name). */
  heading: string;
  /** Second line — date or milestone label. */
  subheading: string;
  /** Optional third line — stat counts. */
  statsLine?: string;
  /** Optional fourth line — streak. */
  streakLine?: string;
  /** Grade sequence for the bottom grid. Empty array → no grid. */
  gradeSequence?: readonly Grade[];
};

function paintCard(opts: PaintOptions): void {
  const {
    ctx,
    w,
    h,
    heading,
    subheading,
    statsLine,
    streakLine,
    gradeSequence = [],
  } = opts;

  // Scale for high-DPI
  ctx.scale(SCALE, SCALE);

  // Cards are always light-themed (dark support removed — see #962).
  const bgColour = "#ffffff";
  const borderColour = "#e4e4e7";
  const headingColour = "#18181b";
  const subColour = "#71717a";
  const statsColour = "#18181b";
  const streakColour = "#d97706"; // amber
  const brandColour = "#e11d48"; // rose-600 (matches site logo)

  // --- Background card ---
  ctx.fillStyle = bgColour;
  drawRoundRect(ctx, 0, 0, w, h, 16);
  ctx.fill();

  // Border
  ctx.strokeStyle = borderColour;
  ctx.lineWidth = 1;
  drawRoundRect(ctx, 0.5, 0.5, w - 1, h - 1, 16);
  ctx.stroke();

  // --- Brand stripe at top ---
  ctx.fillStyle = brandColour;
  drawRoundRect(ctx, 0, 0, w, 6, 3);
  ctx.fill();
  // square off the bottom corners of the stripe
  ctx.fillRect(0, 3, w, 3);

  let y = 34;

  // --- Heading (app name) ---
  ctx.fillStyle = headingColour;
  ctx.font = `700 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(heading, 24, y);
  y += 28;

  // --- Subheading (date or milestone) ---
  ctx.fillStyle = subColour;
  ctx.font = `400 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillText(subheading, 24, y);
  y += 22;

  // --- Streak line ---
  if (streakLine) {
    ctx.fillStyle = streakColour;
    ctx.font = `600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(streakLine, 24, y);
    y += 22;
  }

  // --- Stats line ---
  if (statsLine) {
    ctx.fillStyle = statsColour;
    ctx.font = `400 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(statsLine, 24, y);
    y += 28;
  } else {
    y += 6;
  }

  // --- Grade grid ---
  if (gradeSequence.length > 0) {
    for (let i = 0; i < gradeSequence.length; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const gx = 24 + col * GRID_STRIDE;
      const gy = y + row * GRID_STRIDE;
      ctx.fillStyle = GRADE_COLOUR[gradeSequence[i]];
      drawRoundRect(ctx, gx, gy, SQUARE_SIZE, SQUARE_SIZE, 2);
      ctx.fill();
    }
  }

  // --- URL footer ---
  const footerY = h - 14;
  ctx.fillStyle = subColour;
  ctx.font = `400 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("pokememory.com", 24, footerY);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a daily summary share card to a PNG Blob.
 * Returns `null` if canvas is not available (SSR / restricted environment).
 */
export async function generateDailyShareImage(
  data: DailySummaryParts,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const h = cardHeight(data.gradeSequence.length);
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * SCALE;
  canvas.height = h * SCALE;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const streakLine =
    data.streak > 0 ? `${data.streak}-day streak` : undefined;
  const statsLine = `${data.reviewed} reviewed · ${data.newCards} new · ${data.mastered} mastered`;

  paintCard({
    ctx,
    w: CARD_W,
    h,
    heading: "poke-memory",
    subheading: data.date,
    streakLine,
    statsLine,
    gradeSequence: data.gradeSequence,
  });

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Render a milestone share card to a PNG Blob.
 * Returns `null` if canvas is not available.
 */
export async function generateMilestoneShareImage(
  data: MilestoneShareData,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const h = CARD_H_BASE;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * SCALE;
  canvas.height = h * SCALE;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  paintCard({
    ctx,
    w: CARD_W,
    h,
    heading: "poke-memory",
    subheading: data.label,
  });

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

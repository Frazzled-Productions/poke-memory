/**
 * Client-side canvas image generator for share cards.
 *
 * All rendering is spoiler-safe — no Pokémon names or sprites appear.
 * The card shows: a wordmark and date in the top row; a centred disc
 * containing a hero number (streak, reviewed count, or milestone) with a
 * label below it; and an optional three-column stat row (reviewed / new /
 * mastered) separated by a divider at the bottom.
 *
 * Runs only in a browser context (needs `document.createElement`).
 */

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

// Card dimensions (logical CSS pixels; exported at 2× via SCALE)
const SCALE = 2;
const CARD_W = 600;
const CARD_H = 720;
const PAD = 54;

// Disc geometry: diameter 344 → radius 172
const DISC_R = 172;
const DISC_FILL = "#111113";
const RING_WIDTH = 4;

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/** Return true when value is a valid 6-digit hex colour string. */
function isHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Multiply each RGB channel by factor f (0–1) to darken a hex colour. */
function darken(hex: string, f: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}

/** Convert a hex colour + alpha to a CSS rgba(...) string. */
function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Compute WCAG relative luminance for a hex colour.
 */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = toLinear((n >> 16) & 255);
  const G = toLinear((n >> 8) & 255);
  const B = toLinear(n & 255);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Compute the WCAG contrast ratio between two hex colours.
 * Returns a value between 1 (identical) and 21 (black on white).
 */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Theme token reader
// ---------------------------------------------------------------------------

type ThemeTokens = {
  primary: string;
  secondary: string;
  accent: string;
  fgOnPrimary: string;
};

const FALLBACK_TOKENS: ThemeTokens = {
  primary: "#D8334A",
  secondary: "#F4B6C0",
  accent: "#B82838",
  fgOnPrimary: "#FFFFFF",
};

function readThemeTokens(): ThemeTokens {
  if (typeof document === "undefined") return FALLBACK_TOKENS;
  const style = getComputedStyle(document.documentElement);
  const read = (prop: string) => style.getPropertyValue(prop).trim();

  /**
   * Read a CSS custom property and validate it is a #rrggbb hex colour.
   * If the value is absent or not a valid hex string (e.g. a CSS rgb(...)
   * value from a preprocessor), fall back to the default palette colour so
   * the rest of the code can safely call parseInt on every token.
   */
  const readHex = (prop: string, fallback: string): string => {
    const raw = read(prop);
    return isHex(raw) ? raw : fallback;
  };

  const primary = readHex("--theme-primary", FALLBACK_TOKENS.primary);
  const secondary = readHex("--theme-secondary", FALLBACK_TOKENS.secondary);
  const accent = readHex("--theme-accent", FALLBACK_TOKENS.accent);
  const fgOnPrimary = readHex(
    "--theme-fg-on-primary",
    FALLBACK_TOKENS.fgOnPrimary,
  );

  return { primary, secondary, accent, fgOnPrimary };
}

// ---------------------------------------------------------------------------
// Background gradient
// ---------------------------------------------------------------------------

function makeBackgroundGradient(
  ctx: CanvasRenderingContext2D,
  tokens: ThemeTokens,
  w: number,
  h: number,
): CanvasGradient {
  // 150° linear gradient: secondary at 0%, primary at 48%, darken(primary,0.6) at 100%.
  // Canvas gradient is defined by start/end points that span the full diagonal at that angle.
  const angle = (150 * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.sqrt(w * w + h * h) / 2;
  const x0 = cx - Math.cos(angle) * len;
  const y0 = cy - Math.sin(angle) * len;
  const x1 = cx + Math.cos(angle) * len;
  const y1 = cy + Math.sin(angle) * len;

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, tokens.secondary);
  grad.addColorStop(0.48, tokens.primary);
  grad.addColorStop(1, darken(tokens.primary, 0.6));
  return grad;
}

// ---------------------------------------------------------------------------
// Ring colour: use accent if contrast is sufficient, otherwise white
// ---------------------------------------------------------------------------

/**
 * Minimum WCAG contrast ratio required for the accent ring to be visibly
 * distinct from the near-black disc (#111113). 3:1 is the WCAG AA threshold
 * for graphical elements and large text; anything below this is effectively
 * invisible against the disc.
 *
 * The default Poké Ball accent #B82838 has a contrast ratio of ~2.4:1 against
 * #111113, which falls below this threshold and correctly falls back to white.
 * Bright accents (gold #FFD700 ~13:1, light blue #D4E8FF ~16:1) easily clear
 * the bar and keep their accent colour.
 */
const RING_MIN_CONTRAST = 3;

function ringColour(accent: string): string {
  return contrastRatio(accent, DISC_FILL) >= RING_MIN_CONTRAST
    ? accent
    : "rgba(255,255,255,0.92)";
}

/**
 * Return a hex string suitable for hexAlpha() regardless of whether
 * ringColour() returned a bare hex or an rgba(...) value.
 */
function ringColourHex(ring: string): string {
  if (!ring.startsWith("rgba")) return ring;
  const m = ring.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#FFFFFF";
  return (
    "#" +
    parseInt(m[1]).toString(16).padStart(2, "0") +
    parseInt(m[2]).toString(16).padStart(2, "0") +
    parseInt(m[3]).toString(16).padStart(2, "0")
  );
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function drawCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Sub-painters
// ---------------------------------------------------------------------------

function paintBackground(
  ctx: CanvasRenderingContext2D,
  tokens: ThemeTokens,
  w: number,
  h: number,
): void {
  ctx.fillStyle = makeBackgroundGradient(ctx, tokens, w, h);
  ctx.fillRect(0, 0, w, h);
}

function paintTopRow(
  ctx: CanvasRenderingContext2D,
  tokens: ThemeTokens,
  dateStr: string,
  w: number,
): void {
  const fg = tokens.fgOnPrimary;
  // The top row is vertically centred around the dot's centre.
  const dotR = 11.5; // diameter 23 → radius 11.5
  const dotCx = PAD + dotR;
  const dotCy = PAD + dotR;

  // Pokéball dot: top half solid fg, bottom half fg at 35% alpha, thin outline.
  // Full circle fill first.
  drawCircle(ctx, dotCx, dotCy, dotR);
  ctx.fillStyle = fg;
  ctx.fill();

  // Bottom-half overlay (0..π arc from right to left via bottom).
  ctx.save();
  ctx.beginPath();
  ctx.arc(dotCx, dotCy, dotR, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = hexAlpha(fg, 0.35);
  ctx.fill();
  ctx.restore();

  // Thin outline ring.
  ctx.strokeStyle = fg;
  ctx.lineWidth = 2.5;
  drawCircle(ctx, dotCx, dotCy, dotR);
  ctx.stroke();

  // "poke·memory" wordmark text.
  ctx.fillStyle = fg;
  ctx.font = `600 25px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("poke·memory", dotCx + dotR + 11, dotCy);

  // Date — top-right, 72% alpha.
  ctx.fillStyle = hexAlpha(fg, 0.72);
  ctx.font = `500 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(dateStr, w - PAD, dotCy);
}

function paintDisc(
  ctx: CanvasRenderingContext2D,
  tokens: ThemeTokens,
  heroNumber: string,
  heroLabel: string,
  cx: number,
  cy: number,
): void {
  const ring = ringColour(tokens.accent);
  const ringHex = ringColourHex(ring);

  // --- Depth shadow (dark, offset down) ---
  ctx.save();
  ctx.shadowColor = "rgba(17,17,19,0.42)";
  ctx.shadowBlur = 58 * SCALE;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 24 * SCALE;
  drawCircle(ctx, cx, cy, DISC_R);
  ctx.fillStyle = DISC_FILL;
  ctx.fill();
  ctx.restore();

  // --- Filled disc (no shadow) ---
  drawCircle(ctx, cx, cy, DISC_R);
  ctx.fillStyle = DISC_FILL;
  ctx.fill();

  // --- Glow shadow + ring stroke ---
  ctx.save();
  ctx.shadowColor = hexAlpha(ringHex, 0.6);
  ctx.shadowBlur = 60 * SCALE;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = RING_WIDTH;
  ctx.strokeStyle = ring;
  drawCircle(ctx, cx, cy, DISC_R - RING_WIDTH / 2);
  ctx.stroke();
  ctx.restore();

  // --- Hero number ---
  // Scale font size down for long numbers so they fit inside the disc.
  const numLen = heroNumber.length;
  const numFontSize = numLen >= 4 ? 140 : numLen >= 3 ? 160 : 208;
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${numFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  // Place baseline slightly below disc centre (line-height ≈ 0.86 of font size).
  const numBaselineY = cy + numFontSize * 0.12;
  ctx.fillText(heroNumber, cx, numBaselineY);

  // --- Label below the number ---
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = `600 23px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.fillText(heroLabel, cx, numBaselineY + 12);
}

function paintDivider(
  ctx: CanvasRenderingContext2D,
  fgOnPrimary: string,
  y: number,
  w: number,
): void {
  ctx.fillStyle = hexAlpha(fgOnPrimary, 0.3);
  ctx.fillRect(PAD, y, w - PAD * 2, 1.5);
}

function paintStatRow(
  ctx: CanvasRenderingContext2D,
  tokens: ThemeTokens,
  reviewed: number,
  newCards: number,
  mastered: number,
  topY: number,
  w: number,
): void {
  const colW = (w - PAD * 2) / 3;
  const fg = tokens.fgOnPrimary;
  const stats: Array<{ n: number; label: string }> = [
    { n: reviewed, label: "Reviewed" },
    { n: newCards, label: "New" },
    { n: mastered, label: "Mastered" },
  ];

  for (let i = 0; i < stats.length; i++) {
    const colCx = PAD + colW * i + colW / 2;
    const { n, label } = stats[i];

    // Count number (60px / weight 800)
    ctx.fillStyle = fg;
    ctx.font = `800 60px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.fillText(String(n), colCx, topY + 60);

    // Label (16px / weight 600 / uppercase / 72% alpha)
    ctx.fillStyle = hexAlpha(fg, 0.72);
    ctx.font = `600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillText(label.toUpperCase(), colCx, topY + 66);
  }
}

// ---------------------------------------------------------------------------
// Core card painter
// ---------------------------------------------------------------------------

type CardPaintOptions = {
  ctx: CanvasRenderingContext2D;
  tokens: ThemeTokens;
  /** The large number rendered inside the hero disc. */
  heroNumber: string;
  /** Label below the hero number (e.g. "DAY STREAK"). */
  heroLabel: string;
  /** Formatted date string for the top-right corner, e.g. "18 May 2026". */
  dateStr: string;
  /** When provided, draws divider + three-column stat row at the bottom. */
  stats?: { reviewed: number; newCards: number; mastered: number };
};

function paintCardInternal(opts: CardPaintOptions): void {
  const { ctx, tokens, heroNumber, heroLabel, dateStr, stats } = opts;

  const w = CARD_W;
  const h = CARD_H;

  // Scale for HiDPI — all subsequent measurements are in logical CSS pixels.
  ctx.scale(SCALE, SCALE);

  // Background gradient
  paintBackground(ctx, tokens, w, h);

  // Top row: Pokéball dot + wordmark + date
  paintTopRow(ctx, tokens, dateStr, w);

  // Hero disc — centred in the space between the top row and the bottom section.
  // Top row bottom ≈ PAD + 23 (dot diameter) + a little breathing room.
  const topRowBottom = PAD + 23 + 16;
  // Bottom section height: 1.5 (divider) + 28 (gap) + 60 (count) + 22 (label) + PAD
  const bottomSectionH = stats ? 1.5 + 28 + 60 + 22 + PAD : PAD;
  const heroAreaTop = topRowBottom + 12;
  const heroAreaBottom = h - bottomSectionH;
  const discCy = (heroAreaTop + heroAreaBottom) / 2;
  const discCx = w / 2;

  paintDisc(ctx, tokens, heroNumber, heroLabel, discCx, discCy);

  // Divider + stat row (daily card only)
  if (stats) {
    const dividerY = h - PAD - (1.5 + 28 + 60 + 22);
    paintDivider(ctx, tokens.fgOnPrimary, dividerY, w);
    const statsTopY = dividerY + 1.5 + 28;
    paintStatRow(
      ctx,
      tokens,
      stats.reviewed,
      stats.newCards,
      stats.mastered,
      statsTopY,
      w,
    );
  }
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function formatDateDisplay(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const monthName = MONTHS[monthIdx];
  // Guard against an out-of-range month index rather than producing a
  // double-spaced string like "18  2026".
  if (!monthName) return isoDate;
  return `${day} ${monthName} ${year}`;
}

function todayDisplay(): string {
  const d = new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
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

  // document.fonts may be undefined in test environments (e.g. jsdom).
  if (document.fonts?.ready) await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * SCALE;
  canvas.height = CARD_H * SCALE;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const tokens = readThemeTokens();

  // When the streak is 0, showing "0 DAY STREAK" as the hero is misleading.
  // Show the reviewed count with "CARDS TODAY" instead so the card always
  // leads with a meaningful number.
  const heroNumber =
    data.streak > 0 ? String(data.streak) : String(data.reviewed);
  const heroLabel = data.streak > 0 ? "DAY STREAK" : "CARDS TODAY";

  paintCardInternal({
    ctx,
    tokens,
    heroNumber,
    heroLabel,
    dateStr: formatDateDisplay(data.date),
    stats: {
      reviewed: data.reviewed,
      newCards: data.newCards,
      mastered: data.mastered,
    },
  });

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Render a milestone share card to a PNG Blob.
 * Returns `null` if canvas is not available.
 *
 * The milestone card uses the same visual language as the daily card but omits
 * the stat row — milestone data has no reviewed/new/mastered counts.
 */
export async function generateMilestoneShareImage(
  data: MilestoneShareData,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  // document.fonts may be undefined in test environments (e.g. jsdom).
  if (document.fonts?.ready) await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * SCALE;
  canvas.height = CARD_H * SCALE;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const tokens = readThemeTokens();

  // Extract a leading number from the label ("100 Pokémon mastered" → "100").
  // Fall back to a star character for non-numeric milestones.
  const match = data.label.match(/\d+/);
  const heroNumber = match ? match[0] : "★";
  // Disc label: upper-case the full label when short enough; otherwise "MILESTONE".
  const heroLabel =
    data.label.length <= 20 ? data.label.toUpperCase() : "MILESTONE";

  paintCardInternal({
    ctx,
    tokens,
    heroNumber,
    heroLabel,
    dateStr: todayDisplay(),
    // No stat row for milestone cards.
    stats: undefined,
  });

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

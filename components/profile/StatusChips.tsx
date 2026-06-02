"use client";

/**
 * Shared profile-status chips — the single source of truth for how the streak,
 * protection-token balance, and mastery figures render. Used by BOTH
 * `ProfileStatusBar` (the slim band below `<Nav>`) and `StreakBadge` (the
 * Practice screen, where the band is hidden on mobile so these chips surface
 * inline instead). Per the AGENTS.md single-source convention, do not re-inline
 * these chips at a new call site — import them here.
 *
 * All three render as matching rounded-pill chips with a small lucide-style SVG
 * icon (consistent with the nav / bottom-tab icon language — no emoji, whose
 * size and glyph vary across platforms). Streak and token share the amber
 * "streak family" tone used by `StreakProtectionCard`; mastery is emerald.
 *
 * Interactive popover (#1556): each chip is a tappable button. Tapping (touch)
 * or hovering/focusing (desktop) opens a small popover with the chip's full
 * meaning — the same string already used as the chip's `aria-label`. The
 * popover body is computed ONCE from the same source so wording cannot diverge.
 *
 * Pure presentational: each takes already-resolved values as props (no storage
 * reads, no superuser logic) so the markup is guaranteed identical everywhere.
 * Labels are deliberately terse (icon + value, e.g. "15d" / "2") so the row
 * stays clean and compact on every surface; the full descriptive text lives in
 * each chip's `aria-label` and the popover for both screen-reader and sighted
 * users.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// ─── Icons (lucide-style, currentColor, matches BottomTabBar strokeWidth) ──────

const ICON_CLASS = "size-3.5 shrink-0";

function FlameIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

function MasteredIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

// ─── Shared pill shell ─────────────────────────────────────────────────────────

const TONE_CLASS = {
  amber:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  emerald:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
} as const;

// ─── Popover ──────────────────────────────────────────────────────────────────

/**
 * A small floating tooltip/popover anchored below a pill chip. Used by all
 * three chip variants (streak, token, mastery) to expose the chip's full
 * meaning to sighted users. The `description` prop MUST be exactly the same
 * string used as the chip button's `aria-label` — the ChipButton enforces this
 * by passing the same resolved string to both.
 *
 * Dismissal: click/tap outside, Escape key, or Tab-away (blur when focus
 * leaves the wrapperRef element). Does NOT trap focus — it is informational
 * only, so the user can tab past naturally.
 */
function PillPopover({
  id,
  description,
  wrapperRef,
  onClose,
}: {
  id: string;
  description: string;
  wrapperRef: React.RefObject<HTMLSpanElement | null>;
  onClose: () => void;
}) {
  // Escape key closes the popover.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Click outside the wrapper (chip + popover) closes it.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const wrapper = wrapperRef.current;
      if (wrapper && !wrapper.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose, wrapperRef]);

  return (
    <div
      id={id}
      role="tooltip"
      className="absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-background px-3 py-2 text-xs font-medium text-foreground shadow-lg dark:border-zinc-700"
    >
      {/* Caret pointing up toward the chip */}
      <span
        aria-hidden="true"
        className="absolute -top-1.5 left-1/2 -translate-x-1/2 border-4 border-transparent border-b-zinc-200 dark:border-b-zinc-700"
      />
      <span
        aria-hidden="true"
        className="absolute -top-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-b-background"
      />
      {description}
    </div>
  );
}

// ─── ChipButton — the interactive wrapper ─────────────────────────────────────

/**
 * Wraps any chip in an interactive button that shows a `PillPopover` on:
 *   - Tap/click (touch and desktop)
 *   - Mouse hover (desktop, `@media(hover:hover)` devices only)
 *   - Keyboard focus (desktop)
 *
 * The `ariaLabel` prop is used for BOTH the button's `aria-label` AND the
 * popover body — computed once so the two sources cannot diverge. This is the
 * forcing function that satisfies the single-source requirement (#1556).
 *
 * The wrapper `<span>` is `relative` so the popover anchors correctly and
 * `inline-flex` so it doesn't widen the chip.
 */
function ChipButton({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  const close = useCallback(() => setOpen(false), []);

  // On pointer-hover-capable devices: show on mouseenter, hide on mouseleave.
  // We check `window.matchMedia("(hover:hover)")` at runtime rather than
  // relying on CSS-only so the JS state stays in sync with the popover.
  function handleMouseEnter() {
    if (window.matchMedia("(hover: hover)").matches) {
      setOpen(true);
    }
  }
  function handleMouseLeave() {
    if (window.matchMedia("(hover: hover)").matches) {
      setOpen(false);
    }
  }

  // Focus-visible shows the popover; blur hides it (unless pointer is also
  // over the chip, which handleMouseLeave handles separately).
  function handleFocus() {
    setOpen(true);
  }
  function handleBlur(e: React.FocusEvent<HTMLButtonElement>) {
    // Close when focus leaves the wrapper entirely.
    const wrapper = wrapperRef.current;
    if (!wrapper || !wrapper.contains(e.relatedTarget as Node)) {
      setOpen(false);
    }
  }

  // Click opens on hover-capable devices (mouse-leave closes); toggles on touch.
  function handleClick() {
    if (window.matchMedia("(hover: hover)").matches) {
      setOpen(true);
    } else {
      setOpen((v) => !v);
    }
  }

  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="inline-flex cursor-default items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
      >
        {children}
      </button>
      {open && (
        <PillPopover
          id={tooltipId}
          description={ariaLabel}
          wrapperRef={wrapperRef}
          onClose={close}
        />
      )}
    </span>
  );
}

// ─── Chip shell (visual only, no interactivity) ───────────────────────────────

/**
 * The visual pill. `aria-hidden="true"` because the wrapping `ChipButton`
 * carries the accessible label; the inner content is purely presentational.
 */
function ChipVisual({
  tone,
  icon,
  label,
}: {
  tone: keyof typeof TONE_CLASS;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

// ─── Public chips ──────────────────────────────────────────────────────────────

/**
 * Streak chip. At 0 days shows the "start your streak" prompt rather than
 * "0 day streak"; otherwise the terse day count (e.g. "15d").
 */
export function StreakChip({ streak }: { streak: number }) {
  const t = useTranslations("profileStatus");
  if (streak === 0) {
    const ariaLabel = t("startStreakChipAriaLabel");
    return (
      <ChipButton ariaLabel={ariaLabel}>
        <ChipVisual
          tone="amber"
          icon={<FlameIcon />}
          label={t("startStreakLabel")}
        />
      </ChipButton>
    );
  }
  const ariaLabel = t("streakChipAriaLabel", { count: streak });
  return (
    <ChipButton ariaLabel={ariaLabel}>
      <ChipVisual
        tone="amber"
        icon={<FlameIcon />}
        label={t("streakLabel", { count: streak })}
      />
    </ChipButton>
  );
}

/**
 * Protection-token chip. Renders nothing below 1 — a zero-token chip is noise.
 * Shows just the count; the shield icon carries the meaning.
 */
export function TokenChip({ tokenBalance }: { tokenBalance: number }) {
  const t = useTranslations("profileStatus");
  if (tokenBalance < 1) return null;
  const ariaLabel = t("tokenChipAriaLabel", { count: tokenBalance });
  return (
    <ChipButton ariaLabel={ariaLabel}>
      <ChipVisual
        tone="amber"
        icon={<ShieldIcon />}
        label={t("tokenLabel", { count: tokenBalance })}
      />
    </ChipButton>
  );
}

/**
 * Mastery chip — always rendered (including the zero state, so a new user learns
 * the goal exists; the accessible label is encouraging). Shows the terse
 * percentage; the full "X of Y mastered" description lives in the aria-label
 * and the popover.
 */
export function MasteryChip({
  masteryCount,
  totalSpecies,
  masteryPercent,
}: {
  masteryCount: number;
  totalSpecies: number;
  masteryPercent: number;
}) {
  const t = useTranslations("profileStatus");
  const ariaLabel =
    masteryCount === 0
      ? t("masteryZeroAriaLabel", { total: totalSpecies })
      : t("masteryChipAriaLabel", {
          mastered: masteryCount,
          total: totalSpecies,
        });
  return (
    <ChipButton ariaLabel={ariaLabel}>
      <ChipVisual
        tone="emerald"
        icon={<MasteredIcon />}
        label={t("masteryLabel", { pct: masteryPercent })}
      />
    </ChipButton>
  );
}

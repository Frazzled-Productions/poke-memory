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
 * Pure presentational: each takes already-resolved values as props (no storage
 * reads, no superuser logic) so the markup is guaranteed identical everywhere.
 * Labels are deliberately terse (icon + value, e.g. "15d" / "2") so the row
 * stays clean and compact on every surface; the full descriptive text lives in
 * each chip's `aria-label` for screen readers.
 */

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

/**
 * The pill shell. `role="img"` + `aria-label` makes the icon-plus-value render
 * as a single labelled unit (the label carries the full meaning); the visible
 * glyph and terse text are not separately announced.
 */
function Chip({
  tone,
  icon,
  label,
  ariaLabel,
}: {
  tone: keyof typeof TONE_CLASS;
  icon: React.ReactNode;
  label: string;
  ariaLabel: string;
}) {
  return (
    <span
      role="img"
      aria-label={ariaLabel}
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
    return (
      <Chip
        tone="amber"
        icon={<FlameIcon />}
        label={t("startStreakLabel")}
        ariaLabel={t("startStreakChipAriaLabel")}
      />
    );
  }
  return (
    <Chip
      tone="amber"
      icon={<FlameIcon />}
      label={t("streakLabel", { count: streak })}
      ariaLabel={t("streakChipAriaLabel", { count: streak })}
    />
  );
}

/**
 * Protection-token chip. Renders nothing below 1 — a zero-token chip is noise.
 * Shows just the count; the shield icon carries the meaning.
 */
export function TokenChip({ tokenBalance }: { tokenBalance: number }) {
  const t = useTranslations("profileStatus");
  if (tokenBalance < 1) return null;
  return (
    <Chip
      tone="amber"
      icon={<ShieldIcon />}
      label={t("tokenLabel", { count: tokenBalance })}
      ariaLabel={t("tokenChipAriaLabel", { count: tokenBalance })}
    />
  );
}

/**
 * Mastery chip — always rendered (including the zero state, so a new user learns
 * the goal exists; the accessible label is encouraging). Shows the terse
 * percentage; the full "X of Y mastered" description lives in the aria-label.
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
    <Chip
      tone="emerald"
      icon={<MasteredIcon />}
      label={t("masteryLabel", { pct: masteryPercent })}
      ariaLabel={ariaLabel}
    />
  );
}

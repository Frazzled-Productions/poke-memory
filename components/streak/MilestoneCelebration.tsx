"use client";

import { useEffect } from "react";
import { tierForMilestone, type MilestoneTier } from "@/lib/streak/milestones";
import styles from "./MilestoneCelebration.module.css";

type Props = {
  milestone: number;
  onDismiss: () => void;
};

// Confetti piece counts by tier — more pieces for rarer milestones.
const CONFETTI_COUNT: Record<MilestoneTier, number> = {
  light: 8,
  standard: 14,
  major: 22,
};

// Burst radius by tier — majors scatter further.
const BURST_RADIUS: Record<MilestoneTier, number> = {
  light: 110,
  standard: 140,
  major: 180,
};

const COLORS = [
  "#f97316", // orange-500
  "#ef4444", // red-500
  "#eab308", // yellow-500
  "#22c55e", // green-500
  "#3b82f6", // blue-500
  "#a855f7", // purple-500
];

// Warm golden palette for major milestones — richer than the standard burst.
const MAJOR_COLORS = [
  "#fbbf24", // amber-400
  "#f59e0b", // amber-500
  "#f97316", // orange-500
  "#ef4444", // red-500
  "#fde047", // yellow-300
  "#fb923c", // orange-400
];

const DISMISS_MS = 4500;

// Sub-copy keyed by milestone value; falls back to the tier default.
const MILESTONE_SUB: Partial<Record<number, string>> = {
  365: "One full year of practice.",
  465: "Over a year and counting.",
  565: "Pushing eighteen months.",
};

const TIER_SUB: Record<MilestoneTier, string> = {
  light: "Keep it up!",
  standard: "You are on a roll.",
  major: "That is seriously impressive.",
};

// Headline copy — majors get a custom line; others use the numeric default.
const MILESTONE_HEADLINE: Partial<Record<number, string>> = {
  365: "One year.",
};

function headline(milestone: number): string {
  return MILESTONE_HEADLINE[milestone] ?? `${milestone}-day streak!`;
}

function subCopy(milestone: number, tier: MilestoneTier): string {
  return MILESTONE_SUB[milestone] ?? TIER_SUB[tier];
}

export function MilestoneCelebration({ milestone, onDismiss }: Props) {
  const tier = tierForMilestone(milestone);
  const count = CONFETTI_COUNT[tier];
  const radius = BURST_RADIUS[tier];
  const palette = tier === "major" ? MAJOR_COLORS : COLORS;

  useEffect(() => {
    const id = window.setTimeout(onDismiss, DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  return (
    <div
      className={`${styles.overlay} ${styles[`overlay--${tier}`]}`}
      role="status"
      aria-live="polite"
      aria-label={`${milestone}-day streak reached`}
      onClick={onDismiss}
    >
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const rot = 180 + (i * 47) % 360;
        const color = palette[i % palette.length];
        return (
          <span
            key={i}
            className={styles.confetti}
            style={
              {
                background: color,
                animationDelay: `${i * 20}ms`,
                ["--dx" as string]: `${dx}px`,
                ["--dy" as string]: `${dy}px`,
                ["--rot" as string]: `${rot}deg`,
              } as React.CSSProperties
            }
          />
        );
      })}
      <div className={`${styles.banner} ${styles[`banner--${tier}`]}`}>
        <span className={styles.headline}>{headline(milestone)}</span>
        <span className={styles.sub}>{subCopy(milestone, tier)}</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import styles from "./MilestoneCelebration.module.css";

type Props = {
  milestone: number;
  onDismiss: () => void;
};

// Twelve confetti pieces — each gets a deterministic angle so the burst feels
// even but doesn't require runtime randomness (which would cause hydration
// mismatch warnings under React strict-mode).
const CONFETTI_COUNT = 12;
const COLORS = [
  "#f97316", // orange-500
  "#ef4444", // red-500
  "#eab308", // yellow-500
  "#22c55e", // green-500
  "#3b82f6", // blue-500
  "#a855f7", // purple-500
];

const DISMISS_MS = 3500;

export function MilestoneCelebration({ milestone, onDismiss }: Props) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  return (
    <div
      className={styles.overlay}
      role="status"
      aria-live="polite"
      aria-label={`${milestone}-day streak reached`}
      onClick={onDismiss}
    >
      {Array.from({ length: CONFETTI_COUNT }, (_, i) => {
        const angle = (i / CONFETTI_COUNT) * Math.PI * 2;
        const distance = 140;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        const rot = 180 + (i * 47) % 360;
        const color = COLORS[i % COLORS.length];
        return (
          <span
            key={i}
            className={styles.confetti}
            style={
              {
                background: color,
                animationDelay: `${i * 25}ms`,
                ["--dx" as string]: `${dx}px`,
                ["--dy" as string]: `${dy}px`,
                ["--rot" as string]: `${rot}deg`,
              } as React.CSSProperties
            }
          />
        );
      })}
      <div className={styles.banner}>
        <span className={styles.headline}>
          {milestone}-day streak!
        </span>
        <span className={styles.sub}>Keep it going.</span>
      </div>
    </div>
  );
}

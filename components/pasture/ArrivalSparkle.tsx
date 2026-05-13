"use client";

import styles from "./Pasture.module.css";

/**
 * Decorative sparkle overlay shown on mastered Pokémon that haven't yet been
 * acknowledged in the pasture. The parent controls visibility by conditionally
 * rendering this component.
 */
export function ArrivalSparkle() {
  return (
    <span
      className={styles.sparkleOverlay}
      aria-hidden="true"
    >
      <span className={styles.sparkleIcon}>✨</span>
    </span>
  );
}

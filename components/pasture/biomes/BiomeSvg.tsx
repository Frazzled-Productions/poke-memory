import styles from "./Biome.module.css";

/**
 * Shared SVG wrapper for all biome backdrop components.
 *
 * Every biome is a 1600×600 decorative SVG that fills its container, sits
 * behind sprites, and ignores pointer events. This component owns those
 * invariants — viewBox, preserveAspectRatio, aria-hidden, and the shared
 * CSS class — so each individual biome only needs to supply its unique
 * gradient defs and drawn elements as children.
 *
 * Pure static markup — no state, effects, or browser APIs — so no
 * "use client" directive is needed.
 *
 * The output is pixel-identical to writing the svg element inline in each
 * biome file; this is a structural convenience, not a semantic change.
 */
export function BiomeSvg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className={styles.biome}
      viewBox="0 0 1600 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

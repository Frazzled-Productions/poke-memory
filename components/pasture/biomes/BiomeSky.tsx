/**
 * Shared full-bleed background layer used by 9 of the 10 biome backdrops.
 * Sea is the exception: its sky occupies only the top ~100 px of the viewport
 * (the rest is a water column), so it renders the gradient inline rather than
 * using this component.
 *
 * Renders a vertical linearGradient into `<defs>` and a 1600×600 background
 * rect that references it. Every biome has exactly this structure - only the
 * gradient id and stop colours differ - so extracting it here eliminates the
 * 10-way duplication of that boilerplate.
 *
 * Pure static markup - no state, effects, or browser APIs.
 *
 * Props
 * ─────
 * gradientId - the id used for both the <linearGradient> and the rect's
 *                fill="url(#…)". Must be unique within the SVG document.
 * stops - array of gradient stops (offset, stopColor, optional
 *                stopOpacity). Rendered in order.
 */

export interface GradientStop {
  offset: string;
  stopColor: string;
  stopOpacity?: number;
}

interface BiomeSkyProps {
  gradientId: string;
  stops: GradientStop[];
}

export function BiomeSky({ gradientId, stops }: BiomeSkyProps) {
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          {stops.map((s, i) => (
            <stop
              key={i}
              offset={s.offset}
              stopColor={s.stopColor}
              {...(s.stopOpacity !== undefined
                ? { stopOpacity: s.stopOpacity }
                : {})}
            />
          ))}
        </linearGradient>
      </defs>
      <rect width="1600" height="600" fill={`url(#${gradientId})`} />
    </>
  );
}

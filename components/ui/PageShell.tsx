/**
 * Canonical page shell for content pages (added for #1729 / #1735).
 *
 * Renders an outer `<main>` (flex-1, full-bleed background) wrapping an inner
 * centred `div` with standard horizontal padding and vertical breathing room.
 * The `width` prop selects the max-width tier:
 *
 *   - `wide`    → max-w-5xl  (Pokédex, Pasture - matches nav chrome)
 *   - `reading` → max-w-3xl  (Stats, Journey, What's-new)
 *   - `narrow`  → max-w-2xl  (Pokémon detail)
 *
 * Keep the biome landscape page (`app/pasture/[biome]/page.tsx`) out of this
 * shell: it uses a fixed full-bleed rotated layout that is incompatible with
 * a standard centred container.
 */

import type { ReactNode } from "react";

type Width = "wide" | "reading" | "narrow";

const widthClass: Record<Width, string> = {
  wide: "max-w-5xl",
  reading: "max-w-3xl",
  narrow: "max-w-2xl",
};

interface PageShellProps {
  /** Controls the inner container max-width tier. */
  width: Width;
  /** Standard page content. */
  children: ReactNode;
  /** Optional extra class names applied to the outer `<main>` element. */
  className?: string;
}

export function PageShell({ width, children, className }: PageShellProps) {
  return (
    <main
      className={[
        "flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={`w-full ${widthClass[width]}`}>{children}</div>
    </main>
  );
}

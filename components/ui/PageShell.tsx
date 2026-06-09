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
 *
 * `overflow-y-auto min-h-0` on the `<main>` gives each content page its own
 * internal scroll context. The app-shell fit region ([data-scroll-region]) is
 * `overflow-hidden` on mobile (#1087 fix / #1801 follow-up), so pages that need
 * to scroll own their overflow here rather than relying on the shell.
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
      // overflow-y-auto + min-h-0: this element owns the scroll for content
      // pages. The app-shell fit region is overflow-hidden on mobile, so tall
      // page content must scroll here rather than in the shell (#1087 / #1801).
      data-page-shell-scroll
      className={[
        "flex flex-1 flex-col min-h-0 overflow-y-auto items-center bg-background px-4 py-10 sm:py-14",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={`w-full ${widthClass[width]}`}>{children}</div>
    </main>
  );
}

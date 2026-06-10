"use client";

/**
 * Route-aware scroll container that sits between the header chrome and the
 * in-flow BottomTabBar (#1801 / #1839 follow-up).
 *
 * On Practice (`/`) the region is `overflow-hidden` so the card layout fills
 * the available height without triggering a body scroll. On every other route
 * it is `overflow-y-auto` so tall pages (Settings, Privacy, Terms, Stats, etc.)
 * can scroll even when they do not use PageShell.
 *
 * On desktop (md+) we revert to `overflow-visible` and let the document scroll
 * normally, so neither branch applies there.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface ScrollRegionProps {
  children: ReactNode;
}

export function ScrollRegion({ children }: ScrollRegionProps) {
  const pathname = usePathname();
  // Practice is the only route that must NOT scroll on mobile.
  const fit = pathname === "/";

  return (
    <div
      data-scroll-region
      className={[
        "flex flex-1 flex-col min-h-0",
        fit ? "overflow-hidden" : "overflow-y-auto",
        "md:overflow-visible",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

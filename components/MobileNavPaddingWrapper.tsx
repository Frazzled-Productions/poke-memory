"use client";

/**
 * Wraps page content as the flex-1 height-chain link between the scroll region
 * and the page body.
 *
 * As of #1801 the bottom tab bar is in-flow (not fixed), so no bottom padding
 * is needed to prevent it from overlapping content. The bar sits below the
 * scroll region in the app-shell flex column and is always visible at the
 * viewport bottom on mobile.
 *
 * The `flex flex-1 flex-col min-h-0` chain is what feeds ReviewSession and
 * ReviewCardLayout their height on Practice. Do not add min-h-[100svh] here -
 * that belongs on <body> (#1728) and putting it here pushes Practice past the
 * viewport, reintroducing scroll (#1087).
 */
export function MobileNavPaddingWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-1 flex-col min-h-0"
      data-page-content
    >
      {children}
    </div>
  );
}

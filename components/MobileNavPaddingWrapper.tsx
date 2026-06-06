"use client";

import { useEffect, useState } from "react";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";

/**
 * Wraps page content with the correct bottom padding on mobile.
 *
 * When `mobileNav === 'bottom'`: adds `pb-[calc(4rem+env(safe-area-inset-bottom))]`
 * so the fixed bottom tab bar never overlaps content.
 * When `mobileNav === 'hamburger'`: no extra padding (there is no fixed bar).
 *
 * `md:pb-0` is always applied - desktop layout is unaffected by this setting.
 */
export function MobileNavPaddingWrapper({ children }: { children: React.ReactNode }) {
  // Initialise to null so the first client render matches the server render
  // (both produce the "bottom" padding), avoiding a React hydration mismatch
  // for users whose persisted setting is "hamburger". The real value is applied
  // in useEffect after mount.
  const [mobileNav, setMobileNav] = useState<"bottom" | "hamburger" | null>(null);

  useEffect(() => {
    // Apply the persisted value now that we are safely past hydration.
    setMobileNav(loadSettings().mobileNav);

    function onSaved() {
      setMobileNav(loadSettings().mobileNav);
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, []);

  return (
    // The "page is at least as tall as the initial viewport" guarantee that
    // anchors the iOS Safari toolbar / bottom tab bar (#1086) lives on <body>
    // (`min-h-[100svh]`), not here. `svh` (URL-bar-expanded height) is correct
    // at first paint; the original `dvh` (URL-bar-collapsed height) resolved to
    // the wrong value before any scroll reconciled the viewports (#1728).
    // Putting the min-height on the wrapper forced it to 100svh on top of the
    // Nav and any sibling banners (e.g. GuestStorageNotice), pushing the page
    // past the viewport and re-introducing the Practice scroll (#1087).
    // Keeping the wrapper as `flex-1` lets it absorb only the space body has
    // left after its siblings, so the height chain that feeds ReviewSession
    // can land grade buttons within the viewport.
    <div
      className={[
        "flex flex-1 flex-col min-h-0 md:pb-0",
        mobileNav === "bottom"
          ? "pb-[calc(4rem+env(safe-area-inset-bottom))]"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-page-content
    >
      {children}
    </div>
  );
}

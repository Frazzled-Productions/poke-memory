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
 * `md:pb-0` is always applied — desktop layout is unaffected by this setting.
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
    <div
      className={[
        // min-h-dvh ensures the content wrapper always fills the current dynamic
        // viewport height. On iOS Safari, short pages (e.g. the Pokédex detail page
        // for a locked Pokémon) can be shorter than the large viewport, which causes
        // the browser toolbar to appear and the visual viewport to shrink. Because
        // `position: fixed; bottom: 0` anchors to the visual viewport, the bottom
        // tab bar visually jumps upward when the toolbar appears. Giving the wrapper
        // a minimum height of 100dvh keeps the page body at least as tall as the
        // current visual viewport, which keeps the toolbar state stable and the nav
        // bar anchored (#1086). Only applied when the bottom tab bar is active
        // (mobileNav === 'bottom' or null during hydration); the hamburger layout
        // has no fixed bar so the minimum height is not needed.
        "flex flex-1 flex-col md:min-h-0 md:pb-0",
        mobileNav !== "hamburger" ? "min-h-dvh" : "",
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

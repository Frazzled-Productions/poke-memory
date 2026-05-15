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
        "flex flex-1 flex-col md:pb-0",
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

"use client";

import { Suspense, useEffect, useState } from "react";
import { loadSettings } from "@/lib/settings/persistence";
import type { MobileNav } from "@/lib/settings/persistence";
import { NavDrawer, NavDrawerFallback } from "@/components/NavDrawer";
import { AuthButton } from "@/components/auth/AuthButton";
import { WhatsNewIndicator } from "@/components/whats-new/WhatsNewIndicator";
import { SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";

/**
 * Mobile header slot — rendered below the `md` breakpoint only.
 *
 * Reads `mobileNav` from the user's settings and shows either:
 * - `'hamburger'` — the existing NavDrawer trigger + slide-in panel.
 * - `'bottom'` — only the What's New indicator and the auth button
 *   (navigation is handled by the fixed bottom tab bar in this mode).
 *
 * Re-renders whenever the user saves a new `mobileNav` value on the Settings
 * page, so the switch takes effect without a full reload.
 */
export function MobileNavSlot() {
  const [mobileNav, setMobileNav] = useState<MobileNav>(() => {
    if (typeof window === "undefined") return "bottom";
    return loadSettings().mobileNav;
  });

  // Keep in sync when the user changes the setting on the Settings page.
  useEffect(() => {
    function onSaved() {
      setMobileNav(loadSettings().mobileNav);
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, []);

  if (mobileNav === "hamburger") {
    return (
      <Suspense fallback={<NavDrawerFallback />}>
        <NavDrawer />
      </Suspense>
    );
  }

  // bottom tab bar mode — show only auth + What's New in the header
  return (
    <div className="flex items-center gap-2 md:hidden">
      <Suspense fallback={null}>
        <WhatsNewIndicator />
      </Suspense>
      <AuthButton />
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LAST_SEEN_VERSION_KEY,
  readLastSeenVersion,
  writeLastSeenVersion,
} from "@/lib/version/lastSeen";
import { compareSemver, parseSemver } from "@/lib/version/compare";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const APP_VERSION_IS_VALID = parseSemver(APP_VERSION) !== null;

// Renders a small "What's new" pill in the nav when the current build's
// version is newer than the user's last-seen marker. First-time users
// (no marker yet) have it silently seeded to APP_VERSION so they aren't
// pestered with retroactive release notes for changes that shipped before
// they ever loaded the app.
//
// If APP_VERSION isn't a valid semver (e.g. `dev` in local development) we
// short-circuit entirely — don't read, don't seed, don't render. Seeding
// `lastSeen = "dev"` would poison the localStorage marker so that a later
// upgrade to a real version (e.g. `0.9.55`) compares as `compareSemver
// > 0 → 0` and the indicator never fires again for that user.
export function WhatsNewIndicator() {
  const pathname = usePathname();
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    if (!APP_VERSION_IS_VALID) return;
    const lastSeen = readLastSeenVersion();
    if (lastSeen === null) {
      writeLastSeenVersion(APP_VERSION);
      setHasUnseen(false);
      return;
    }
    setHasUnseen(compareSemver(APP_VERSION, lastSeen) > 0);
  }, []);

  useEffect(() => {
    if (!APP_VERSION_IS_VALID) return;
    function handleStorage(event: StorageEvent) {
      if (event.key !== LAST_SEEN_VERSION_KEY) return;
      const lastSeen = event.newValue;
      if (lastSeen === null) {
        setHasUnseen(false);
        return;
      }
      setHasUnseen(compareSemver(APP_VERSION, lastSeen) > 0);
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  if (!APP_VERSION_IS_VALID || !hasUnseen || pathname === "/whats-new") {
    return null;
  }

  return (
    <Link
      href="/whats-new"
      aria-label="What's new"
      className="inline-flex items-center gap-1.5 rounded-full bg-theme-fg-on-primary px-3 py-1 text-xs font-semibold text-theme-primary shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500"
      />
      What&apos;s new
    </Link>
  );
}

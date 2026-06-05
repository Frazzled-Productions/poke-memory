"use client";

import { usePwaBadge } from "./usePwaBadge";

/**
 * Mounts the Web Badging API badge-sync hook. Renders nothing - its only role
 * is keeping the installed-PWA icon badge in sync with the number of cards due
 * today.
 *
 * Mount this once near the root of the app (e.g. in the root layout, alongside
 * ServiceWorkerProvider). It is a no-op in browsers that do not support the
 * Web Badging API.
 */
export function PwaBadge() {
  usePwaBadge();
  return null;
}

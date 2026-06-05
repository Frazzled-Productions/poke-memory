"use client";

import { useDocumentTitleBadge } from "./useDocumentTitleBadge";

/**
 * Mounts the document-title due-count badge hook. Renders nothing - its only
 * role is keeping the browser tab title in sync with the number of cards due
 * today, by prepending a `(N)` prefix when cards are due and clearing it at
 * zero.
 *
 * Mount this once near the root of the app (e.g. in the root layout, alongside
 * PwaBadge). The count prefix is placed before whatever the current route's
 * title is, composing with per-route metadata.
 */
export function DocumentTitleBadge() {
  useDocumentTitleBadge();
  return null;
}

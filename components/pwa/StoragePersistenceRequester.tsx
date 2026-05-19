"use client";

/**
 * Thin layout-level client component that requests persistent storage on
 * mount (#1057). Wraps `usePersistentStorage` so the hook can be called
 * from the Server Component root layout without making the whole layout
 * a client boundary.
 *
 * Renders nothing — the only side effect is the `navigator.storage.persist()`
 * call inside the hook.
 */

import { usePersistentStorage } from "@/lib/pwa/usePersistentStorage";

export function StoragePersistenceRequester() {
  usePersistentStorage();
  return null;
}

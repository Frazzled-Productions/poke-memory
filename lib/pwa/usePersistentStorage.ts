"use client";

/**
 * Requests persistent storage from the browser on the first call and records
 * that the request was made so subsequent mounts skip the redundant call.
 *
 * WebKit's Intelligent Tracking Prevention evicts all script-writable storage
 * (localStorage, IndexedDB, SW caches) after 7 days of no interaction with a
 * site in a normal Safari tab (#1057). Calling `navigator.storage.persist()`
 * grants the origin an exemption from that eviction when the browser honours
 * the request.
 *
 * Feature-detected throughout: the hook is a no-op when `navigator.storage`
 * or `.persist`/`.persisted` are absent (e.g. older WebKit, private-browsing
 * modes that block the API).
 */

import { useEffect } from "react";
import { KEY_PERSIST_REQUESTED } from "@/lib/storage/keys";
import { writeLocalStorageRaw } from "@/lib/storage/writeLocalStorage";

export function usePersistentStorage(): void {
  useEffect(() => {
    // Guard: feature-detect the Storage Persistence API.
    if (
      typeof navigator === "undefined" ||
      !navigator.storage ||
      typeof navigator.storage.persist !== "function" ||
      typeof navigator.storage.persisted !== "function"
    ) {
      return;
    }

    // Avoid a redundant request on every mount. One successful grant is
    // permanent for the origin (until the user revokes it via browser settings).
    if (localStorage.getItem(KEY_PERSIST_REQUESTED) === "true") {
      return;
    }

    navigator.storage
      .persisted()
      .then((alreadyPersisted) => {
        if (alreadyPersisted) {
          writeLocalStorageRaw(KEY_PERSIST_REQUESTED, "true");
          return;
        }
        return navigator.storage.persist().then((granted) => {
          if (granted) {
            writeLocalStorageRaw(KEY_PERSIST_REQUESTED, "true");
          }
          // If not granted (e.g. no PWA install, no engagement heuristic met),
          // we don't record it — the next mount will try again, which is fine
          // because the call is cheap and browsers rate-limit it naturally.
        });
      })
      .catch(() => {
        // Some private-browsing modes and WebViews reject the promise; treat as
        // unsupported and do nothing.
      });
  }, []);
}

"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useFavourite } from "./FavouriteThemeProvider";
import {
  loadSettings,
  SETTINGS_SAVED_EVENT,
  type UserSettings,
} from "@/lib/settings/persistence";
import { THEME_WATERMARK_SPRITE_SIZE } from "@/lib/sprites/sizes";

function readIntensity(): string {
  if (typeof window === "undefined") return "accents";
  return document.documentElement.getAttribute("data-intensity") ?? "accents";
}

/**
 * Decorative mascot watermark shown at bottom-right when theme intensity is
 * `tinted` or `full`. Renders the favourite Pokémon sprite, or a Poké-ball
 * silhouette as a fallback. Hidden at the default `accents` intensity.
 */
export function ThemeWatermark() {
  const { favourite } = useFavourite();
  const [intensity, setIntensity] = useState<string>(() => {
    // Read initial intensity from settings rather than the DOM attribute so
    // the component hydrates correctly before the MutationObserver fires.
    if (typeof window === "undefined") return "accents";
    return loadSettings().themeIntensity;
  });

  useEffect(() => {
    // DOM-attribute observer handles cross-tab changes (StorageEvent path
    // also flows through applyIntensity → data-intensity).
    function syncFromAttribute() {
      setIntensity(readIntensity());
    }

    // Same-tab settings saves carry the new value directly on the event
    // detail - read from there rather than the DOM attribute to avoid a
    // race with the FavouriteThemeProvider listener that sets it.
    function syncFromEvent(e: Event) {
      const detail = (e as CustomEvent<UserSettings>).detail;
      if (detail?.themeIntensity) setIntensity(detail.themeIntensity);
    }

    const observer = new MutationObserver(syncFromAttribute);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-intensity"],
    });
    window.addEventListener(SETTINGS_SAVED_EVENT, syncFromEvent);

    // Sync once immediately in case the attribute was set before we mounted.
    syncFromAttribute();

    return () => {
      observer.disconnect();
      window.removeEventListener(SETTINGS_SAVED_EVENT, syncFromEvent);
    };
  }, []);

  if (intensity !== "tinted" && intensity !== "full") return null;

  return (
    <div
      data-testid="theme-watermark"
      className="pointer-events-none fixed bottom-4 right-4 z-0 opacity-[0.06] select-none"
      aria-hidden="true"
    >
      {favourite?.spriteUrl ? (
        <Image
          src={favourite.spriteUrl}
          alt=""
          width={THEME_WATERMARK_SPRITE_SIZE}
          height={THEME_WATERMARK_SPRITE_SIZE}
          className="object-contain" style={{ width: THEME_WATERMARK_SPRITE_SIZE, height: THEME_WATERMARK_SPRITE_SIZE }}
          priority={false}
        />
      ) : (
        <PokeBallSVG />
      )}
    </div>
  );
}

function PokeBallSVG() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={180}
      height={180}
      aria-hidden="true"
    >
      {/* Top half - red */}
      <path d="M 5 50 A 45 45 0 0 1 95 50 Z" fill="currentColor" />
      {/* Bottom half - white */}
      <path d="M 5 50 A 45 45 0 0 0 95 50 Z" fill="currentColor" opacity="0.4" />
      {/* Outer ring */}
      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="5" />
      {/* Centre band */}
      <rect x="5" y="46" width="90" height="8" fill="currentColor" />
      {/* Centre button outer */}
      <circle cx="50" cy="50" r="12" fill="currentColor" />
      {/* Centre button inner */}
      <circle cx="50" cy="50" r="6" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

/**
 * Single source of truth for iOS PWA splash-screen (apple-touch-startup-image)
 * coverage (#1676).
 *
 * iOS ignores the manifest `background_color` for the launch window: it shows
 * the `apple-touch-startup-image` whose media query EXACTLY matches the device
 * (logical width/height + pixel ratio + orientation), or a black screen. There
 * is no partial match, so every common form-factor needs its own entry.
 *
 * Both the PNG generator (`scripts/generate-splash-screens.mjs`) and the Next.js
 * metadata (`app/layout.tsx` -> `appleWebApp.startupImage`) derive from this one
 * table, so a new device cannot be added to one without the other. The CI guard
 * (`lib/pwa/splashDevices.test.ts`) asserts PNG <-> media-query parity.
 */

export type SplashDevice = {
  /** Unique label; also the PNG filename stem (`<label>-portrait.png`). */
  label: string;
  /** Logical (CSS) width in portrait, px. */
  w: number;
  /** Logical (CSS) height in portrait, px. */
  h: number;
  /** Device pixel ratio (appears in the media query and sets physical px). */
  scale: number;
  /** Human note: the devices this form-factor covers. */
  devices: string;
};

export const SPLASH_DEVICES: readonly SplashDevice[] = [
  { label: "iphone16promax", w: 440, h: 956, scale: 3, devices: "iPhone 16 Pro Max / 17 Pro Max" },
  { label: "iphone16pro", w: 402, h: 874, scale: 3, devices: "iPhone 16 Pro / 17 Pro" },
  { label: "iphone16plus", w: 430, h: 932, scale: 3, devices: "iPhone 16 Plus / 15 Plus / 14 Plus" },
  { label: "iphone16", w: 393, h: 852, scale: 3, devices: "iPhone 16 / 15 / 15 Pro / 14 Pro / 16e" },
  { label: "iphone13mini", w: 375, h: 812, scale: 3, devices: "iPhone 13 mini / 12 mini / X / XS / 11 Pro" },
  { label: "iphoneSE", w: 375, h: 667, scale: 2, devices: "iPhone SE (2nd/3rd gen) / 8" },
  // Form-factors added in #1676 (previously fell through to a black launch).
  { label: "iphone14", w: 390, h: 844, scale: 3, devices: "iPhone 12 / 12 Pro / 13 / 13 Pro / 14" },
  { label: "iphone14promax", w: 428, h: 926, scale: 3, devices: "iPhone 12/13/14 Pro Max / 14 Plus" },
  { label: "iphone11", w: 414, h: 896, scale: 2, devices: "iPhone XR / 11" },
  { label: "iphone11promax", w: 414, h: 896, scale: 3, devices: "iPhone XS Max / 11 Pro Max" },
];

/** Physical pixel dimensions (portrait) for a device's PNG. */
export function physicalPortrait(d: SplashDevice): { width: number; height: number } {
  return { width: d.w * d.scale, height: d.h * d.scale };
}

/** A single `appleWebApp.startupImage` entry. */
export type StartupImage = { url: string; media: string };

/**
 * Derives the Next.js `appleWebApp.startupImage` metadata array (one portrait +
 * one landscape entry per device) from {@link SPLASH_DEVICES}.
 */
export function splashStartupImages(): StartupImage[] {
  const out: StartupImage[] = [];
  for (const d of SPLASH_DEVICES) {
    const base = `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.scale})`;
    out.push({
      url: `/splash/${d.label}-portrait.png`,
      media: `${base} and (orientation: portrait)`,
    });
    out.push({
      url: `/splash/${d.label}-landscape.png`,
      media: `${base} and (orientation: landscape)`,
    });
  }
  return out;
}

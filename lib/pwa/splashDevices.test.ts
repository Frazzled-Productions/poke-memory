import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SPLASH_DEVICES,
  physicalPortrait,
  splashStartupImages,
} from "./splashDevices";

// CI guard for iOS PWA splash coverage (#1676): every device in the table must
// have correctly-sized portrait + landscape PNGs AND a matching
// apple-touch-startup-image media query, with no orphan PNGs. A new device that
// lacks a PNG or media query (or a dimension mismatch) fails here.

const SPLASH_DIR = resolve(
  fileURLToPath(new URL("../../public/splash", import.meta.url)),
);

/** Reads a PNG's pixel dimensions from its IHDR header (no image library). */
function pngDimensions(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  // PNG: 8-byte signature, then IHDR chunk (4 len + "IHDR" + width + height).
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("splash device table (#1676)", () => {
  it("has unique labels", () => {
    const labels = SPLASH_DEVICES.map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("covers the four form-factors that previously fell through to black", () => {
    const present = (w: number, h: number, scale: number) =>
      SPLASH_DEVICES.some((d) => d.w === w && d.h === h && d.scale === scale);
    expect(present(390, 844, 3)).toBe(true); // iPhone 12/13/14
    expect(present(428, 926, 3)).toBe(true); // Pro Max / 14 Plus
    expect(present(414, 896, 2)).toBe(true); // XR / 11
    expect(present(414, 896, 3)).toBe(true); // XS Max / 11 Pro Max
  });

  for (const d of SPLASH_DEVICES) {
    describe(`${d.label} (${d.devices})`, () => {
      const { width, height } = physicalPortrait(d);

      it("has a correctly-sized portrait PNG", () => {
        const path = resolve(SPLASH_DIR, `${d.label}-portrait.png`);
        expect(existsSync(path)).toBe(true);
        expect(pngDimensions(path)).toEqual({ width, height });
      });

      it("has a correctly-sized landscape PNG (swapped)", () => {
        const path = resolve(SPLASH_DIR, `${d.label}-landscape.png`);
        expect(existsSync(path)).toBe(true);
        expect(pngDimensions(path)).toEqual({ width: height, height: width });
      });

      it("has portrait + landscape startup-image media queries", () => {
        const images = splashStartupImages();
        const portrait = images.find(
          (i) => i.url === `/splash/${d.label}-portrait.png`,
        );
        const landscape = images.find(
          (i) => i.url === `/splash/${d.label}-landscape.png`,
        );
        expect(portrait?.media).toContain(`(device-width: ${d.w}px)`);
        expect(portrait?.media).toContain(`(device-height: ${d.h}px)`);
        expect(portrait?.media).toContain(
          `(-webkit-device-pixel-ratio: ${d.scale})`,
        );
        expect(portrait?.media).toContain("(orientation: portrait)");
        expect(landscape?.media).toContain("(orientation: landscape)");
      });
    });
  }

  it("emits exactly two startup images (portrait + landscape) per device", () => {
    expect(splashStartupImages()).toHaveLength(SPLASH_DEVICES.length * 2);
  });

  it("has no orphan PNGs in public/splash (every PNG maps to a device)", () => {
    const expected = new Set(
      SPLASH_DEVICES.flatMap((d) => [
        `${d.label}-portrait.png`,
        `${d.label}-landscape.png`,
      ]),
    );
    const actual = readdirSync(SPLASH_DIR).filter((f) => f.endsWith(".png"));
    for (const file of actual) {
      expect(expected.has(file)).toBe(true);
    }
    // And every expected PNG exists on disk.
    expect(actual.length).toBe(expected.size);
  });
});

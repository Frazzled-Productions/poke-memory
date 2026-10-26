import { describe, it, expect } from "vitest";
import { choosePalette, hueOf, rgbToHsl, type Rgb } from "./extract-palette";
import { contrastRatio, hexToRgb, LIGHT_BACKGROUND, passesPaletteChecks } from "./contrast";

const CHECKS = { contrastRatio, passesPaletteChecks };

function hslOf(hex: string): [number, number, number] {
  return rgbToHsl(hexToRgb(hex) as Rgb);
}

// "Extraction tries several hues before falling back" (#2187).
describe("choosePalette", () => {
  const YELLOW_L48: Rgb = [220, 188, 24]; // hsl(50, 80%, 48%)
  const PALE_YELLOW: Rgb = [247, 237, 186]; // hsl(50, 80%, 85%)
  const PALE_BLUE: Rgb = [190, 217, 244]; // hsl(210, 70%, 85%)
  const PALE_GREEN: Rgb = [194, 240, 194]; // hsl(120, 60%, 85%)
  const BLUE: Rgb = [38, 128, 217]; // hsl(210, 70%, 50%)
  const RED: Rgb = [195, 34, 34]; // hsl(0, 70%, 45%)

  it("Pale yellow sprite: darkens the dominant yellow until it passes, within 15 points", () => {
    expect(contrastRatio("#DCBC18", LIGHT_BACKGROUND)).toBeLessThan(3);
    const palette = choosePalette([YELLOW_L48, BLUE], CHECKS);
    expect(palette).not.toBeNull();
    expect(passesPaletteChecks(palette!)).toBe(true);
    const [h, s, l] = hslOf(palette!.primary);
    expect(h).toBeCloseTo(50, -0.5);
    expect(s).toBeCloseTo(80, -0.5);
    expect(l).toBeLessThan(48);
    expect(l).toBeGreaterThanOrEqual(48 - 15 - 0.5);
    // The accent is still the next distinct hue.
    expect(palette!.accent).toBe("#2680D9");
  });

  it("tries the next distinct hue when no step of the dominant one passes", () => {
    const palette = choosePalette([PALE_YELLOW, BLUE, RED], CHECKS);
    expect(palette).not.toBeNull();
    expect(passesPaletteChecks(palette!)).toBe(true);
    expect(hueOf(hexToRgb(palette!.primary) as Rgb)).toBeCloseTo(210, -1);
  });

  it("Extraction fails the check: tries only three hues, then returns null", () => {
    expect(choosePalette([PALE_YELLOW, PALE_BLUE, PALE_GREEN, RED], CHECKS)).toBeNull();
    expect(choosePalette([], CHECKS)).toBeNull();
  });
});

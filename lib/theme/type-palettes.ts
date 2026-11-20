import type { ThemeColors } from "./curated-pokemon";

/**
 * Hand-tuned theme palette for each of the 18 types (#2187). A species whose
 * sprite palette fails the contrast checks (`lib/theme/contrast.ts`) uses the
 * palette of its primary type. Every entry passes the same checks
 * (`type-palettes.test.ts`): each `primary` sits in the luminance band that
 * reads at 3:1 on both the light and the dark page background.
 */
export const TYPE_PALETTES: Readonly<Record<string, ThemeColors>> = {
  normal:   { primary: "#8A8A6A", secondary: "#C4C4AC", accent: "#C0392B", fgOnPrimary: "#000000" },
  fire:     { primary: "#D2541B", secondary: "#F2A27A", accent: "#F5C542", fgOnPrimary: "#000000" },
  water:    { primary: "#2F72C9", secondary: "#8DB6EA", accent: "#F5D76E", fgOnPrimary: "#FFFFFF" },
  electric: { primary: "#A67C00", secondary: "#F2D45C", accent: "#3A3A3A", fgOnPrimary: "#000000" },
  grass:    { primary: "#3E8E2E", secondary: "#9ACF8C", accent: "#E25C8C", fgOnPrimary: "#000000" },
  ice:      { primary: "#2D8C8C", secondary: "#9AD8D8", accent: "#E8F6FF", fgOnPrimary: "#000000" },
  fighting: { primary: "#C0392B", secondary: "#E89A90", accent: "#F2B33D", fgOnPrimary: "#FFFFFF" },
  poison:   { primary: "#8E44A8", secondary: "#C99ADB", accent: "#7BC043", fgOnPrimary: "#FFFFFF" },
  ground:   { primary: "#9A6A2A", secondary: "#D6B27E", accent: "#5A3A1A", fgOnPrimary: "#FFFFFF" },
  flying:   { primary: "#6A6AD0", secondary: "#B4B4EC", accent: "#F2F2F2", fgOnPrimary: "#000000" },
  psychic:  { primary: "#D23A72", secondary: "#F0A0BE", accent: "#6A4E9A", fgOnPrimary: "#000000" },
  bug:      { primary: "#6E8A12", secondary: "#BCD46A", accent: "#D2541B", fgOnPrimary: "#000000" },
  rock:     { primary: "#8A7432", secondary: "#CDBE8A", accent: "#4A4030", fgOnPrimary: "#000000" },
  ghost:    { primary: "#7558A8", secondary: "#B9A6DA", accent: "#E23B3B", fgOnPrimary: "#FFFFFF" },
  dragon:   { primary: "#6248D8", secondary: "#B0A2F0", accent: "#E8B33D", fgOnPrimary: "#FFFFFF" },
  dark:     { primary: "#7A5A48", secondary: "#B89C8C", accent: "#E2C044", fgOnPrimary: "#FFFFFF" },
  steel:    { primary: "#5E7A8E", secondary: "#AFC2CF", accent: "#D8D8E0", fgOnPrimary: "#000000" },
  fairy:    { primary: "#C2508E", secondary: "#EDA8CC", accent: "#F5E1EC", fgOnPrimary: "#000000" },
};

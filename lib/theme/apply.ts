import type { ThemeColors } from "./curated-pokemon";

export function applyTheme(colors: ThemeColors | null): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (colors === null) {
    root.style.removeProperty("--theme-primary");
    root.style.removeProperty("--theme-secondary");
    root.style.removeProperty("--theme-accent");
    root.style.removeProperty("--theme-fg-on-primary");
  } else {
    root.style.setProperty("--theme-primary", colors.primary);
    root.style.setProperty("--theme-secondary", colors.secondary);
    root.style.setProperty("--theme-accent", colors.accent);
    root.style.setProperty("--theme-fg-on-primary", colors.fgOnPrimary);
  }
}

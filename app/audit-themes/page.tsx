"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { isUnlocked } from "@/lib/superuser/persistence";
import type { ThemeIntensity } from "@/lib/settings/persistence";
import {
  CURATED_POKEMON,
  BRAND_DEFAULT_COLORS,
  type ThemeColors,
} from "@/lib/theme/curated-pokemon";

// Mirror the sRGB color-mix performed in app/globals.css. Keep the percentages
// in sync with the CSS — this page exists to verify those exact blends.
function mix(a: string, b: string, pct: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar * pct + br * (1 - pct));
  const g = Math.round(ag * pct + bg * (1 - pct));
  const bl = Math.round(ab * pct + bb * (1 - pct));
  return `rgb(${r},${g},${bl})`;
}

function compute(colors: ThemeColors, intensity: ThemeIntensity, dark: boolean) {
  const primary = colors.primary;
  const fgOnPrimary = colors.fgOnPrimary;
  if (intensity === "accents") {
    if (dark) {
      return {
        bg: "#111113",
        fg: "#ededed",
        surfaceRaised: mix(primary, "#3a3a3e", 0.22),
      };
    }
    return {
      bg: "#fafafa",
      fg: "#171717",
      surfaceRaised: mix(primary, "#ffffff", 0.09),
    };
  }
  if (intensity === "tinted") {
    if (dark) {
      return {
        bg: mix(primary, "#111113", 0.22),
        fg: "#ededed",
        surfaceRaised: mix(primary, "#3a3a3e", 0.32),
      };
    }
    return {
      bg: mix(primary, "#fafafa", 0.16),
      fg: "#171717",
      surfaceRaised: mix(primary, "#ffffff", 0.22),
    };
  }
  if (dark) {
    return {
      bg: mix(primary, "#000000", 0.75),
      fg: fgOnPrimary,
      surfaceRaised: mix(primary, "#65656d", 0.25),
    };
  }
  return {
    bg: primary,
    fg: fgOnPrimary,
    surfaceRaised: mix(primary, "#ffffff", 0.32),
  };
}

const INTENSITIES: ThemeIntensity[] = ["accents", "tinted", "full"];

function Swatch({
  body,
  surfaceRaised,
  secondary,
  fg,
  label,
}: {
  body: string;
  surfaceRaised: string;
  secondary: string;
  fg: string;
  label: string;
}) {
  return (
    <div
      style={{
        background: body,
        color: fg,
        padding: 10,
        borderRadius: 8,
        minWidth: 230,
      }}
    >
      <div style={{ fontSize: 10, marginBottom: 6, opacity: 0.8 }}>{label}</div>
      <div
        style={{
          background: surfaceRaised,
          border: `1px solid ${secondary}`,
          padding: 6,
          borderRadius: 6,
          display: "flex",
          gap: 4,
          justifyContent: "center",
          boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
        }}
      >
        <button className="rounded px-2 py-1 text-[10px] font-semibold bg-red-500 text-white ring-1 ring-black/15 shadow-md">
          Again
        </button>
        <button className="rounded px-2 py-1 text-[10px] font-semibold bg-amber-500 text-white ring-1 ring-black/15 shadow-md">
          Hard
        </button>
        <button className="rounded px-2 py-1 text-[10px] font-semibold bg-emerald-600 text-white ring-1 ring-black/15 shadow-md">
          Good
        </button>
        <button className="rounded px-2 py-1 text-[10px] font-semibold bg-sky-500 text-white ring-1 ring-black/15 shadow-md">
          Easy
        </button>
      </div>
    </div>
  );
}

export default function AuditThemes() {
  // Read the unlock flag directly from localStorage on mount rather than via
  // useSuperuser(): the provider initialises `unlocked = false` and only
  // hydrates in a useEffect, so reading the context synchronously during the
  // first render incorrectly trips `notFound()` for unlocked users.
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  useEffect(() => {
    setState(isUnlocked() ? "ok" : "denied");
  }, []);
  if (state === "loading") return null;
  if (state === "denied") notFound();

  const palettes: Array<{ name: string; colors: ThemeColors }> = [
    { name: "Brand Default", colors: BRAND_DEFAULT_COLORS },
    ...CURATED_POKEMON.map((p) => ({ name: p.name, colors: p.colors })),
  ];

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold">Theme audit</h1>
      <p className="mt-1 text-xs opacity-70">
        Each row is one mascot. Columns: accents / tinted / full, each shown in
        light + dark. Buttons reflect the production grade-button styling. Surface
        colours are computed in JS to match{" "}
        <code className="font-mono">app/globals.css</code>; keep them in sync if
        you tweak the intensity layers.
      </p>
      <div className="mt-4 flex flex-col gap-1.5">
        {palettes.map(({ name, colors }) => (
          <div key={name} className="flex items-center gap-1.5">
            <div className="w-28 text-xs font-semibold">
              {name}
              <div className="mt-0.5 flex gap-0.5">
                <span
                  className="h-3.5 w-3.5 rounded-sm"
                  style={{ background: colors.primary }}
                />
                <span
                  className="h-3.5 w-3.5 rounded-sm"
                  style={{ background: colors.secondary }}
                />
                <span
                  className="h-3.5 w-3.5 rounded-sm"
                  style={{ background: colors.accent }}
                />
              </div>
            </div>
            {INTENSITIES.flatMap((intensity) =>
              [false, true].map((dark) => {
                const c = compute(colors, intensity, dark);
                return (
                  <Swatch
                    key={`${intensity}-${dark}`}
                    body={c.bg}
                    surfaceRaised={c.surfaceRaised}
                    secondary={colors.secondary}
                    fg={c.fg}
                    label={`${intensity} · ${dark ? "dark" : "light"}`}
                  />
                );
              }),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

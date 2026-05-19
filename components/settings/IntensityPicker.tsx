"use client";

import type { ThemeIntensity } from "@/lib/settings/persistence";
import { colStack, colStackLg } from "@/lib/utils/class-names";

type Option = {
  value: ThemeIntensity;
  label: string;
  description: string;
};

const OPTIONS: Option[] = [
  {
    value: "accents",
    label: "Subtle accents only",
    description: "Mascot colours appear on the nav bar and focus rings; body stays neutral.",
  },
  {
    value: "tinted",
    label: "Tinted backgrounds",
    description: "A light wash of your mascot colour tints the page background.",
  },
  {
    value: "full",
    label: "Full mascot theme",
    description: "Your mascot colour drives all backgrounds: loud by design.",
  },
];

type Props = {
  value: ThemeIntensity;
  onChange: (next: ThemeIntensity) => void;
};

export function IntensityPicker({ value, onChange }: Props) {
  return (
    <section className={colStackLg} aria-labelledby="intensity-heading">
      <h2
        id="intensity-heading"
        className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        Theme intensity
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="intensity-heading"
        className={colStack}
      >
        {OPTIONS.map((opt) => {
          const checked = value === opt.value;
          const inputId = `intensity-${opt.value}`;
          return (
            <label
              key={opt.value}
              htmlFor={inputId}
              className={[
                "flex cursor-pointer items-start gap-3 rounded-xl border px-5 py-4 transition-colors",
                checked
                  ? "border-theme-accent bg-background"
                  : "border-zinc-200 bg-background dark:border-zinc-800",
              ].join(" ")}
            >
              <input
                id={inputId}
                type="radio"
                name="theme-intensity"
                value={opt.value}
                checked={checked}
                onChange={() => onChange(opt.value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--theme-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{opt.label}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {opt.description}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
}

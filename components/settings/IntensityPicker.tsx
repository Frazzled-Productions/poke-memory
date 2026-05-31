"use client";

import { useTranslations } from "next-intl";
import type { ThemeIntensity } from "@/lib/settings/persistence";
import { colStack, colStackLg, mutedTextXs, sectionLabelSm } from "@/lib/utils/class-names";

type Option = {
  value: ThemeIntensity;
  labelKey: "accentsLabel" | "tintedLabel" | "fullLabel";
  descriptionKey: "accentsDescription" | "tintedDescription" | "fullDescription";
};

const OPTIONS: Option[] = [
  {
    value: "accents",
    labelKey: "accentsLabel",
    descriptionKey: "accentsDescription",
  },
  {
    value: "tinted",
    labelKey: "tintedLabel",
    descriptionKey: "tintedDescription",
  },
  {
    value: "full",
    labelKey: "fullLabel",
    descriptionKey: "fullDescription",
  },
];

type Props = {
  value: ThemeIntensity;
  onChange: (next: ThemeIntensity) => void;
};

export function IntensityPicker({ value, onChange }: Props) {
  const t = useTranslations("settings.appearance.intensityPicker");

  return (
    <section className={colStackLg} aria-labelledby="intensity-heading">
      <h2
        id="intensity-heading"
        className={sectionLabelSm}
      >
        {t("heading")}
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
                <p className="text-sm font-medium text-foreground">{t(opt.labelKey)}</p>
                <p className={`mt-0.5 ${mutedTextXs}`}>
                  {t(opt.descriptionKey)}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
}

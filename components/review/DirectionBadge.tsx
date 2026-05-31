"use client";

import { useTranslations } from "next-intl";

export type CardDirection = "name" | "evolution" | "reverse-evolution" | "reverse" | "cry";

/** Maps each card direction to its icon and the i18n key within `practice.direction`. */
const DIRECTION_ICONS: Record<CardDirection, string> = {
  name: "🔍",
  evolution: "→",
  "reverse-evolution": "←",
  reverse: "🔍",
  cry: "🔊",
};

type DirectionLabelKey = "name" | "evolution" | "reverseEvolution" | "reverse" | "cry";

const DIRECTION_LABEL_KEY: Record<CardDirection, DirectionLabelKey> = {
  name: "name",
  evolution: "evolution",
  "reverse-evolution": "reverseEvolution",
  reverse: "reverse",
  cry: "cry",
};

type Props = {
  direction: CardDirection;
};

export function DirectionBadge({ direction }: Props) {
  const t = useTranslations("practice.direction");
  const icon = DIRECTION_ICONS[direction];
  const label = t(DIRECTION_LABEL_KEY[direction]);
  return (
    <div
      role="status"
      aria-label={`Card type: ${label}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {icon}
      </span>
      <span>{label}</span>
    </div>
  );
}

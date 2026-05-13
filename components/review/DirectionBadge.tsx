export type CardDirection = "name" | "evolution" | "reverse-evolution" | "reverse" | "cry";

const LABELS: Record<CardDirection, { icon: string; label: string }> = {
  name: { icon: "🔍", label: "Name this Pokémon" },
  evolution: { icon: "→", label: "Evolution" },
  "reverse-evolution": { icon: "←", label: "Pre-evolution" },
  reverse: { icon: "🔍", label: "Pick the sprite" },
  cry: { icon: "🔊", label: "Name from cry" },
};

type Props = {
  direction: CardDirection;
};

export function DirectionBadge({ direction }: Props) {
  const { icon, label } = LABELS[direction];
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

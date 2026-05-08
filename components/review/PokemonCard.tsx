import Image from "next/image";

type Props = {
  spriteUrl: string;
  name: string;
  revealed: boolean;
};

export function PokemonCard({ spriteUrl, name, revealed }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      <Image
        src={spriteUrl}
        alt={revealed ? name : "A Pokémon sprite — answer hidden"}
        width={320}
        height={320}
        priority
        className="object-contain"
      />
      {/*
        Reserve the same vertical space whether revealed or not to avoid
        layout shift. h-10 matches roughly the height of text-3xl + leading.
      */}
      <div className="h-10 flex items-center justify-center" aria-live="polite">
        {revealed ? (
          <p className="text-3xl font-semibold tracking-wide capitalize text-foreground">
            {name}
          </p>
        ) : (
          <p className="text-3xl font-semibold tracking-wide text-zinc-300 dark:text-zinc-600 select-none">
            ???
          </p>
        )}
      </div>
    </div>
  );
}

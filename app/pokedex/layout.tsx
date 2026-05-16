import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pokédex - Poké Memory",
  description:
    "Browse all 1025 Pokémon, filter by generation or type, and see your mastery progress at a glance.",
};

export default function PokedexLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

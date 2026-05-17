import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Journey - Poké Memory",
  description:
    "Your Pokémon Journey: trainer card, gym badges, mastery rings, generation and type breakdowns, and your records.",
};

export default function JourneyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pasture — Poké Memory",
  description:
    "Your mastered Pokémon live here. See which species you've learnt and explore them by habitat.",
};

export default function PastureLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

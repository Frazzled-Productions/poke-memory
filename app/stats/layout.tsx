import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stats - Poké Memory",
  description:
    "Your review statistics: mastery counts, review streaks, grade history, and earned badges.",
};

export default function StatsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stats - Poké Memory",
  description:
    "Your review analytics: accuracy sparkline, grade breakdown, retention indicator, difficulty histogram, due forecast, and activity history.",
};

export default function StatsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

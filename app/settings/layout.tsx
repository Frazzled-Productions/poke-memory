import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings - Poké Memory",
  description:
    "Configure your daily review limits, practice scope, display preferences, and account options.",
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

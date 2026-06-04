"use client";

import { useTranslations } from "next-intl";
import { DismissibleBanner } from "@/components/ui/DismissibleBanner";

type Props = {
  onDismiss: () => void;
};

export function StorageQuotaBanner({ onDismiss }: Props) {
  const t = useTranslations("review");
  return (
    <DismissibleBanner
      variant="amber"
      message={t("storageFullBanner")}
      dismissLabel={t("storageFullDismiss")}
      onDismiss={onDismiss}
    />
  );
}

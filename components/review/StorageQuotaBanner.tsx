"use client";

import { useTranslations } from "next-intl";
import { DismissableBanner } from "@/components/ui/DismissableBanner";

type Props = {
  onDismiss: () => void;
};

export function StorageQuotaBanner({ onDismiss }: Props) {
  const t = useTranslations("review");
  return (
    <DismissableBanner
      variant="amber"
      message={t("storageFullBanner")}
      dismissLabel={t("storageFullDismiss")}
      onDismiss={onDismiss}
    />
  );
}

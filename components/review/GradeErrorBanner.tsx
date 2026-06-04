"use client";

import { useTranslations } from "next-intl";
import { DismissableBanner } from "@/components/ui/DismissableBanner";

type Props = {
  message: string;
  onDismiss: () => void;
};

export function GradeErrorBanner({ message, onDismiss }: Props) {
  const t = useTranslations("practice");
  return (
    <DismissableBanner
      variant="red"
      message={message}
      dismissLabel={t("dismissError")}
      onDismiss={onDismiss}
    />
  );
}

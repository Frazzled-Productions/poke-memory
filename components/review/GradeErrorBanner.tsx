"use client";

import { useTranslations } from "next-intl";
import { DismissibleBanner } from "@/components/ui/DismissibleBanner";

type Props = {
  message: string;
  onDismiss: () => void;
};

export function GradeErrorBanner({ message, onDismiss }: Props) {
  const t = useTranslations("practice");
  return (
    <DismissibleBanner
      variant="red"
      message={message}
      dismissLabel={t("dismissError")}
      onDismiss={onDismiss}
    />
  );
}

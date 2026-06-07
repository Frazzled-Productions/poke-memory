"use client";

/**
 * Visually-hidden h1 for the Practice route (#1730 / #1729).
 *
 * The compact mobile layout has no room for a visible title, but screen-reader
 * users need a top-level heading to identify the page. `sr-only` hides it
 * visually while keeping it in the accessibility tree.
 *
 * Text reuses the `nav.practice` catalogue key so no new string is needed and
 * the heading stays in sync with the nav tab label across all locales.
 *
 * Client component because `useTranslations` requires a client context. A
 * client component here is acceptable: it has no state, effects, or browser
 * API calls; it only needs the intl context that the app's root provider
 * supplies to every client component.
 */

import { useTranslations } from "next-intl";

export function PracticeH1() {
  const t = useTranslations("nav");
  return <h1 className="sr-only">{t("practice")}</h1>;
}

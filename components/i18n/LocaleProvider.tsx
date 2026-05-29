/**
 * LocaleProvider — async server component that reads the locale cookie and
 * wires up next-intl for Client Components in the tree.
 *
 * Extracted from RootLayout so the cookie read (dynamic) is isolated behind
 * a Suspense boundary. This lets statically-generated routes like
 * `/pokedex/[id]` prerender without hitting "Uncached data accessed outside
 * of <Suspense>" — the boundary prevents the dynamic locale resolution from
 * contaminating the static shell (#1260).
 */

import { setRequestLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { resolveLocale } from "@/i18n/request";

export async function LocaleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await resolveLocale();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

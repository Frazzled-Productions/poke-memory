"use server";
// lib/i18n/actions.ts
// Server Actions for locale management (#1260).

import { cookies } from "next/headers";
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type AppLocale } from "@/i18n/locales";

/**
 * Write the user's chosen locale to the `poke-memory:locale` cookie.
 * The cookie is HTTP-only for security and expires in 1 year.
 * Callers should call `router.refresh()` after this resolves so the
 * Server Component tree re-renders with the new locale.
 */
export async function setLocaleCookie(locale: AppLocale): Promise<void> {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return;

  const jar = await cookies();
  (jar as unknown as {
    set(name: string, value: string, options: {
      path: string;
      maxAge: number;
      sameSite: "lax";
      secure: boolean;
    }): void;
  }).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 365 * 24 * 60 * 60, // 1 year
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

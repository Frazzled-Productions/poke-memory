"use server";
// lib/i18n/actions.ts
// Server Actions for locale management (#1260).

import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type AppLocale } from "@/i18n/locales";

/**
 * Write the user's chosen locale to the `poke-memory:locale` cookie.
 * Not HTTP-only - the client-side `useAppLocale` hook reads it via
 * `document.cookie`. Expires in 1 year. The `secure` flag is derived from
 * the actual request protocol (via `x-forwarded-proto`) rather than from
 * `NODE_ENV`: production (Vercel HTTPS) sets it; the e2e CI runs against
 * `http://localhost:3000` so secure must be false there or WebKit silently
 * drops the cookie. Callers should call `router.refresh()` after this
 * resolves so the Server Component tree re-renders with the new locale.
 */
export async function setLocaleCookie(locale: AppLocale): Promise<void> {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return;

  const hdrs = await headers();
  const isHttps = hdrs.get("x-forwarded-proto") === "https";

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
    secure: isHttps,
  });
}

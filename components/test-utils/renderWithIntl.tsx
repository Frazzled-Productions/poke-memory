/**
 * renderWithIntl — shared test helper for components that call useTranslations().
 *
 * Any component that calls `useTranslations()` requires a
 * `<NextIntlClientProvider>` ancestor. Without one it throws during render.
 * This helper wraps the component under test in the provider, backed by the
 * real message catalogues from `messages/<locale>.json`, so tests exercise the
 * same translation keys the app uses in production.
 *
 * Usage:
 *
 *   import { renderWithIntl, renderJa, screen } from
 *     "@/components/test-utils/renderWithIntl";
 *
 *   it("renders the practice label in Japanese", () => {
 *     renderJa(<MyComponent />);
 *     expect(screen.getByText("練習")).toBeInTheDocument();
 *   });
 *
 * Re-exports testing utilities from @testing-library/react (excluding `render`)
 * so importers only need one import line.
 */

import React from "react";
import { render } from "@testing-library/react";
import type { RenderOptions, RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AppLocale } from "@/i18n/locales";

// Import all four catalogues statically so vitest can resolve them without
// dynamic-import overhead. TypeScript resolves JSON imports as typed objects
// when `resolveJsonModule: true` is set in tsconfig.json (it is).
import enMessages from "@/messages/en.json";
import jaMessages from "@/messages/ja.json";
import zhHansMessages from "@/messages/zh-Hans.json";
import zhHantMessages from "@/messages/zh-Hant.json";

// ---------------------------------------------------------------------------
// Internal catalogue map
// ---------------------------------------------------------------------------

const MESSAGES = {
  en: enMessages,
  ja: jaMessages,
  "zh-Hans": zhHansMessages,
  "zh-Hant": zhHantMessages,
} satisfies Record<AppLocale, object>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IntlRenderOptions extends Omit<RenderOptions, "wrapper"> {
  locale?: AppLocale;
}

/**
 * Renders `ui` inside a `<NextIntlClientProvider>` populated with the real
 * message catalogue for `locale` (default: `"en"`). Returns the same object
 * that `@testing-library/react`'s `render` returns.
 */
export function renderWithIntl(
  ui: React.ReactElement,
  { locale = "en", ...options }: IntlRenderOptions = {},
): RenderResult {
  const messages = MESSAGES[locale];

  // Locale is fixed at render time; `rerender` inherits it and cannot change locale mid-test.
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

/**
 * Convenience shorthand — renders `ui` in the Japanese locale.
 * Satisfies the mandatory non-English locale test requirement.
 */
export function renderJa(ui: React.ReactElement): RenderResult {
  return renderWithIntl(ui, { locale: "ja" });
}

// ---------------------------------------------------------------------------
// Re-export @testing-library/react so callers only need one import line.
//
// We explicitly list every name we re-export and deliberately EXCLUDE
// `render`. Blanket `export *` would let a consumer write:
//
//   import { render } from "@/components/test-utils/renderWithIntl";
//
// and silently get the unwrapped, provider-free render — the footgun this
// helper exists to prevent. Use `renderWithIntl` or `renderJa` instead.
// ---------------------------------------------------------------------------

export {
  screen,
  fireEvent,
  waitFor,
  waitForElementToBeRemoved,
  within,
  act,
  cleanup,
  renderHook,
  // Query helpers — exposed so callers can destructure from their own
  // `renderWithIntl(...)` result and also use the bound queries off `screen`.
  getByRole,
  getByText,
  getByLabelText,
  getByPlaceholderText,
  getByAltText,
  getByTestId,
  getByTitle,
  getByDisplayValue,
  getAllByRole,
  getAllByText,
  getAllByLabelText,
  getAllByPlaceholderText,
  getAllByAltText,
  getAllByTestId,
  getAllByTitle,
  getAllByDisplayValue,
  queryByRole,
  queryByText,
  queryByLabelText,
  queryByPlaceholderText,
  queryByAltText,
  queryByTestId,
  queryByTitle,
  queryByDisplayValue,
  queryAllByRole,
  queryAllByText,
  queryAllByLabelText,
  queryAllByPlaceholderText,
  queryAllByAltText,
  queryAllByTestId,
  queryAllByTitle,
  queryAllByDisplayValue,
  findByRole,
  findByText,
  findByLabelText,
  findByPlaceholderText,
  findByAltText,
  findByTestId,
  findByTitle,
  findByDisplayValue,
  findAllByRole,
  findAllByText,
  findAllByLabelText,
  findAllByPlaceholderText,
  findAllByAltText,
  findAllByTestId,
  findAllByTitle,
  findAllByDisplayValue,
  // Utilities
  prettyDOM,
  logDOM,
  getDefaultNormalizer,
  configure,
  getConfig,
} from "@testing-library/react";

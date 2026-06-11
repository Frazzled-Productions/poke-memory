/**
 * Locale-rendering tests for the exported StrugglingCardRow sub-component
 * (app/stats/page.tsx, issue #1852).
 *
 * Imports the ACTUAL StrugglingCardRow from app/stats/page.tsx to exercise the
 * real lines under coverage and verify the locale-name rendering contract across
 * all four supported locales (en/ja/zh-Hans/zh-Hant).
 *
 * The component requires:
 *   - NextIntlClientProvider (supplied by renderWithIntl)
 *   - useLocalePokemonName (mocked to return locale-specific names)
 *   - usePokemonLocaleContext (mocked to return the current locale)
 *   - next/image (mocked to plain <img>)
 *   - next/link (mocked to plain <a>)
 *   - DirectionBadge (imported normally; it only needs useTranslations)
 */

import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import type { StrugglingCard } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Pokémon locale names fixture keyed by speciesId then locale.
const LOCALE_NAMES: Record<number, Record<string, string>> = {
  25: { en: "Pikachu", ja: "ピカチュウ", "zh-Hans": "皮卡丘", "zh-Hant": "皮卡丘" },
  1: { en: "Bulbasaur", ja: "フシギダネ", "zh-Hans": "妙蛙种子", "zh-Hant": "妙蛙種子" },
};

let currentLocale = "en";

vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (speciesId: number | undefined, englishName: string) => {
    const name =
      speciesId !== undefined
        ? (LOCALE_NAMES[speciesId]?.[currentLocale] ?? englishName)
        : englishName;
    return { name, transliteration: null };
  },
}));

vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => ({
    locale: currentLocale,
    languagesEnabled: true,
    learningLocales: ["en"],
  }),
}));

// ---------------------------------------------------------------------------
// Import the ACTUAL component under test.
// Must appear after vi.mock() calls so that the module resolver picks up the
// mocks before importing the component.
// ---------------------------------------------------------------------------

// eslint-disable-next-line import/first -- intentional: mocks must precede import
import { StrugglingCardRow } from "@/app/stats/page";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PIKACHU_CARD: StrugglingCard = {
  id: 25,
  speciesId: 25,
  name: "Pikachu",
  spriteUrl: "/sprites/pokemon/25.png",
  easeFactor: 1.5,
  repetitions: 5,
};

const BULBASAUR_CARD: StrugglingCard = {
  id: 1,
  speciesId: 1,
  name: "Bulbasaur",
  spriteUrl: "/sprites/pokemon/1.png",
  easeFactor: 1.8,
  repetitions: 3,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StrugglingCardRow (actual component) - locale name rendering (#1852)", () => {
  it("en: renders English name as visible text and Image alt", () => {
    currentLocale = "en";
    renderWithIntl(<StrugglingCardRow card={PIKACHU_CARD} />);
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    expect(screen.getByAltText("Pikachu")).toBeInTheDocument();
  });

  it("en: link has viewInPokedex aria-label with English name", () => {
    currentLocale = "en";
    renderWithIntl(<StrugglingCardRow card={PIKACHU_CARD} />);
    expect(
      screen.getByRole("link", { name: /View Pikachu in Pokédex/i }),
    ).toBeInTheDocument();
  });

  it("ja: renders Japanese name ピカチュウ, not 'Pikachu'", () => {
    currentLocale = "ja";
    renderWithIntl(<StrugglingCardRow card={PIKACHU_CARD} />, { locale: "ja" });
    expect(screen.getByText("ピカチュウ")).toBeInTheDocument();
    expect(screen.getByAltText("ピカチュウ")).toBeInTheDocument();
    expect(screen.queryByText("Pikachu")).not.toBeInTheDocument();
  });

  it("ja: link aria-label uses locale name", () => {
    currentLocale = "ja";
    renderWithIntl(<StrugglingCardRow card={PIKACHU_CARD} />, { locale: "ja" });
    expect(
      screen.getByRole("link", { name: /ピカチュウ/ }),
    ).toBeInTheDocument();
  });

  it("ja: name paragraph carries lang='ja' attribute", () => {
    currentLocale = "ja";
    const { container } = renderWithIntl(
      <StrugglingCardRow card={PIKACHU_CARD} />,
      { locale: "ja" },
    );
    const langP = container.querySelector("p[lang='ja']");
    expect(langP).toBeInTheDocument();
    expect(langP?.textContent).toContain("ピカチュウ");
  });

  it("zh-Hans: renders 皮卡丘 for Pikachu", () => {
    currentLocale = "zh-Hans";
    renderWithIntl(<StrugglingCardRow card={PIKACHU_CARD} />, {
      locale: "zh-Hans",
    });
    expect(screen.getByText("皮卡丘")).toBeInTheDocument();
    expect(screen.getByAltText("皮卡丘")).toBeInTheDocument();
  });

  it("zh-Hans: name paragraph carries lang='zh-Hans'", () => {
    currentLocale = "zh-Hans";
    const { container } = renderWithIntl(
      <StrugglingCardRow card={PIKACHU_CARD} />,
      { locale: "zh-Hans" },
    );
    expect(container.querySelector("p[lang='zh-Hans']")).toBeInTheDocument();
  });

  it("zh-Hant: renders 皮卡丘 for Pikachu", () => {
    currentLocale = "zh-Hant";
    renderWithIntl(<StrugglingCardRow card={PIKACHU_CARD} />, {
      locale: "zh-Hant",
    });
    expect(screen.getByText("皮卡丘")).toBeInTheDocument();
    expect(screen.getByAltText("皮卡丘")).toBeInTheDocument();
  });

  it("zh-Hans: renders 妙蛙种子 for Bulbasaur (speciesId=1)", () => {
    currentLocale = "zh-Hans";
    renderWithIntl(<StrugglingCardRow card={BULBASAUR_CARD} />, {
      locale: "zh-Hans",
    });
    expect(screen.getByText("妙蛙种子")).toBeInTheDocument();
    expect(screen.getByAltText("妙蛙种子")).toBeInTheDocument();
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("en: renders the sprite with correct src", () => {
    currentLocale = "en";
    renderWithIntl(<StrugglingCardRow card={PIKACHU_CARD} />);
    const img = screen.getByAltText("Pikachu") as HTMLImageElement;
    expect(img.src).toContain("25.png");
  });
});

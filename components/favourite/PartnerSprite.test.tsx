import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl, screen } from "@/components/test-utils/renderWithIntl";
import { serveLocaleNames } from "@/components/test-utils/localeNames";
import { PartnerSprite } from "./PartnerSprite";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const { mockPretend, mockLocale } = vi.hoisted(() => ({
  mockPretend: { value: false },
  mockLocale: { value: "en" as string },
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: mockPretend.value } }),
}));

vi.mock("@/lib/i18n/PokemonLocaleContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/PokemonLocaleContext")>()),
  usePokemonLocaleContext: () => ({ locale: mockLocale.value, languagesEnabled: true, learningLocales: ["en"] }),
}));

beforeEach(() => {
  serveLocaleNames();
  mockPretend.value = false;
  mockLocale.value = "en";
});

describe("PartnerSprite (#2187)", () => {
  const NAMES = { en: "Snorlax", ja: "カビゴン", "zh-Hans": "卡比兽", "zh-Hant": "卡比獸" } as const;
  for (const [locale, name] of Object.entries(NAMES)) {
    it(`shows the name in the learning locale (${locale})`, async () => {
      mockLocale.value = locale;
      renderWithIntl(<PartnerSprite speciesId={143} mastered size={64} />, { locale: locale as "en" });
      expect(await screen.findByText(name)).toBeInTheDocument();
    });
  }

  it("Unmastered: a silhouette with its name", () => {
    const { container } = renderWithIntl(<PartnerSprite speciesId={94} mastered={false} size={64} />);
    expect(screen.getByText("Gengar")).toBeInTheDocument();
    const img = container.querySelector("img")!;
    expect(img.className).toContain("brightness-0");
    expect(img).toHaveAttribute("width", "64");
  });

  it("Mastered partner: the full sprite", () => {
    const { container } = renderWithIntl(<PartnerSprite speciesId={94} mastered size={64} />);
    expect(container.querySelector("img")!.className).not.toContain("brightness-0");
  });

  it("Superuser pretendAllMastered: the full sprite for an unmastered favourite", () => {
    mockPretend.value = true;
    const { container } = renderWithIntl(<PartnerSprite speciesId={94} mastered={false} size={64} />);
    expect(container.querySelector("img")!.className).not.toContain("brightness-0");
  });
});

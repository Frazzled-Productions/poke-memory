/**
 * Settings favourite and theme sections (#2187). The scenario names follow
 * the favourite-pokemon spec. These live here rather than in
 * app/settings/page.test.tsx because that file stubs next-intl to English,
 * empties the seed and mocks settings persistence, so it cannot show names
 * in other locales or follow a save.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithIntl, screen, waitFor } from "@/components/test-utils/renderWithIntl";
import { serveLocaleNames } from "@/components/test-utils/localeNames";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/settings/persistence";
import { paletteFor } from "@/lib/theme/palette";
import { FavouritePokemonSection, ThemeSection } from "./FavouriteSettings";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const { mockMastered, mockPretend, mockLocale, mockUpdateFavourite } = vi.hoisted(() => ({
  mockMastered: { value: new Set<number>() as ReadonlySet<number> },
  mockPretend: { value: false },
  mockLocale: { value: "en" as string },
  mockUpdateFavourite: vi.fn(),
}));

vi.mock("./useMasteredSpecies", () => ({ useMasteredSpecies: () => mockMastered.value }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: mockPretend.value } }),
}));
vi.mock("@/lib/i18n/PokemonLocaleContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/PokemonLocaleContext")>()),
  usePokemonLocaleContext: () => ({ locale: mockLocale.value, languagesEnabled: true, learningLocales: ["en"] }),
}));
vi.mock("@/components/theme/FavouriteThemeProvider", () => ({
  useFavourite: () => ({ favourite: null, updateFavourite: mockUpdateFavourite }),
}));
vi.mock("@/lib/review/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/review/persistence")>()),
  loadSession: () => Promise.resolve(null),
}));

function theme(id: number, name: string) {
  return { id, name, colors: paletteFor(id)!, spriteUrl: `/sprites/pokemon/${id}.png` };
}

beforeEach(() => {
  window.localStorage.clear();
  serveLocaleNames();
  mockMastered.value = new Set();
  mockPretend.value = false;
  mockLocale.value = "en";
  mockUpdateFavourite.mockClear();
  saveSettings({ ...DEFAULT_SETTINGS });
});

describe("Settings: favourite Pokémon (#2187)", () => {
  it("Search in Japanese: ゲンガー finds Gengar, which can be made the favourite", async () => {
    mockLocale.value = "ja";
    renderWithIntl(<FavouritePokemonSection />, { locale: "ja" });
    await userEvent.type(await screen.findByLabelText("すべてのポケモンを検索"), "ゲンガー");
    await userEvent.click(await screen.findByRole("button", { name: "ゲンガーをお気に入りにする" }));
    expect(loadSettings().favouritePokemonId).toBe(94);
    expect(await screen.findByText("お気に入り：ゲンガー")).toBeInTheDocument();
  });

  for (const [locale, label, query, name] of [
    ["zh-Hans", "搜索全部宝可梦", "卡比兽", "卡比兽"],
    ["zh-Hant", "搜尋全部寶可夢", "卡比獸", "卡比獸"],
    ["en", "Search all Pokémon", "snor", "Snorlax"],
  ] as const) {
    it(`search matches names in the learning locale (${locale})`, async () => {
      mockLocale.value = locale;
      renderWithIntl(<FavouritePokemonSection />, { locale });
      await userEvent.type(await screen.findByLabelText(label), query);
      expect(await screen.findByText(name)).toBeInTheDocument();
    });
  }

  it("Favourite before learning it: an unmastered favourite asks the learn-first question", async () => {
    renderWithIntl(<FavouritePokemonSection />);
    await userEvent.type(await screen.findByLabelText("Search all Pokémon"), "Haunter");
    await userEvent.click(await screen.findByRole("button", { name: "Make Haunter your favourite" }));
    expect(loadSettings().favouritePokemonId).toBe(93);
    expect(loadSettings().favouriteTheme).toBeNull();
    expect(await screen.findByText("Learn Haunter's evolution line next?")).toBeInTheDocument();
  });

  it("Already mastered: no learn-first question", async () => {
    mockMastered.value = new Set([94]);
    renderWithIntl(<FavouritePokemonSection />);
    await userEvent.type(await screen.findByLabelText("Search all Pokémon"), "Gengar");
    await userEvent.click(await screen.findByRole("button", { name: "Make Gengar your favourite" }));
    expect(loadSettings().favouritePokemonId).toBe(94);
    expect(screen.queryByText("Learn Gengar's evolution line next?")).not.toBeInTheDocument();
  });

  it("Clear: favourite null, theme and hearts unchanged", async () => {
    saveSettings({
      ...loadSettings(),
      favouritePokemonId: 94,
      heartedSpeciesIds: [94, 25],
      favouriteTheme: theme(25, "Pikachu"),
    });
    renderWithIntl(<FavouritePokemonSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Clear favourite" }));
    const s = loadSettings();
    expect(s.favouritePokemonId).toBeNull();
    expect(s.heartedSpeciesIds).toEqual([94, 25]);
    expect(s.favouriteTheme?.id).toBe(25);
    expect(await screen.findByText("No favourite chosen yet.")).toBeInTheDocument();
  });
});

describe("Settings: theme (#2187)", () => {
  it("Theme while the favourite is unlearned: offers Pikachu, not Gengar, and no Match my favourite", async () => {
    mockMastered.value = new Set([25]);
    saveSettings({ ...loadSettings(), favouritePokemonId: 94, heartedSpeciesIds: [94] });
    renderWithIntl(<ThemeSection />);
    expect(await screen.findByRole("button", { name: "Use Pikachu as your app theme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Gengar as your app theme" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Match my favourite" })).not.toBeInTheDocument();
  });

  it("A non-curated theme: choosing Bulbasaur saves its generated palette with id 1", async () => {
    mockMastered.value = new Set([1]);
    renderWithIntl(<ThemeSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Use Bulbasaur as your app theme" }));
    await waitFor(() => expect(loadSettings().favouriteTheme?.id).toBe(1));
    expect(loadSettings().favouriteTheme).toEqual(theme(1, "Bulbasaur"));
    expect(mockUpdateFavourite).toHaveBeenCalledWith(theme(1, "Bulbasaur"));
  });

  it("Match my favourite: shown once the favourite is mastered, and applies it", async () => {
    mockMastered.value = new Set([25, 94]);
    saveSettings({
      ...loadSettings(),
      favouritePokemonId: 94,
      heartedSpeciesIds: [94],
      favouriteTheme: theme(25, "Pikachu"),
      // The once-only offer was already answered, so only the button shows.
      favouriteThemeOfferedForId: 94,
    });
    renderWithIntl(<ThemeSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Match my favourite" }));
    await waitFor(() => expect(loadSettings().favouriteTheme?.id).toBe(94));
  });

  it("Lapsed theme: Pikachu stays the current theme with Remove", async () => {
    mockMastered.value = new Set();
    saveSettings({ ...loadSettings(), favouriteTheme: theme(25, "Pikachu") });
    renderWithIntl(<ThemeSection />);
    expect(await screen.findByText("Current theme: Pikachu")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(loadSettings().favouriteTheme).toBeNull();
    expect(mockUpdateFavourite).toHaveBeenCalledWith(null);
  });

  it("Nothing mastered: the locked state shows, with a favourite set, and no Set as theme", async () => {
    saveSettings({ ...loadSettings(), favouritePokemonId: 94, heartedSpeciesIds: [94] });
    renderWithIntl(<ThemeSection />);
    expect(await screen.findByText("Master your first Pokémon to unlock themes.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Practice" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: /Set as theme/ })).not.toBeInTheDocument();
  });

  it("Chinese theme picker: Pikachu's Simplified Chinese name", async () => {
    mockMastered.value = new Set([25]);
    mockLocale.value = "zh-Hans";
    renderWithIntl(<ThemeSection />, { locale: "zh-Hans" });
    expect(await screen.findByRole("button", { name: "把皮卡丘设为应用主题" })).toBeInTheDocument();
  });

  for (const [locale, name, label] of [
    ["ja", "カビゴン", "カビゴンをアプリのテーマにする"],
    ["zh-Hant", "卡比獸", "把卡比獸設為應用程式主題"],
  ] as const) {
    it(`theme picker names in ${locale}`, async () => {
      mockMastered.value = new Set([143]);
      mockLocale.value = locale;
      renderWithIntl(<ThemeSection />, { locale });
      expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
      expect(screen.getByText(name)).toBeInTheDocument();
    });
  }
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithIntl, screen, waitFor } from "@/components/test-utils/renderWithIntl";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/settings/persistence";
import { paletteFor } from "@/lib/theme/palette";
import { FavouriteThemeOffer } from "./FavouriteThemeOffer";

const { mockPartner, mockPretend } = vi.hoisted(() => ({
  mockPartner: { value: null as null | { speciesId: number; mastered: boolean } },
  mockPretend: { value: false },
}));
vi.mock("./usePartner", () => ({ usePartner: () => mockPartner.value }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: mockPretend.value } }),
}));

const PIKACHU_THEME = {
  id: 25,
  name: "Pikachu",
  colors: paletteFor(25)!,
  spriteUrl: "/sprites/pokemon/25.png",
};

beforeEach(() => {
  window.localStorage.clear();
  mockPretend.value = false;
  mockPartner.value = { speciesId: 94, mastered: true };
  saveSettings({
    ...DEFAULT_SETTINGS,
    favouritePokemonId: 94,
    heartedSpeciesIds: [94],
    favouriteTheme: PIKACHU_THEME,
  });
});

describe("FavouriteThemeOffer (#2187)", () => {
  const QUESTION = {
    en: "Switch to Gengar's colours?",
    ja: "Gengarのカラーに切り替えますか？",
    "zh-Hans": "切换为Gengar的配色吗？",
    "zh-Hant": "切換為Gengar的配色嗎？",
  } as const;

  for (const locale of Object.keys(QUESTION) as (keyof typeof QUESTION)[]) {
    it(`Gengar mastered: offers Gengar's colours (${locale})`, async () => {
      renderWithIntl(<FavouriteThemeOffer />, { locale });
      expect(await screen.findByText(QUESTION[locale])).toBeInTheDocument();
    });
  }

  it("Gengar mastered: Yes switches the theme and the offer is not repeated", async () => {
    const { unmount } = renderWithIntl(<FavouriteThemeOffer />);
    await userEvent.click(await screen.findByRole("button", { name: "Switch colours" }));
    await waitFor(() => expect(loadSettings().favouriteTheme?.id).toBe(94));
    const s = loadSettings();
    expect(s.favouriteTheme).toEqual({
      id: 94,
      name: "Gengar",
      colors: paletteFor(94),
      spriteUrl: "/sprites/pokemon/94.png",
    });
    expect(s.favouriteThemeOfferedForId).toBe(94);
    expect(screen.queryByText(QUESTION.en)).not.toBeInTheDocument();
    unmount();
    renderWithIntl(<FavouriteThemeOffer />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(QUESTION.en)).not.toBeInTheDocument();
  });

  it("Gengar mastered: No keeps the theme and the offer is not repeated", async () => {
    const { unmount } = renderWithIntl(<FavouriteThemeOffer />);
    await userEvent.click(await screen.findByRole("button", { name: "Keep my colours" }));
    const s = loadSettings();
    expect(s.favouriteTheme?.id).toBe(25);
    expect(s.favouriteThemeOfferedForId).toBe(94);
    unmount();
    renderWithIntl(<FavouriteThemeOffer />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(QUESTION.en)).not.toBeInTheDocument();
  });

  it("Favourite mastered with no theme set: still asks", async () => {
    saveSettings({ ...loadSettings(), favouriteTheme: null });
    renderWithIntl(<FavouriteThemeOffer />);
    expect(await screen.findByText(QUESTION.en)).toBeInTheDocument();
  });

  it("not offered while the favourite is unmastered", async () => {
    mockPartner.value = { speciesId: 94, mastered: false };
    renderWithIntl(<FavouriteThemeOffer />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(QUESTION.en)).not.toBeInTheDocument();
  });

  it("not offered when the theme is already the favourite", async () => {
    saveSettings({ ...loadSettings(), favouriteTheme: { ...PIKACHU_THEME, id: 94, name: "Gengar" } });
    renderWithIntl(<FavouriteThemeOffer />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(QUESTION.en)).not.toBeInTheDocument();
  });

  it("not offered under superuser pretendAllMastered, so fake mastery records no offer", async () => {
    mockPretend.value = true;
    renderWithIntl(<FavouriteThemeOffer />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(QUESTION.en)).not.toBeInTheDocument();
    expect(loadSettings().favouriteThemeOfferedForId).toBeNull();
  });
});

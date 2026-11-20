import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithIntl, screen, waitFor } from "@/components/test-utils/renderWithIntl";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/settings/persistence";
import type { AppLocale } from "@/i18n/locales";
import { FavouriteControls } from "./FavouriteControls";

const { mockCards } = vi.hoisted(() => ({ mockCards: { value: [] as unknown[] } }));
vi.mock("@/lib/review/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/review/persistence")>()),
  loadSession: () => Promise.resolve({ cards: mockCards.value }),
}));

beforeEach(() => {
  mockCards.value = [];
  window.localStorage.clear();
  saveSettings({ ...DEFAULT_SETTINGS });
});

const LABELS: Record<AppLocale, { make: string; heart: string; favouriteHeart: string; question: string }> = {
  en: {
    make: "Make Gengar your favourite",
    heart: "Heart Gengar",
    favouriteHeart: "Gengar is your favourite, so it stays hearted",
    question: "Learn Gengar's evolution line next?",
  },
  ja: {
    make: "Gengarをお気に入りにする",
    heart: "Gengarにハートをつける",
    favouriteHeart: "Gengarはお気に入りなので、ハートはついたままです",
    question: "Gengarの進化系統を次に覚えますか？",
  },
  "zh-Hans": {
    make: "把Gengar设为你的最爱",
    heart: "给Gengar点亮爱心",
    favouriteHeart: "Gengar是你的最爱，爱心会一直保留",
    question: "接下来学习Gengar的进化链吗？",
  },
  "zh-Hant": {
    make: "把Gengar設為你的最愛",
    heart: "為Gengar點亮愛心",
    favouriteHeart: "Gengar是你的最愛，愛心會一直保留",
    question: "接下來學習Gengar的進化鏈嗎？",
  },
};

describe("FavouriteControls (#2187)", () => {
  for (const locale of Object.keys(LABELS) as AppLocale[]) {
    it(`Screen reader: toggle buttons with localised labels (${locale})`, async () => {
      renderWithIntl(<FavouriteControls speciesId={94} name="Gengar" />, { locale });
      const make = await screen.findByRole("button", { name: LABELS[locale].make });
      const heart = screen.getByRole("button", { name: LABELS[locale].heart });
      expect(make).toHaveAttribute("aria-pressed", "false");
      expect(heart).toHaveAttribute("aria-pressed", "false");

      await userEvent.click(make);
      expect(make).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: LABELS[locale].favouriteHeart })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(LABELS[locale].question)).toBeInTheDocument();
    });
  }

  it("Favourite before learning it: sets the favourite and hearts it, theme untouched", async () => {
    renderWithIntl(<FavouriteControls speciesId={1} name="#001" />);
    await userEvent.click(await screen.findByRole("button", { name: "Make #001 your favourite" }));
    const s = loadSettings();
    expect(s.favouritePokemonId).toBe(1);
    expect(s.heartedSpeciesIds).toEqual([1]);
    expect(s.favouriteTheme).toBeNull();
  });

  it("Heart and un-heart: newest first, then removed", async () => {
    saveSettings({ ...loadSettings(), heartedSpeciesIds: [25] });
    renderWithIntl(<FavouriteControls speciesId={143} name="Snorlax" />);
    const heart = await screen.findByRole("button", { name: "Heart Snorlax" });
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(heart);
    expect(loadSettings().heartedSpeciesIds).toEqual([143, 25]);
    expect(heart).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(heart);
    expect(loadSettings().heartedSpeciesIds).toEqual([25]);
  });

  it("The favourite's heart: tapping it keeps it hearted", async () => {
    saveSettings({ ...loadSettings(), favouritePokemonId: 94, heartedSpeciesIds: [94] });
    renderWithIntl(<FavouriteControls speciesId={94} name="Gengar" />);
    const heart = await screen.findByRole("button", { name: "Gengar is your favourite, so it stays hearted" });
    await userEvent.click(heart);
    expect(loadSettings().heartedSpeciesIds).toEqual([94]);
    expect(heart).toHaveAttribute("aria-pressed", "true");
  });

  it("Clear from the Pokédex: tapping Make favourite again clears it, hearts kept", async () => {
    saveSettings({ ...loadSettings(), favouritePokemonId: 94, heartedSpeciesIds: [94] });
    renderWithIntl(<FavouriteControls speciesId={94} name="Gengar" />);
    const make = await screen.findByRole("button", { name: "Make Gengar your favourite" });
    await waitFor(() => expect(make).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(make);
    expect(loadSettings().favouritePokemonId).toBeNull();
    expect(loadSettings().heartedSpeciesIds).toEqual([94]);
  });

  it("Yes: puts Haunter's line in the learn-first list", async () => {
    renderWithIntl(<FavouriteControls speciesId={93} name="Haunter" />);
    await userEvent.click(await screen.findByRole("button", { name: "Make Haunter your favourite" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(loadSettings().priorityNewSpeciesIds).toEqual([92, 93, 94]));
    expect(screen.queryByText("Learn Haunter's evolution line next?")).not.toBeInTheDocument();
  });

  it("No: changes nothing and the question is not asked again for that species", async () => {
    const { unmount } = renderWithIntl(<FavouriteControls speciesId={93} name="Haunter" />);
    const make = await screen.findByRole("button", { name: "Make Haunter your favourite" });
    await userEvent.click(make);
    await userEvent.click(screen.getByRole("button", { name: "No, thanks" }));
    expect(loadSettings().priorityNewSpeciesIds).toEqual([]);
    expect(loadSettings().learnFirstAskedSpeciesIds).toEqual([93]);
    // Clear and set again: no second question.
    await userEvent.click(make);
    await userEvent.click(make);
    expect(screen.queryByText("Learn Haunter's evolution line next?")).not.toBeInTheDocument();
    unmount();
  });

  it("Second device: a question already asked on another device is not asked again", async () => {
    saveSettings({ ...loadSettings(), learnFirstAskedSpeciesIds: [93] });
    renderWithIntl(<FavouriteControls speciesId={93} name="Haunter" />);
    await userEvent.click(await screen.findByRole("button", { name: "Make Haunter your favourite" }));
    expect(screen.queryByText("Learn Haunter's evolution line next?")).not.toBeInTheDocument();
  });

  it("Already mastered: no question is asked", async () => {
    const mastered = { stability: 30, firstSeen: "2026-01-01", lastReview: "2026-02-01", dueDate: "2026-03-01" };
    mockCards.value = [
      { cardType: "name", id: 94, locale: "en", state: mastered },
      { cardType: "reverse", id: 2_000_094, locale: "en", state: mastered },
    ];
    renderWithIntl(<FavouriteControls speciesId={94} name="Gengar" />);
    await userEvent.click(await screen.findByRole("button", { name: "Make Gengar your favourite" }));
    expect(loadSettings().favouritePokemonId).toBe(94);
    expect(screen.queryByText("Learn Gengar's evolution line next?")).not.toBeInTheDocument();
  });
});

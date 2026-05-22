/**
 * Component tests for ThemeWatermark.
 *
 * Lives under components/ so the jsdom vitest project picks it up — see
 * AGENTS.md "Testing" for the node/jsdom partitioning rules.
 */

import { render } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { THEME_WATERMARK_SPRITE_SIZE } from "@/lib/sprites/sizes";

// Bypass next/image — render as a plain <img> so jsdom does not need an HTTP
// server for sprite URLs.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

// Control useFavourite and loadSettings return values per test.
const { mockUseFavourite, mockLoadSettings } = vi.hoisted(() => ({
  mockUseFavourite: vi.fn(),
  mockLoadSettings: vi.fn(),
}));

vi.mock("./FavouriteThemeProvider", () => ({
  useFavourite: () => mockUseFavourite(),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

import { ThemeWatermark } from "./ThemeWatermark";

const favouriteWithSprite = {
  id: 6,
  name: "charizard",
  colors: null,
  spriteUrl: "/sprites/pokemon/6.png",
};

describe("ThemeWatermark", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-intensity");
  });

  it("renders nothing when intensity is accents", () => {
    mockLoadSettings.mockReturnValue({ themeIntensity: "accents" });
    mockUseFavourite.mockReturnValue({ favourite: favouriteWithSprite, updateFavourite: vi.fn() });
    const { container } = render(<ThemeWatermark />);
    expect(container.querySelector("[data-testid='theme-watermark']")).toBeNull();
  });

  it("renders the watermark image with THEME_WATERMARK_SPRITE_SIZE when intensity is tinted and a favourite is set", () => {
    // Set the DOM attribute so the useEffect's syncFromAttribute() keeps
    // intensity as "tinted" after the initial render.
    document.documentElement.setAttribute("data-intensity", "tinted");
    mockLoadSettings.mockReturnValue({ themeIntensity: "tinted" });
    mockUseFavourite.mockReturnValue({ favourite: favouriteWithSprite, updateFavourite: vi.fn() });

    const { container } = render(<ThemeWatermark />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("width", String(THEME_WATERMARK_SPRITE_SIZE));
    expect(img).toHaveAttribute("height", String(THEME_WATERMARK_SPRITE_SIZE));
  });

  it("renders the fallback PokeBall SVG when intensity is tinted but favourite has no sprite URL", () => {
    document.documentElement.setAttribute("data-intensity", "tinted");
    mockLoadSettings.mockReturnValue({ themeIntensity: "tinted" });
    mockUseFavourite.mockReturnValue({
      favourite: { id: 6, name: "charizard", colors: null, spriteUrl: null },
      updateFavourite: vi.fn(),
    });

    const { container } = render(<ThemeWatermark />);
    expect(container.querySelector("[data-testid='theme-watermark']")).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

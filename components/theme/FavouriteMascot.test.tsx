/**
 * Component tests for FavouriteMascot.
 *
 * Lives under components/ so the jsdom vitest project picks it up — see
 * AGENTS.md "Testing" for the node/jsdom partitioning rules.
 */

import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FAVOURITE_MASCOT_SPRITE_SIZE } from "@/lib/sprites/sizes";

// Bypass next/image — render as a plain <img> so jsdom does not need an HTTP
// server for sprite URLs.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

// Control useFavourite return value per test.
const { mockUseFavourite } = vi.hoisted(() => ({
  mockUseFavourite: vi.fn(),
}));

vi.mock("./FavouriteThemeProvider", () => ({
  useFavourite: () => mockUseFavourite(),
}));

import { FavouriteMascot } from "./FavouriteMascot";

describe("FavouriteMascot", () => {
  it("renders nothing when favourite is null", () => {
    mockUseFavourite.mockReturnValue({ favourite: null, updateFavourite: vi.fn() });
    const { container } = render(<FavouriteMascot />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when favourite.spriteUrl is null", () => {
    mockUseFavourite.mockReturnValue({
      favourite: { id: 25, name: "pikachu", colors: null, spriteUrl: null },
      updateFavourite: vi.fn(),
    });
    const { container } = render(<FavouriteMascot />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an image with FAVOURITE_MASCOT_SPRITE_SIZE dimensions when a favourite is set", () => {
    mockUseFavourite.mockReturnValue({
      favourite: {
        id: 25,
        name: "pikachu",
        colors: null,
        spriteUrl: "/sprites/pokemon/25.png",
      },
      updateFavourite: vi.fn(),
    });
    const { container } = render(<FavouriteMascot />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("width", String(FAVOURITE_MASCOT_SPRITE_SIZE));
    expect(img).toHaveAttribute("height", String(FAVOURITE_MASCOT_SPRITE_SIZE));
    expect(img).toHaveAttribute("src", "/sprites/pokemon/25.png");
  });
});

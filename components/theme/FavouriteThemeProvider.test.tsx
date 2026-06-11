/**
 * Component tests for FavouriteThemeProvider - grandfather rule (#1865).
 *
 * Lives under components/ so the jsdom vitest project picks it up.
 */

import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CURATED_POKEMON } from "@/lib/theme/curated-pokemon";

const SAMPLE = CURATED_POKEMON[0];
const SAMPLE_FAV = {
  id: SAMPLE.id,
  name: SAMPLE.name,
  colors: SAMPLE.colors,
  spriteUrl: `/sprites/pokemon/${SAMPLE.id}.png`,
};

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------

const { mockLoadFavourite, mockSaveFavourite, mockApplyTheme, mockApplyIntensity, mockLoadSettings } =
  vi.hoisted(() => ({
    mockLoadFavourite: vi.fn(() => null as typeof SAMPLE_FAV | null),
    mockSaveFavourite: vi.fn(),
    mockApplyTheme: vi.fn(),
    mockApplyIntensity: vi.fn(),
    mockLoadSettings: vi.fn(() => ({ themeIntensity: "medium" })),
  }));

vi.mock("@/lib/theme/persistence", () => ({
  loadFavourite: () => mockLoadFavourite(),
  saveFavourite: (...args: unknown[]) => mockSaveFavourite(...args),
}));

vi.mock("@/lib/theme/apply", () => ({
  applyTheme: (...args: unknown[]) => mockApplyTheme(...args),
}));

vi.mock("@/lib/theme/intensity", () => ({
  applyIntensity: (...args: unknown[]) => mockApplyIntensity(...args),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

import { FavouriteThemeProvider, useFavourite } from "./FavouriteThemeProvider";

// A tiny consumer that surfaces the favourite value for assertions.
function FavouriteReadout() {
  const { favourite } = useFavourite();
  return <div data-testid="favourite">{favourite ? String(favourite.id) : "null"}</div>;
}

describe("FavouriteThemeProvider - grandfather rule (#1865)", () => {
  beforeEach(() => {
    mockLoadFavourite.mockReturnValue(null);
    mockSaveFavourite.mockClear();
    mockApplyTheme.mockClear();
  });

  it("applies a stored favourite on load without calling saveFavourite(null)", async () => {
    // Simulate a user whose stored favourite has a name-leg-only mastery (pre-#1865).
    // The grandfather rule: the provider must NOT wipe it on load.
    mockLoadFavourite.mockReturnValue(SAMPLE_FAV);

    const { getByTestId } = render(
      <FavouriteThemeProvider>
        <FavouriteReadout />
      </FavouriteThemeProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("favourite").textContent).toBe(String(SAMPLE.id));
    });

    // saveFavourite(null) must NOT have been called - no auto-wipe on load.
    expect(mockSaveFavourite).not.toHaveBeenCalledWith(null);
  });

  it("keeps null favourite as null and does not call saveFavourite", async () => {
    mockLoadFavourite.mockReturnValue(null);

    const { getByTestId } = render(
      <FavouriteThemeProvider>
        <FavouriteReadout />
      </FavouriteThemeProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("favourite").textContent).toBe("null");
    });

    expect(mockSaveFavourite).not.toHaveBeenCalled();
  });

  it("applyTheme is called with stored favourite colours on load", async () => {
    mockLoadFavourite.mockReturnValue(SAMPLE_FAV);

    render(
      <FavouriteThemeProvider>
        <FavouriteReadout />
      </FavouriteThemeProvider>,
    );

    await waitFor(() => {
      expect(mockApplyTheme).toHaveBeenCalledWith(SAMPLE_FAV.colors);
    });
  });
});

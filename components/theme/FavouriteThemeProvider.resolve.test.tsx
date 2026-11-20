/**
 * FavouriteThemeProvider when the on-demand palette module is slow or fails
 * to load (#2187). Each test re-imports the provider so the palette module
 * mock is evaluated afresh.
 */

import { render, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CURATED_POKEMON } from "@/lib/theme/curated-pokemon";

const SAMPLE = CURATED_POKEMON[0];
const STORED_COLOURS = { ...SAMPLE.colors, fgOnPrimary: "#123456" };
const SAMPLE_FAV = { id: SAMPLE.id, name: SAMPLE.name, colors: STORED_COLOURS, spriteUrl: null };

const { mockLoadFavourite, mockApplyTheme, palette } = vi.hoisted(() => {
  let release: () => void = () => {};
  return {
    mockLoadFavourite: vi.fn(() => null as unknown),
    mockApplyTheme: vi.fn(),
    palette: {
      fail: false,
      gate: Promise.resolve() as Promise<void>,
      hold() {
        this.gate = new Promise<void>((r) => { release = r; });
      },
      release: () => release(),
    },
  };
});

vi.mock("@/lib/theme/persistence", () => ({ loadFavourite: () => mockLoadFavourite() }));
vi.mock("@/lib/theme/apply", () => ({ applyTheme: (...args: unknown[]) => mockApplyTheme(...args) }));
vi.mock("@/lib/theme/intensity", () => ({ applyIntensity: vi.fn() }));
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => ({ themeIntensity: "accents" }),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));
vi.mock("@/lib/theme/palette", async (importOriginal) => {
  await palette.gate;
  if (palette.fail) throw new Error("Loading chunk failed");
  return importOriginal();
});

async function renderProvider() {
  vi.resetModules();
  const { FavouriteThemeProvider } = await import("./FavouriteThemeProvider");
  return render(<FavouriteThemeProvider><div /></FavouriteThemeProvider>);
}

beforeEach(() => {
  mockApplyTheme.mockClear();
  palette.fail = false;
  palette.gate = Promise.resolve();
});

describe("FavouriteThemeProvider - palette module load (#2187)", () => {
  it("falls back to the stored colours when the palette module fails to load", async () => {
    palette.fail = true;
    mockLoadFavourite.mockReturnValue(SAMPLE_FAV);

    await renderProvider();

    await waitFor(() => expect(mockApplyTheme).toHaveBeenCalledWith(STORED_COLOURS));
  });

  it("ignores a slow resolve once a newer one has applied (theme removed meanwhile)", async () => {
    palette.hold();
    mockLoadFavourite.mockReturnValue(SAMPLE_FAV);
    await renderProvider();

    // The favourite is removed while the first resolve waits on the module.
    mockLoadFavourite.mockReturnValue(null);
    act(() => {
      window.dispatchEvent(new CustomEvent("poke-memory:settings-saved"));
    });
    await waitFor(() => expect(mockApplyTheme).toHaveBeenCalledWith(null));

    await act(async () => {
      palette.release();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockApplyTheme).toHaveBeenLastCalledWith(null);
  });
});

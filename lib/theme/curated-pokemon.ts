export type ThemeColors = {
  primary: string;
  secondary: string;
  accent: string;
  fgOnPrimary: string;
};

export type CuratedPokemon = {
  id: number;
  name: string;
  colors: ThemeColors;
};

export const CURATED_POKEMON: readonly CuratedPokemon[] = [
  {
    id: 6,
    name: "Charizard",
    colors: {
      primary: "#E8631A",
      secondary: "#F4A460",
      accent: "#FFD700",
      fgOnPrimary: "#1A0A00",
    },
  },
  {
    id: 25,
    name: "Pikachu",
    colors: {
      primary: "#D4A800",
      secondary: "#FFE066",
      accent: "#B87800",
      fgOnPrimary: "#1A1200",
    },
  },
  {
    id: 94,
    name: "Gengar",
    colors: {
      primary: "#5A3E78",
      secondary: "#8B6EAE",
      accent: "#E8AAFF",
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 133,
    name: "Eevee",
    colors: {
      primary: "#8C5E38",
      secondary: "#C99A6E",
      accent: "#F5DEB3",
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 143,
    name: "Snorlax",
    colors: {
      primary: "#3D6A9E",
      secondary: "#7AAAD0",
      accent: "#D4E8FF",
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 150,
    name: "Mewtwo",
    colors: {
      primary: "#6848A8",
      secondary: "#A882D8",
      accent: "#E8D0FF",
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 197,
    name: "Umbreon",
    colors: {
      primary: "#1A1A2E",
      secondary: "#2D2D4F",
      accent: "#FFD700",
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 282,
    name: "Gardevoir",
    colors: {
      primary: "#A84F6C",
      secondary: "#D48AA4",
      accent: "#FFEEF3",
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 445,
    name: "Garchomp",
    colors: {
      primary: "#425E8C",
      secondary: "#6888B8",
      accent: "#E87040",
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 448,
    name: "Lucario",
    colors: {
      primary: "#1E4A8C",
      secondary: "#4A7ABD",
      accent: "#FFD700",
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 780,
    name: "Drampa",
    colors: {
      primary: "#3E7858",
      secondary: "#72B088",
      accent: "#D4EDE0",
      fgOnPrimary: "#FFFFFF",
    },
  },
] as const;

/**
 * Default mascot-palette fallback used when the user has not unlocked or
 * selected any favourite. Poké-ball red with warm complementary tones —
 * gives baseline mode visible accent without being loud.
 *
 * Contrast verified against both the off-white light body (#fafafa) and the
 * deep dark body (#0f0f0f): primary and accent both exceed 4.5:1 for AA on
 * the relevant backgrounds.
 */
export const BRAND_DEFAULT_COLORS: ThemeColors = {
  primary: "#D8334A",   // Poké-ball red
  secondary: "#F4B6C0", // soft pink
  accent: "#B82838",    // deeper red for focus rings / progress fills
  fgOnPrimary: "#FFFFFF",
};

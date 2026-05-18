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
      accent: "#36B3A6", // teal wing membrane
      fgOnPrimary: "#1A0A00",
    },
  },
  {
    id: 25,
    name: "Pikachu",
    colors: {
      primary: "#D4A800",
      secondary: "#FFE066",
      accent: "#E25C4C", // red cheeks
      fgOnPrimary: "#1A1200",
    },
  },
  {
    id: 94,
    name: "Gengar",
    colors: {
      primary: "#5A3E78",
      secondary: "#8B6EAE",
      accent: "#E23B3B", // red eyes
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
      accent: "#E9DCB5", // cream belly/face
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 150,
    name: "Mewtwo",
    colors: {
      primary: "#6848A8",
      secondary: "#A882D8",
      accent: "#4A2E7A", // deep-purple tail
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
      primary: "#3FA98C", // green hair/arms
      secondary: "#7FCBB5",
      accent: "#E0556B", // red chest fin
      // White body fails AA on this teal-green primary (2.9:1); dark fg needed.
      fgOnPrimary: "#07251C",
    },
  },
  {
    id: 445,
    name: "Garchomp",
    colors: {
      primary: "#425E8C",
      secondary: "#6888B8",
      accent: "#D8443C", // belly red
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 448,
    name: "Lucario",
    colors: {
      primary: "#1E4A8C",
      secondary: "#4A7ABD",
      accent: "#E6D6B0", // cream chest
      fgOnPrimary: "#FFFFFF",
    },
  },
  {
    id: 780,
    name: "Drampa",
    colors: {
      primary: "#3E7858",
      secondary: "#72B088",
      accent: "#EFE9DA", // cream mane
      fgOnPrimary: "#FFFFFF",
    },
  },
] as const;

/**
 * Default mascot-palette fallback used when the user has not unlocked or
 * selected any favourite. Poké-ball red with warm complementary tones —
 * gives baseline mode visible accent without being loud.
 *
 * These reds are used as background/fill colours, not as foreground text on
 * the page body. White fgOnPrimary achieves ≈4.8:1 on the primary, meeting
 * WCAG AA. Do not use primary or accent as text on dark surfaces — primary
 * (#E01B2E) scores ≈4.0:1 and accent (#C2162A) scores ≈3.1:1 against
 * #0f0f0f, both below the 4.5:1 AA threshold.
 */
export const BRAND_DEFAULT_COLORS: ThemeColors = {
  primary: "#E01B2E",   // Poké-ball red
  secondary: "#FF9DA6", // soft pink
  accent: "#C2162A",    // deeper red for focus rings / progress fills
  fgOnPrimary: "#FFFFFF",
};

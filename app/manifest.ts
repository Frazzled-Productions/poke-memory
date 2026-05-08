import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Poké Memory",
    short_name: "Poké Memory",
    description:
      "Spaced-repetition Pokémon flashcards for learning the names of all 1025 Pokémon.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#DC0A2D",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}

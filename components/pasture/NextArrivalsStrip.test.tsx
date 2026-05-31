import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithIntl as render } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (_id: number | undefined, englishName: string) => ({
    name: englishName,
    transliteration: null,
  }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { NextArrivalsStrip } from "@/components/pasture/NextArrivalsStrip";
import type { NextArrival } from "@/lib/pasture/nextArrivals";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 5,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 10,
    reps: 2,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-05-25",
    lastReview: "2026-05-15",
    firstSeen: "2026-04-01",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

function makeArrival(id: number, name: string, reps = 2): NextArrival {
  return {
    id,
    speciesId: id,
    name,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    state: makeState({ reps }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NextArrivalsStrip — empty state", () => {
  it("renders the 'Next arrivals' heading", () => {
    render(<NextArrivalsStrip arrivals={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Next arrivals" }),
    ).toBeInTheDocument();
  });

  it("shows an all-caught-up message when arrivals is empty", () => {
    render(<NextArrivalsStrip arrivals={[]} />);
    expect(
      screen.getByText(/All reviewed Pokémon are already in your Pasture/i),
    ).toBeInTheDocument();
  });

  it("does not render a list when arrivals is empty", () => {
    render(<NextArrivalsStrip arrivals={[]} />);
    expect(
      screen.queryByRole("list", { name: "Upcoming Pasture species" }),
    ).not.toBeInTheDocument();
  });
});

describe("NextArrivalsStrip — with arrivals", () => {
  it("renders the arrivals list", () => {
    const arrivals = [makeArrival(1, "Bulbasaur"), makeArrival(4, "Charmander")];
    render(<NextArrivalsStrip arrivals={arrivals} />);
    expect(
      screen.getByRole("list", { name: "Upcoming Pasture species" }),
    ).toBeInTheDocument();
  });

  it("renders one item per arrival", () => {
    const arrivals = [
      makeArrival(1, "Bulbasaur"),
      makeArrival(4, "Charmander"),
      makeArrival(7, "Squirtle"),
    ];
    render(<NextArrivalsStrip arrivals={arrivals} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
  });

  it("renders each species' name", () => {
    const arrivals = [makeArrival(1, "Bulbasaur"), makeArrival(4, "Charmander")];
    render(<NextArrivalsStrip arrivals={arrivals} />);
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByText("Charmander")).toBeInTheDocument();
  });

  it("renders each sprite with the species name as alt text", () => {
    const arrivals = [makeArrival(1, "Bulbasaur")];
    render(<NextArrivalsStrip arrivals={arrivals} />);
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
  });

  it("renders the correct sprite src", () => {
    const arrivals = [makeArrival(25, "Pikachu")];
    render(<NextArrivalsStrip arrivals={arrivals} />);
    const img = screen.getByAltText("Pikachu");
    expect(img).toHaveAttribute("src", "/sprites/pokemon/25.png");
  });

  it("renders the reps count as a badge for each arrival", () => {
    const arrivals = [makeArrival(1, "Bulbasaur", 2)];
    render(<NextArrivalsStrip arrivals={arrivals} />);
    // The reps badge is aria-hidden; find it by text content
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("does not show the all-caught-up message when arrivals exist", () => {
    const arrivals = [makeArrival(1, "Bulbasaur")];
    render(<NextArrivalsStrip arrivals={arrivals} />);
    expect(
      screen.queryByText(/All reviewed Pokémon are already in your Pasture/i),
    ).not.toBeInTheDocument();
  });

  it("the section has an accessible label of 'Next arrivals'", () => {
    render(<NextArrivalsStrip arrivals={[makeArrival(1, "Bulbasaur")]} />);
    expect(screen.getByRole("region", { name: "Next arrivals" })).toBeInTheDocument();
  });
});

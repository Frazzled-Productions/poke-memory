import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MultipleChoiceNameCard, FEEDBACK_HOLD_MS } from "./MultipleChoiceNameCard";
import type { Grade } from "@/lib/review/session";

// Stub next/image — same pattern as TypedEntryNameCard.test.tsx.
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

function makeOption(id: number, name: string, isCorrect: boolean) {
  return {
    isCorrect,
    pokemon: {
      id,
      speciesId: id,
      isDefaultForm: true,
      formCategory: "default" as const,
      formSlug: null,
      displayName: name,
      name: name.toLowerCase(),
      spriteUrl: `/sprites/${id}.png`,
      types: ["normal"],
      stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
      flavorText: "test",
      flavorTexts: [],
      evolutionChain: [],
      height: 7,
      weight: 69,
      baseExperience: 64,
      genus: "Seed Pokémon",
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 50,
      growthRate: "medium-slow",
      habitat: "grassland",
      genderRate: 1,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
    },
  };
}

const DEFAULT_OPTIONS = [
  makeOption(1, "Bulbasaur", true),
  makeOption(4, "Charmander", false),
  makeOption(7, "Squirtle", false),
  makeOption(25, "Pikachu", false),
];

type TestProps = {
  options?: typeof DEFAULT_OPTIONS;
  canonicalName?: string;
  onGrade?: (grade: Grade) => void;
  grading?: boolean;
};

function renderCard(overrides?: TestProps) {
  const onGrade = overrides?.onGrade ?? vi.fn<(grade: Grade) => void>();
  render(
    <MultipleChoiceNameCard
      spriteUrl="/sprites/1.png"
      canonicalName={overrides?.canonicalName ?? "Bulbasaur"}
      options={overrides?.options ?? DEFAULT_OPTIONS}
      id={1}
      onGrade={onGrade}
      grading={overrides?.grading}
    />,
  );
  return { onGrade };
}

describe("MultipleChoiceNameCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the sprite and all 4 option buttons", () => {
    renderCard();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByText("Charmander")).toBeInTheDocument();
    expect(screen.getByText("Squirtle")).toBeInTheDocument();
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
  });

  it("fires Good (4) when the correct option is clicked", () => {
    const { onGrade } = renderCard();
    fireEvent.click(screen.getByText("Bulbasaur"));
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
    expect(onGrade).toHaveBeenCalledTimes(1);
  });

  it("fires Again (1) when a wrong option is clicked", () => {
    const { onGrade } = renderCard();
    fireEvent.click(screen.getByText("Charmander"));
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(1);
    expect(onGrade).toHaveBeenCalledTimes(1);
  });

  /**
   * Returns the aria-live feedback region (not the DirectionBadge, which also
   * carries role="status"). The feedback div is distinguished by aria-atomic.
   */
  function getFeedbackRegion(): HTMLElement {
    return screen
      .getAllByRole("status")
      .find((el) => el.getAttribute("aria-atomic") === "true")!;
  }

  it("shows Correct! feedback immediately after clicking the right answer", () => {
    renderCard();
    fireEvent.click(screen.getByText("Bulbasaur"));
    // Feedback is visible before the timer fires.
    expect(getFeedbackRegion()).toHaveTextContent("Correct!");
  });

  it("reveals the correct name on a wrong answer", () => {
    renderCard();
    fireEvent.click(screen.getByText("Charmander"));
    // The aria-live region should contain the correction.
    const fb = getFeedbackRegion();
    expect(fb).toHaveTextContent("Not quite.");
    expect(fb).toHaveTextContent("Bulbasaur");
  });

  it("disables all buttons after a choice is made", () => {
    renderCard();
    fireEvent.click(screen.getByText("Bulbasaur"));
    for (const btn of screen.getAllByRole("button")) {
      expect(btn).toBeDisabled();
    }
  });

  it("does not fire onGrade a second time when clicking after submission", () => {
    const { onGrade } = renderCard();
    fireEvent.click(screen.getByText("Bulbasaur"));
    // Buttons are disabled post-choice, so a second click should be a no-op.
    fireEvent.click(screen.getByText("Charmander"));
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledTimes(1);
  });

  it("disables all buttons while grading prop is true", () => {
    renderCard({ grading: true });
    for (const btn of screen.getAllByRole("button")) {
      expect(btn).toBeDisabled();
    }
  });

  it("onGrade is only called after FEEDBACK_HOLD_MS delay", () => {
    const { onGrade } = renderCard();
    fireEvent.click(screen.getByText("Bulbasaur"));
    // Not yet called before timer fires.
    expect(onGrade).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS - 1); });
    expect(onGrade).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });
});

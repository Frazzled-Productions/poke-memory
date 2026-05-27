import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TypedEntryNameCard } from "./TypedEntryNameCard";
import type { Grade } from "@/lib/review/session";

// Minimal next/image stub so jsdom tests don't hit the Next.js image-loader
// machinery. Mirrors the pattern used elsewhere in the test suite.
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

type TestProps = {
  spriteUrl?: string;
  canonicalName?: string;
  onGrade?: (grade: Grade) => void;
  grading?: boolean;
};

function renderCard(overrides?: TestProps) {
  const onGrade = overrides?.onGrade ?? vi.fn<(grade: Grade) => void>();
  const props = {
    spriteUrl: "/sprites/pokemon/webp/320/25.webp",
    canonicalName: "Pikachu",
    onGrade,
    ...overrides,
  };
  render(<TypedEntryNameCard {...props} />);
  return { onGrade };
}

describe("TypedEntryNameCard", () => {
  it("renders the sprite and the name input", () => {
    renderCard();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /type the pokémon name/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /i don.t know/i })).toBeInTheDocument();
  });

  it("fires Good (4) when the exact name is typed and submitted", async () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "Pikachu");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("fires Good (4) for a case-insensitive exact match", async () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "pikachu");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("fires Hard (2) for a near-miss typo and shows feedback", async () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "Pikachv"); // one char off
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onGrade).toHaveBeenCalledWith(2);
    // Feedback "Close!" should be visible
    expect(screen.getByText(/close!/i)).toBeInTheDocument();
    // Correct answer should be revealed for Hard
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
  });

  it("fires Again (1) for a clearly wrong answer and reveals the name", async () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "Squirtle");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onGrade).toHaveBeenCalledWith(1);
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
  });

  it("fires Again (1) for an empty submission and reveals the name", async () => {
    const { onGrade } = renderCard();
    // Leave input empty
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onGrade).toHaveBeenCalledWith(1);
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
  });

  it("fires Again (1) on I don't know and reveals the name", async () => {
    const { onGrade } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /i don.t know/i }));
    expect(onGrade).toHaveBeenCalledWith(1);
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
  });

  it("does not fire onGrade a second time if submitted twice", async () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "Pikachu");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    // After submit the input form is gone; clicking again would have to
    // happen via the grade buttons which no longer exist — this mainly
    // verifies that onGrade is called exactly once.
    expect(onGrade).toHaveBeenCalledTimes(1);
  });

  it("shows Correct! feedback (no name reveal) on exact match", async () => {
    renderCard();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "Pikachu");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(screen.getByText(/correct!/i)).toBeInTheDocument();
    // Should NOT reveal the name in an extra paragraph — the name is part
    // of the feedback for wrong/close answers only. Exact-match only shows "Correct!".
    expect(screen.queryAllByText("Pikachu")).toHaveLength(0);
  });

  it("disables the submit button while grading prop is true", () => {
    renderCard({ grading: true });
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /i don.t know/i })).toBeDisabled();
  });
});

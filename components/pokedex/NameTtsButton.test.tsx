import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { NameTtsButton, REVEAL_SPEAK_BUTTON_CLASS, INLINE_SPEAK_BUTTON_CLASS } from "@/components/pokedex/NameTtsButton";

const { mockSpeakName } = vi.hoisted(() => ({ mockSpeakName: vi.fn() }));
vi.mock("@/lib/audio/tts", () => ({ speakName: mockSpeakName }));

describe("NameTtsButton", () => {
  it('renders the correct aria-label', () => {
    render(<NameTtsButton name="pikachu" />);
    expect(screen.getByRole("button", { name: "Hear pikachu" })).toBeInTheDocument();
  });

  it('defaults to the "reveal" size', () => {
    render(<NameTtsButton name="pikachu" />);
    const btn = screen.getByRole("button", { name: "Hear pikachu" });
    expect(btn).toHaveClass("h-11", "w-11");
  });

  it('applies the "inline" size classes when size="inline"', () => {
    render(<NameTtsButton name="pikachu" size="inline" />);
    const btn = screen.getByRole("button", { name: "Hear pikachu" });
    expect(btn).toHaveClass("h-7", "w-7", "ml-1", "inline-flex");
  });

  it('applies the "reveal" size classes when size="reveal"', () => {
    render(<NameTtsButton name="pikachu" size="reveal" />);
    const btn = screen.getByRole("button", { name: "Hear pikachu" });
    expect(btn).toHaveClass("h-11", "w-11", "flex");
  });

  it("calls speakName with the correct name and id on click", async () => {
    const user = userEvent.setup();
    render(<NameTtsButton name="bulbasaur" id={1} />);
    await user.click(screen.getByRole("button", { name: "Hear bulbasaur" }));
    expect(mockSpeakName).toHaveBeenCalledWith("bulbasaur", 1);
  });

  it("calls speakName without an id when id is omitted", async () => {
    const user = userEvent.setup();
    render(<NameTtsButton name="mewtwo" />);
    await user.click(screen.getByRole("button", { name: "Hear mewtwo" }));
    expect(mockSpeakName).toHaveBeenCalledWith("mewtwo", undefined);
  });

  it("exports REVEAL_SPEAK_BUTTON_CLASS matching the reveal button className", () => {
    render(<NameTtsButton name="test" size="reveal" />);
    const btn = screen.getByRole("button", { name: "Hear test" });
    // Spot-check key tokens from the exported constant
    expect(REVEAL_SPEAK_BUTTON_CLASS).toContain("h-11");
    expect(REVEAL_SPEAK_BUTTON_CLASS).toContain("w-11");
    expect(REVEAL_SPEAK_BUTTON_CLASS).toContain("text-xl");
    // The button's className should include all tokens
    for (const token of REVEAL_SPEAK_BUTTON_CLASS.split(" ")) {
      expect(btn.className).toContain(token);
    }
  });

  it("exports INLINE_SPEAK_BUTTON_CLASS matching the inline button className", () => {
    render(<NameTtsButton name="test" size="inline" />);
    const btn = screen.getByRole("button", { name: "Hear test" });
    expect(INLINE_SPEAK_BUTTON_CLASS).toContain("h-7");
    expect(INLINE_SPEAK_BUTTON_CLASS).toContain("w-7");
    expect(INLINE_SPEAK_BUTTON_CLASS).toContain("ml-1");
    for (const token of INLINE_SPEAK_BUTTON_CLASS.split(" ")) {
      expect(btn.className).toContain(token);
    }
  });
});

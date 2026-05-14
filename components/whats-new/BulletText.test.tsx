import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BulletText } from "./BulletText";

describe("BulletText", () => {
  it("renders plain text unchanged", () => {
    render(<BulletText text="Just plain text." />);
    expect(screen.getByText("Just plain text.")).toBeInTheDocument();
  });

  it("renders backtick spans as code", () => {
    const { container } = render(<BulletText text="See `card_reviews` table." />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("card_reviews");
  });

  it("renders Markdown links to https URLs as anchor tags", () => {
    render(<BulletText text="See [the docs](https://example.com/x) for more." />);
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
  });

  it("renders Markdown links whose URL contains balanced parens", () => {
    render(
      <BulletText
        text="See [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) for context."
      />,
    );
    const link = screen.getByRole("link", { name: "Foo" });
    expect(link).toHaveAttribute(
      "href",
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
    // The trailing prose should still render as plain text after the link.
    expect(screen.getByText(/for context\./)).toBeInTheDocument();
  });

  it("renders non-http link URLs as plain label text", () => {
    render(<BulletText text="See [home](javascript:alert(1)) for fun." />);
    // The label should appear as text, but no anchor tag should be created
    // for a non-http(s) URL.
    expect(screen.queryByRole("link", { name: "home" })).toBeNull();
    expect(screen.getByText(/home/)).toBeInTheDocument();
  });

  it("renders `(#N)` issue references as GitHub links", () => {
    render(<BulletText text="A change landed (#487)." />);
    const link = screen.getByRole("link", { name: "#487" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/fraserbrookhouse/poke-memory/issues/487",
    );
  });
});

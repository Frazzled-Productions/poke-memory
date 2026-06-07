/**
 * SectionHeading component tests.
 *
 * Verifies that each supported level emits the correct semantic heading
 * element and applies the matching class-name token from class-names.ts.
 * The `id` and `className` passthrough props are also exercised.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  sectionHeadingLg,
  sectionHeading,
  sectionHeadingSm,
} from "@/lib/utils/class-names";

describe("SectionHeading", () => {
  // -------------------------------------------------------------------------
  // Level 2 → <h2>
  // -------------------------------------------------------------------------

  it("renders an <h2> when level={2}", () => {
    render(<SectionHeading level={2}>Section title</SectionHeading>);
    expect(screen.getByRole("heading", { level: 2, name: "Section title" })).toBeInTheDocument();
  });

  it("applies sectionHeadingLg class for level 2", () => {
    render(<SectionHeading level={2}>Section title</SectionHeading>);
    const el = screen.getByRole("heading", { level: 2 });
    expect(el.className).toContain(sectionHeadingLg.split(" ")[0]);
  });

  // -------------------------------------------------------------------------
  // Level 3 → <h3>
  // -------------------------------------------------------------------------

  it("renders an <h3> when level={3}", () => {
    render(<SectionHeading level={3}>Subsection title</SectionHeading>);
    expect(
      screen.getByRole("heading", { level: 3, name: "Subsection title" }),
    ).toBeInTheDocument();
  });

  it("applies sectionHeading class for level 3", () => {
    render(<SectionHeading level={3}>Subsection title</SectionHeading>);
    const el = screen.getByRole("heading", { level: 3 });
    expect(el.className).toContain(sectionHeading.split(" ")[0]);
  });

  // -------------------------------------------------------------------------
  // Level 4 → <h4>
  // -------------------------------------------------------------------------

  it("renders an <h4> when level={4}", () => {
    render(<SectionHeading level={4}>Deep subsection</SectionHeading>);
    expect(
      screen.getByRole("heading", { level: 4, name: "Deep subsection" }),
    ).toBeInTheDocument();
  });

  it("applies sectionHeadingSm class for level 4", () => {
    render(<SectionHeading level={4}>Deep subsection</SectionHeading>);
    const el = screen.getByRole("heading", { level: 4 });
    expect(el.className).toContain(sectionHeadingSm.split(" ")[0]);
  });

  it("does NOT apply the level-3 class when level={4}", () => {
    render(<SectionHeading level={4}>Deep subsection</SectionHeading>);
    const el = screen.getByRole("heading", { level: 4 });
    // sectionHeading starts with "text-lg"; sectionHeadingSm starts with "text-base"
    expect(el.className).not.toContain("text-lg");
    expect(el.className).toContain("text-base");
  });

  // -------------------------------------------------------------------------
  // Passthrough props: id and className
  // -------------------------------------------------------------------------

  it("forwards the id prop to the heading element", () => {
    render(
      <SectionHeading level={2} id="my-section">
        Titled section
      </SectionHeading>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "my-section");
  });

  it("appends extra className to the base class", () => {
    render(
      <SectionHeading level={3} className="mb-4">
        Spaced heading
      </SectionHeading>,
    );
    const el = screen.getByRole("heading", { level: 3 });
    expect(el.className).toContain("mb-4");
  });

  it("renders children as text content", () => {
    render(<SectionHeading level={4}>Leaf heading text</SectionHeading>);
    expect(screen.getByText("Leaf heading text")).toBeInTheDocument();
  });
});

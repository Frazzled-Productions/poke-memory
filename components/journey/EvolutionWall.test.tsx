/**
 * Component tests for the EvolutionWall widget (issue #854).
 *
 * Lives in the jsdom project so `@testing-library/react` is available.
 *
 * Strategy: construct minimal EvolutionFamily fixtures directly so the tests
 * are fast and deterministic without importing the full seed data.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EvolutionWall } from "./EvolutionWall";
import type { EvolutionFamily, FamilyEdge, FamilyNode } from "@/lib/evolution/chains";

// ---------------------------------------------------------------------------
// Mock next/image so tests don't need an HTTP server for sprites.
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeNode(speciesId: number, name: string): FamilyNode {
  return { speciesId, name, spriteUrl: `/sprites/pokemon/${speciesId}.png` };
}

function makeEdge(
  forwardEdgeId: number,
  fromId: number,
  toId: number,
  opts: Partial<Pick<FamilyEdge, "forwardMastered" | "reverseMastered" | "fullyMastered">> = {},
): FamilyEdge {
  const forwardMastered = opts.forwardMastered ?? false;
  const reverseMastered = opts.reverseMastered ?? false;
  const fullyMastered = opts.fullyMastered ?? (forwardMastered && reverseMastered);
  return { forwardEdgeId, fromId, toId, forwardMastered, reverseMastered, fullyMastered };
}

/**
 * A simple 2-node linear chain: A → B.
 */
function makeLinearFamily(opts: {
  rootId?: number;
  fromId?: number;
  toId?: number;
  edgeMastered?: boolean;
  completed?: boolean;
}): EvolutionFamily {
  const rootId = opts.rootId ?? 1;
  const fromId = opts.fromId ?? 1;
  const toId = opts.toId ?? 2;
  const fully = opts.edgeMastered ?? false;
  const edge = makeEdge(1500001, fromId, toId, {
    forwardMastered: fully,
    reverseMastered: fully,
    fullyMastered: fully,
  });
  return {
    rootId,
    nodes: [makeNode(fromId, "Bulbasaur"), makeNode(toId, "Ivysaur")],
    edges: [edge],
    completed: opts.completed ?? fully,
  };
}

/**
 * A branching family: Eevee → Vaporeon, Jolteon (simplified, 2 branches).
 */
function makeBranchingFamily(completed = false): EvolutionFamily {
  const eeveeId = 133;
  const vaporeonId = 134;
  const jolteonId = 135;
  return {
    rootId: eeveeId,
    nodes: [
      makeNode(eeveeId, "Eevee"),
      makeNode(vaporeonId, "Vaporeon"),
      makeNode(jolteonId, "Jolteon"),
    ],
    edges: [
      makeEdge(1500085, eeveeId, vaporeonId, {
        forwardMastered: completed,
        reverseMastered: completed,
        fullyMastered: completed,
      }),
      makeEdge(1500086, eeveeId, jolteonId, {
        forwardMastered: completed,
        reverseMastered: completed,
        fullyMastered: completed,
      }),
    ],
    completed,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clicks the "Expand" toggle so that the hidden panel becomes visible.
 * The wall starts collapsed by default; any test that needs to interact
 * with filter tabs, the gallery, or the legend must call this first.
 */
function expandWall() {
  fireEvent.click(screen.getByRole("button", { name: /Expand/i }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvolutionWall — basic render", () => {
  it("renders the Evolution wall section heading", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    expect(
      screen.getByRole("heading", { name: "Evolution wall" }),
    ).toBeInTheDocument();
  });

  it("renders the Expand toggle button collapsed by default", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    const btn = screen.getByRole("button", { name: /Expand/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("renders the families completed headline metric (visible while collapsed)", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    expect(screen.getByText(/Families completed:/i)).toBeInTheDocument();
  });

  it("shows 0 / 1 when the only family is not completed", () => {
    render(<EvolutionWall families={[makeLinearFamily({ completed: false })]} />);
    // Should contain "0" for completedFamilies and "1" for totalFamilies.
    expect(screen.getByText(/Families completed:/i)).toBeInTheDocument();
    // Both numbers appear in the DOM.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows 1 / 1 when the only family is completed", () => {
    render(
      <EvolutionWall families={[makeLinearFamily({ edgeMastered: true, completed: true })]} />,
    );
    // completedFamilies = 1, totalFamilies = 1.
    const ones = screen.getAllByText("1");
    expect(ones.length).toBeGreaterThanOrEqual(2);
  });

  it("Expand toggle shows panel and updates aria-expanded", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    const btn = screen.getByRole("button", { name: /Expand/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    // Filter tabs are now accessible.
    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
  });

  it("renders the All / In progress / Completed filter tabs (after expanding)", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    expandWall();
    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "In progress" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Completed" })).toBeInTheDocument();
  });

  it("defaults to the All filter (aria-selected=true on All tab)", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    expandWall();
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "In progress" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("renders the legend with all three states (after expanding)", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    expandWall();
    expect(screen.getByText(/Both mastered/i)).toBeInTheDocument();
    expect(screen.getByText(/One direction mastered/i)).toBeInTheDocument();
    expect(screen.getByText(/Not yet mastered/i)).toBeInTheDocument();
  });
});

describe("EvolutionWall — species nodes", () => {
  it("renders species names for a linear chain (after expanding)", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    expandWall();
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByAltText("Ivysaur")).toBeInTheDocument();
  });

  it("renders species names for a branching family (after expanding)", () => {
    render(<EvolutionWall families={[makeBranchingFamily()]} />);
    expandWall();
    expect(screen.getByAltText("Eevee")).toBeInTheDocument();
    expect(screen.getByAltText("Vaporeon")).toBeInTheDocument();
    expect(screen.getByAltText("Jolteon")).toBeInTheDocument();
  });
});

describe("EvolutionWall — completed family styling", () => {
  it("shows a Done badge on completed families (after expanding)", () => {
    render(
      <EvolutionWall families={[makeLinearFamily({ edgeMastered: true, completed: true })]} />,
    );
    expandWall();
    // The "Done" marker is aria-hidden but its text is in the DOM.
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("does not show a Done badge on incomplete families", () => {
    render(<EvolutionWall families={[makeLinearFamily({ completed: false })]} />);
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });
});

describe("EvolutionWall — filter behaviour", () => {
  const inProgressFamily: EvolutionFamily = {
    rootId: 1,
    nodes: [makeNode(1, "Bulbasaur"), makeNode(2, "Ivysaur")],
    edges: [
      makeEdge(1500001, 1, 2, {
        forwardMastered: true,
        reverseMastered: false,
        fullyMastered: false,
      }),
    ],
    completed: false,
  };
  const untouchedFamily: EvolutionFamily = {
    rootId: 4,
    nodes: [makeNode(4, "Charmander"), makeNode(5, "Charmeleon")],
    edges: [makeEdge(1500003, 4, 5)],
    completed: false,
  };
  const completedFamily: EvolutionFamily = {
    rootId: 7,
    nodes: [makeNode(7, "Squirtle"), makeNode(8, "Wartortle")],
    edges: [
      makeEdge(1500005, 7, 8, {
        forwardMastered: true,
        reverseMastered: true,
        fullyMastered: true,
      }),
    ],
    completed: true,
  };
  const allFamilies = [inProgressFamily, untouchedFamily, completedFamily];

  it("shows all families under the All filter (after expanding)", () => {
    render(<EvolutionWall families={allFamilies} />);
    expandWall();
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByAltText("Charmander")).toBeInTheDocument();
    expect(screen.getByAltText("Squirtle")).toBeInTheDocument();
  });

  it("switches to In progress filter and hides completed + untouched families", () => {
    render(<EvolutionWall families={allFamilies} />);
    expandWall();
    fireEvent.click(screen.getByRole("tab", { name: "In progress" }));
    expect(screen.queryByAltText("Charmander")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Squirtle")).not.toBeInTheDocument();
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
  });

  it("switches to Completed filter and shows only completed families", () => {
    render(<EvolutionWall families={allFamilies} />);
    expandWall();
    fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
    expect(screen.queryByAltText("Bulbasaur")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Charmander")).not.toBeInTheDocument();
    expect(screen.getByAltText("Squirtle")).toBeInTheDocument();
  });

  it("shows empty-state message for In progress when nothing is in progress", () => {
    render(<EvolutionWall families={[untouchedFamily, completedFamily]} />);
    expandWall();
    fireEvent.click(screen.getByRole("tab", { name: "In progress" }));
    expect(
      screen.getByText(/No families in progress yet/i),
    ).toBeInTheDocument();
  });

  it("shows empty-state message for Completed when nothing is completed", () => {
    render(<EvolutionWall families={[untouchedFamily, inProgressFamily]} />);
    expandWall();
    fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
    expect(
      screen.getByText(/No families completed yet/i),
    ).toBeInTheDocument();
  });

  it("marks the active filter tab as aria-selected=true", () => {
    render(<EvolutionWall families={allFamilies} />);
    expandWall();
    fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
    expect(screen.getByRole("tab", { name: "Completed" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("returns to All filter after switching", () => {
    render(<EvolutionWall families={allFamilies} />);
    expandWall();
    fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByAltText("Charmander")).toBeInTheDocument();
    expect(screen.getByAltText("Squirtle")).toBeInTheDocument();
  });
});

describe("EvolutionWall — edge accessibility labels", () => {
  it("labels a fully-mastered edge with 'both directions mastered' (after expanding)", () => {
    const family: EvolutionFamily = {
      rootId: 1,
      nodes: [makeNode(1, "Bulbasaur"), makeNode(2, "Ivysaur")],
      edges: [makeEdge(1500001, 1, 2, { forwardMastered: true, reverseMastered: true, fullyMastered: true })],
      completed: true,
    };
    render(<EvolutionWall families={[family]} />);
    expandWall();
    expect(
      screen.getByRole("img", { name: /both directions mastered/i }),
    ).toBeInTheDocument();
  });

  it("labels a forward-only mastered edge correctly (after expanding)", () => {
    const family: EvolutionFamily = {
      rootId: 1,
      nodes: [makeNode(1, "Bulbasaur"), makeNode(2, "Ivysaur")],
      edges: [makeEdge(1500001, 1, 2, { forwardMastered: true, reverseMastered: false, fullyMastered: false })],
      completed: false,
    };
    render(<EvolutionWall families={[family]} />);
    expandWall();
    expect(
      screen.getByRole("img", { name: /forward mastered, reverse not yet/i }),
    ).toBeInTheDocument();
  });

  it("labels a reverse-only mastered edge correctly (after expanding)", () => {
    const family: EvolutionFamily = {
      rootId: 1,
      nodes: [makeNode(1, "Bulbasaur"), makeNode(2, "Ivysaur")],
      edges: [makeEdge(1500001, 1, 2, { forwardMastered: false, reverseMastered: true, fullyMastered: false })],
      completed: false,
    };
    render(<EvolutionWall families={[family]} />);
    expandWall();
    expect(
      screen.getByRole("img", { name: /reverse mastered, forward not yet/i }),
    ).toBeInTheDocument();
  });

  it("labels an unmastered edge as 'not yet mastered' (after expanding)", () => {
    render(<EvolutionWall families={[makeLinearFamily({})]} />);
    expandWall();
    expect(
      screen.getByRole("img", { name: /not yet mastered/i }),
    ).toBeInTheDocument();
  });
});

describe("EvolutionWall — empty families list", () => {
  it("renders the section heading even with no families", () => {
    render(<EvolutionWall families={[]} />);
    expect(
      screen.getByRole("heading", { name: "Evolution wall" }),
    ).toBeInTheDocument();
  });

  it("shows 0 / 0 for the metric", () => {
    render(<EvolutionWall families={[]} />);
    // Both completedFamilies (0) and totalFamilies (0) — two zeros in the metric area.
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(2);
  });
});

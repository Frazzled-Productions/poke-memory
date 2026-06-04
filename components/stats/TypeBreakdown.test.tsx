/**
 * Tests for TypeBreakdown.
 *
 * Coverage targets:
 * - Empty perType array (renders heading, no list items)
 * - Populated state: type names routed through getTypeName() for all locales
 * - getTypeName() locale dispatch: representative spread of 18 types across en/ja/zh-Hans/zh-Hant
 * - pct() arithmetic: 0% when total=0, rounding, 100%
 * - MeterBar integration: role=meter, aria-valuenow, aria-valuemax
 * - Locale matrix: en, ja, zh-Hans, zh-Hant
 * - Numeric assertions are separator-tolerant (#1408)
 */

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { TypeBreakdown } from "@/components/stats/TypeBreakdown";
import type { TypeStats } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTypeStats(overrides: Partial<TypeStats>[] = []): TypeStats[] {
  const defaults: TypeStats[] = [
    { type: "fire",  total: 10, introduced: 8, mastered: 6 },
    { type: "water", total: 20, introduced: 15, mastered: 10 },
    { type: "grass", total: 15, introduced: 12, mastered: 5 },
  ];
  return defaults.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
}

/** Build a single-entry perType array for focused assertions. */
function singleType(type: string, total: number, mastered: number): TypeStats[] {
  return [{ type, total, introduced: mastered, mastered }];
}

// ---------------------------------------------------------------------------
// Tests - empty state
// ---------------------------------------------------------------------------

describe("TypeBreakdown - empty state", () => {
  it("renders the section heading when perType is empty", () => {
    renderWithIntl(<TypeBreakdown perType={[]} />);
    expect(
      screen.getByRole("heading", { name: /by type/i }),
    ).toBeInTheDocument();
  });

  it("renders no list items when perType is empty", () => {
    renderWithIntl(<TypeBreakdown perType={[]} />);
    const list = screen.getByRole("list");
    expect(list.children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests - populated state
// ---------------------------------------------------------------------------

describe("TypeBreakdown - populated state", () => {
  it("renders a list item for each TypeStats entry", () => {
    renderWithIntl(<TypeBreakdown perType={makeTypeStats()} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
  });

  it("renders a MeterBar (role=meter) for each type", () => {
    renderWithIntl(<TypeBreakdown perType={makeTypeStats()} />);
    const meters = screen.getAllByRole("meter");
    expect(meters).toHaveLength(3);
  });

  it("sets correct aria-valuenow on the meter", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("fire", 10, 6)} />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("6");
  });

  it("sets correct aria-valuemax on the meter", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("fire", 10, 6)} />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuemax")).toBe("10");
  });
});

// ---------------------------------------------------------------------------
// Tests - pct() arithmetic
// ---------------------------------------------------------------------------

describe("TypeBreakdown - pct() arithmetic in meter aria-label", () => {
  it("shows 0% when total is 0 (guard against division by zero)", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("fire", 0, 0)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/0%/);
  });

  it("shows 100% when mastered equals total", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("water", 10, 10)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/100%/);
  });

  it("rounds the percentage (60/100 = 60%)", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("grass", 100, 60)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/60%/);
  });

  it("rounds fractional percentages (1/3 = 33%)", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("ghost", 3, 1)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/33%/);
  });

  it("rounds fractional percentages (2/3 = 67%)", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("dragon", 3, 2)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/67%/);
  });

  it("shows 50% when half mastered", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("ice", 20, 10)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/50%/);
  });
});

// ---------------------------------------------------------------------------
// Tests - getTypeName() locale dispatch (English)
// ---------------------------------------------------------------------------

describe("TypeBreakdown - type name locale dispatch (English)", () => {
  it("renders English type names as type-badge labels", () => {
    const perType: TypeStats[] = [
      { type: "fire",     total: 5, introduced: 5, mastered: 3 },
      { type: "water",    total: 5, introduced: 5, mastered: 3 },
      { type: "grass",    total: 5, introduced: 5, mastered: 3 },
      { type: "electric", total: 5, introduced: 5, mastered: 3 },
      { type: "ghost",    total: 5, introduced: 5, mastered: 3 },
      { type: "dragon",   total: 5, introduced: 5, mastered: 3 },
    ];
    renderWithIntl(<TypeBreakdown perType={perType} />);
    expect(screen.getByText("Fire")).toBeInTheDocument();
    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getByText("Grass")).toBeInTheDocument();
    expect(screen.getByText("Electric")).toBeInTheDocument();
    expect(screen.getByText("Ghost")).toBeInTheDocument();
    expect(screen.getByText("Dragon")).toBeInTheDocument();
  });

  it("renders all 18 English type names without error", () => {
    const allTypes: TypeStats[] = [
      "bug", "dark", "dragon", "electric", "fairy", "fighting",
      "fire", "flying", "ghost", "grass", "ground", "ice",
      "normal", "poison", "psychic", "rock", "steel", "water",
    ].map((type) => ({ type, total: 10, introduced: 5, mastered: 3 }));
    renderWithIntl(<TypeBreakdown perType={allTypes} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(18);
  });
});

// ---------------------------------------------------------------------------
// Tests - getTypeName() locale dispatch (Japanese)
// ---------------------------------------------------------------------------

describe("TypeBreakdown - type name locale dispatch (Japanese)", () => {
  it("renders Japanese type names via getTypeName", () => {
    const perType: TypeStats[] = [
      { type: "fire",     total: 5, introduced: 5, mastered: 3 },
      { type: "water",    total: 5, introduced: 5, mastered: 3 },
      { type: "ghost",    total: 5, introduced: 5, mastered: 3 },
      { type: "dragon",   total: 5, introduced: 5, mastered: 3 },
      { type: "electric", total: 5, introduced: 5, mastered: 3 },
      { type: "ice",      total: 5, introduced: 5, mastered: 3 },
    ];
    renderJa(<TypeBreakdown perType={perType} />);
    expect(screen.getByText("ほのお")).toBeInTheDocument();   // fire
    expect(screen.getByText("みず")).toBeInTheDocument();     // water
    expect(screen.getByText("ゴースト")).toBeInTheDocument(); // ghost
    expect(screen.getByText("ドラゴン")).toBeInTheDocument(); // dragon
    expect(screen.getByText("でんき")).toBeInTheDocument();   // electric
    expect(screen.getByText("こおり")).toBeInTheDocument();   // ice
  });

  it("renders the Japanese section heading", () => {
    renderJa(<TypeBreakdown perType={[]} />);
    expect(screen.getByRole("heading", { name: "タイプ別" })).toBeInTheDocument();
  });

  it("meter aria-label contains Japanese type name", () => {
    renderJa(<TypeBreakdown perType={singleType("fire", 10, 5)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toContain("ほのお"); // Japanese for "fire"
    expect(label).toMatch(/50%/);
  });
});

// ---------------------------------------------------------------------------
// Tests - getTypeName() locale dispatch (Simplified Chinese)
// ---------------------------------------------------------------------------

describe("TypeBreakdown - type name locale dispatch (Simplified Chinese)", () => {
  it("renders Simplified Chinese type names via getTypeName", () => {
    const perType: TypeStats[] = [
      { type: "fire",     total: 5, introduced: 5, mastered: 3 },
      { type: "water",    total: 5, introduced: 5, mastered: 3 },
      { type: "psychic",  total: 5, introduced: 5, mastered: 3 },
      { type: "steel",    total: 5, introduced: 5, mastered: 3 },
      { type: "poison",   total: 5, introduced: 5, mastered: 3 },
      { type: "fairy",    total: 5, introduced: 5, mastered: 3 },
    ];
    renderZhHans(<TypeBreakdown perType={perType} />);
    expect(screen.getByText("火")).toBeInTheDocument();     // fire
    expect(screen.getByText("水")).toBeInTheDocument();     // water
    expect(screen.getByText("超能力")).toBeInTheDocument(); // psychic
    expect(screen.getByText("钢")).toBeInTheDocument();     // steel
    expect(screen.getByText("毒")).toBeInTheDocument();     // poison
    expect(screen.getByText("妖精")).toBeInTheDocument();   // fairy
  });

  it("renders the Simplified Chinese section heading", () => {
    renderZhHans(<TypeBreakdown perType={[]} />);
    expect(screen.getByRole("heading", { name: "按属性" })).toBeInTheDocument();
  });

  it("meter aria-label contains Simplified Chinese type name", () => {
    renderZhHans(<TypeBreakdown perType={singleType("water", 10, 5)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toContain("水"); // Simplified Chinese for "water"
    expect(label).toMatch(/50%/);
  });
});

// ---------------------------------------------------------------------------
// Tests - getTypeName() locale dispatch (Traditional Chinese)
// ---------------------------------------------------------------------------

describe("TypeBreakdown - type name locale dispatch (Traditional Chinese)", () => {
  it("renders Traditional Chinese type names via getTypeName", () => {
    const perType: TypeStats[] = [
      { type: "fire",     total: 5, introduced: 5, mastered: 3 },
      { type: "water",    total: 5, introduced: 5, mastered: 3 },
      { type: "ghost",    total: 5, introduced: 5, mastered: 3 },
      { type: "steel",    total: 5, introduced: 5, mastered: 3 },
      { type: "fighting", total: 5, introduced: 5, mastered: 3 },
      { type: "rock",     total: 5, introduced: 5, mastered: 3 },
    ];
    renderZhHant(<TypeBreakdown perType={perType} />);
    expect(screen.getByText("火")).toBeInTheDocument();   // fire
    expect(screen.getByText("水")).toBeInTheDocument();   // water
    expect(screen.getByText("幽靈")).toBeInTheDocument(); // ghost
    expect(screen.getByText("鋼")).toBeInTheDocument();   // steel
    expect(screen.getByText("格鬥")).toBeInTheDocument(); // fighting
    expect(screen.getByText("岩石")).toBeInTheDocument(); // rock
  });

  it("renders the Traditional Chinese section heading", () => {
    renderZhHant(<TypeBreakdown perType={[]} />);
    expect(screen.getByRole("heading", { name: "按屬性" })).toBeInTheDocument();
  });

  it("meter aria-label contains Traditional Chinese type name", () => {
    renderZhHant(<TypeBreakdown perType={singleType("ghost", 10, 4)} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toContain("幽靈"); // Traditional Chinese for "ghost"
    expect(label).toMatch(/40%/);
  });
});

// ---------------------------------------------------------------------------
// Tests - mastered/total fraction display
// ---------------------------------------------------------------------------

describe("TypeBreakdown - mastered/total fraction display", () => {
  it("shows mastered/total as text in each list item", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("fire", 10, 6)} />);
    // The component renders "{mastered}/{total}" as text
    expect(screen.getByText("6/10")).toBeInTheDocument();
  });

  it("shows 0/0 when both are zero", () => {
    renderWithIntl(<TypeBreakdown perType={singleType("ice", 0, 0)} />);
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });
});

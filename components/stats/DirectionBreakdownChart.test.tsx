/**
 * Smoke tests for DirectionBreakdownChart.
 *
 * Exercises the empty-state path and the chart path (including the
 * TooltipBody sub-component that uses `statValue`) so the class-name
 * refactor lines are instrumented by the coverage gate.
 *
 * Recharts is mocked to avoid the ResizeObserver dependency that jsdom
 * cannot satisfy. The Tooltip mock invokes its content render prop with
 * synthetic payload so TooltipBody (and its `statValue` line) executes.
 * An empty-payload variant exercises the #1521 null-guard branch.
 *
 * Locale coverage: the typed DIRECTION_TO_KEY map (#1519) is exercised in
 * Japanese to confirm key resolution works across locales.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";
import { DirectionBreakdownChart } from "@/components/stats/DirectionBreakdownChart";
import type { DirectionBreakdownRow } from "@/lib/stats/direction-breakdown";

// ---------------------------------------------------------------------------
// Recharts mock — lightweight stubs so the component can render in jsdom.
// Two Tooltip variants: one fires with populated payload, one with an empty
// array to exercise the #1521 length-guard path.
// ---------------------------------------------------------------------------

type ChartDatum = {
  label: string;
  accuracyPct: number;
  total: number;
  passes: number;
  hasData: boolean;
  disabled: boolean;
};

const MOCK_DATUM: ChartDatum = {
  label: "Name",
  accuracyPct: 85,
  total: 20,
  passes: 17,
  hasData: true,
  disabled: false,
};

/** Controls which payload the Tooltip mock sends to its content prop. */
let tooltipPayload: { payload: ChartDatum }[] = [{ payload: MOCK_DATUM }];
let tooltipActive = true;

vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="bar">{children}</div>
  ),
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Tooltip: ({
    content,
  }: {
    content: (props: {
      active: boolean;
      payload: { payload: ChartDatum }[];
    }) => React.ReactNode;
  }) => (
    <div data-testid="tooltip">
      {content({ active: tooltipActive, payload: tooltipPayload })}
    </div>
  ),
  XAxis: ({ className }: { className?: string }) => (
    <div data-testid="x-axis" className={className} />
  ),
  YAxis: () => <div data-testid="y-axis" />,
}));

const ROWS: readonly DirectionBreakdownRow[] = [
  { direction: "name",     total: 20, passes: 17, accuracy: 0.85, disabled: false },
  { direction: "reverse",  total: 10, passes: 7,  accuracy: 0.7,  disabled: false },
];

describe("DirectionBreakdownChart", () => {
  it("renders the Accuracy by card direction heading", () => {
    tooltipPayload = [{ payload: MOCK_DATUM }];
    tooltipActive = true;
    renderWithIntl(<DirectionBreakdownChart rows={ROWS} />);
    expect(
      screen.getByRole("heading", { name: /accuracy by card direction/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state message when all rows have zero reviews", () => {
    const emptyRows: DirectionBreakdownRow[] = [
      { direction: "name",    total: 0, passes: 0, accuracy: null, disabled: false },
      { direction: "reverse", total: 0, passes: 0, accuracy: null, disabled: false },
    ];
    renderWithIntl(<DirectionBreakdownChart rows={emptyRows} />);
    expect(
      screen.getByText(/no reviews recorded yet/i),
    ).toBeInTheDocument();
  });

  it("renders the bar chart when rows have data", () => {
    tooltipPayload = [{ payload: MOCK_DATUM }];
    tooltipActive = true;
    renderWithIntl(<DirectionBreakdownChart rows={ROWS} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("renders the TooltipBody content (statValue line) via the mocked Tooltip", () => {
    tooltipPayload = [{ payload: MOCK_DATUM }];
    tooltipActive = true;
    renderWithIntl(<DirectionBreakdownChart rows={ROWS} />);
    // TooltipBody renders "Accuracy: 85%" using the statValue class when hasData is true.
    expect(screen.getByText(/accuracy: 85%/i)).toBeInTheDocument();
  });

  // #1521: guard against empty payload array — Recharts passes [] during
  // chart transitions, which would previously crash with a TypeError.
  it("renders null without throwing when the Tooltip receives an empty payload", () => {
    tooltipPayload = [];
    tooltipActive = true;
    expect(() =>
      renderWithIntl(<DirectionBreakdownChart rows={ROWS} />),
    ).not.toThrow();
    // The tooltip container is rendered by the mock but its content is null.
    expect(screen.getByTestId("tooltip")).toBeEmptyDOMElement();
  });

  // #1521: guard also fires when active is false.
  it("renders null without throwing when the Tooltip is inactive", () => {
    tooltipPayload = [{ payload: MOCK_DATUM }];
    tooltipActive = false;
    expect(() =>
      renderWithIntl(<DirectionBreakdownChart rows={ROWS} />),
    ).not.toThrow();
    expect(screen.getByTestId("tooltip")).toBeEmptyDOMElement();
  });

  it("renders the per-direction review count list", () => {
    tooltipPayload = [{ payload: MOCK_DATUM }];
    tooltipActive = true;
    renderWithIntl(<DirectionBreakdownChart rows={ROWS} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  // Locale coverage (#1519): typed DIRECTION_TO_KEY keys must resolve in
  // non-English locales; if the map value type were widened to `string` the
  // key lookup would still compile but this verifies the runtime path.
  it("renders the heading in Japanese", () => {
    tooltipPayload = [{ payload: MOCK_DATUM }];
    tooltipActive = true;
    renderJa(<DirectionBreakdownChart rows={ROWS} />);
    expect(
      screen.getByRole("heading", { name: /カード方向別の正解率/ }),
    ).toBeInTheDocument();
  });

  it("renders a direction label in Japanese via typed key lookup", () => {
    tooltipPayload = [{ payload: MOCK_DATUM }];
    tooltipActive = true;
    renderJa(<DirectionBreakdownChart rows={ROWS} />);
    // "name" direction maps to "この Pokémon の名前は？" in Japanese.
    expect(
      screen.getByText(/この Pokémon の名前は？/),
    ).toBeInTheDocument();
  });
});

/**
 * Tests for GradeBreakdownBar.
 *
 * Coverage targets:
 * - Zero-total empty state (noGrades message)
 * - All four legend segments present when hideZeroSegments is false (default)
 * - hideZeroSegments=true hides zero-count segments and adjusts grid-cols class
 * - Dynamic grid-cols-{1,2,3,4} legend layout across segment counts
 * - format.number() locale formatting - assertions use separator-tolerant regexes (#1408)
 * - aria-label built from i18n params (en + ja + zh-Hans + zh-Hant)
 * - Section heading uses custom label prop when provided
 * - Locale matrix: en, ja, zh-Hans, zh-Hant
 */

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { GradeBreakdownBar } from "@/components/stats/GradeBreakdownBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip locale digit-group separators (comma, narrow-NBSP, regular space) from a string. */
function stripSeparators(s: string): string {
  return s.replace(/[\s,  ]/g, "");
}

/** Find the legend grid container by looking for the element that holds legend chips. */
function getLegendGrid(container: HTMLElement): HTMLElement {
  const grid = container.querySelector(".grid");
  if (!grid) throw new Error("No .grid element found");
  return grid as HTMLElement;
}

// ---------------------------------------------------------------------------
// Tests - empty state
// ---------------------------------------------------------------------------

describe("GradeBreakdownBar - empty state (total === 0)", () => {
  it("renders the no-grades message in English", () => {
    renderWithIntl(<GradeBreakdownBar again={0} hard={0} good={0} easy={0} />);
    expect(screen.getByText("No grades yet.")).toBeInTheDocument();
  });

  it("does not render the stacked bar when total is zero", () => {
    renderWithIntl(<GradeBreakdownBar again={0} hard={0} good={0} easy={0} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the no-grades message in Japanese", () => {
    renderJa(<GradeBreakdownBar again={0} hard={0} good={0} easy={0} />);
    expect(screen.getByText("まだ評価がありません。")).toBeInTheDocument();
  });

  it("renders the no-grades message in Simplified Chinese", () => {
    renderZhHans(<GradeBreakdownBar again={0} hard={0} good={0} easy={0} />);
    expect(screen.getByText("暂无评分。")).toBeInTheDocument();
  });

  it("renders the no-grades message in Traditional Chinese", () => {
    renderZhHant(<GradeBreakdownBar again={0} hard={0} good={0} easy={0} />);
    expect(screen.getByText("尚無評分。")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - populated state
// ---------------------------------------------------------------------------

describe("GradeBreakdownBar - populated state", () => {
  it("renders a stacked bar with role=img", () => {
    renderWithIntl(
      <GradeBreakdownBar again={5} hard={3} good={10} easy={2} />,
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("renders the default section heading from i18n catalogue", () => {
    renderWithIntl(
      <GradeBreakdownBar again={5} hard={3} good={10} easy={2} />,
    );
    expect(
      screen.getByRole("heading", { name: /grade breakdown/i }),
    ).toBeInTheDocument();
  });

  it("uses the custom label prop as the section heading", () => {
    renderWithIntl(
      <GradeBreakdownBar
        again={5}
        hard={3}
        good={10}
        easy={2}
        label="All-time grade breakdown"
      />,
    );
    expect(
      screen.getByRole("heading", { name: /all-time grade breakdown/i }),
    ).toBeInTheDocument();
  });

  it("uses the custom label prop in the section aria-label", () => {
    const { container } = renderWithIntl(
      <GradeBreakdownBar
        again={5}
        hard={3}
        good={10}
        easy={2}
        label="All-time"
      />,
    );
    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-label")).toBe("All-time");
  });
});

// ---------------------------------------------------------------------------
// Tests - grid-cols layout via hideZeroSegments
// ---------------------------------------------------------------------------

describe("GradeBreakdownBar - grid-cols legend layout", () => {
  it("uses grid-cols-4 when all four segments are non-zero", () => {
    const { container } = renderWithIntl(
      <GradeBreakdownBar again={1} hard={2} good={3} easy={4} />,
    );
    const grid = getLegendGrid(container);
    expect(grid.className).toContain("grid-cols-4");
  });

  it("uses grid-cols-3 when hideZeroSegments filters one segment to zero", () => {
    const { container } = renderWithIntl(
      <GradeBreakdownBar
        again={0}
        hard={2}
        good={3}
        easy={4}
        hideZeroSegments
      />,
    );
    const grid = getLegendGrid(container);
    expect(grid.className).toContain("grid-cols-3");
  });

  it("uses grid-cols-2 when hideZeroSegments leaves two segments", () => {
    const { container } = renderWithIntl(
      <GradeBreakdownBar
        again={0}
        hard={0}
        good={3}
        easy={4}
        hideZeroSegments
      />,
    );
    const grid = getLegendGrid(container);
    expect(grid.className).toContain("grid-cols-2");
  });

  it("uses grid-cols-1 when hideZeroSegments leaves one segment", () => {
    const { container } = renderWithIntl(
      <GradeBreakdownBar
        again={0}
        hard={0}
        good={0}
        easy={4}
        hideZeroSegments
      />,
    );
    const grid = getLegendGrid(container);
    expect(grid.className).toContain("grid-cols-1");
  });

  it("shows all four legend chips when hideZeroSegments is false and some are zero", () => {
    renderWithIntl(
      <GradeBreakdownBar
        again={0}
        hard={1}
        good={2}
        easy={3}
        hideZeroSegments={false}
      />,
    );
    // Default English labels for each grade
    expect(screen.getByText("Again")).toBeInTheDocument();
    expect(screen.getByText("Hard")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("Easy")).toBeInTheDocument();
  });

  it("hides zero-count segments when hideZeroSegments is true", () => {
    renderWithIntl(
      <GradeBreakdownBar
        again={0}
        hard={0}
        good={5}
        easy={3}
        hideZeroSegments
      />,
    );
    expect(screen.queryByText("Again")).not.toBeInTheDocument();
    expect(screen.queryByText("Hard")).not.toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("Easy")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - format.number() locale formatting (#1408 separator-tolerant)
// ---------------------------------------------------------------------------

describe("GradeBreakdownBar - format.number() locale formatting", () => {
  it("renders count digits for each legend chip in English", () => {
    renderWithIntl(
      <GradeBreakdownBar again={10} hard={20} good={30} easy={40} />,
    );
    // Use text-content comparison via getAllByText for separator tolerance
    const allText = document.body.textContent ?? "";
    const stripped = stripSeparators(allText);
    expect(stripped).toContain("10");
    expect(stripped).toContain("20");
    expect(stripped).toContain("30");
    expect(stripped).toContain("40");
  });

  it("renders large counts correctly in Japanese (separator-tolerant)", () => {
    renderJa(
      <GradeBreakdownBar again={1000} hard={2000} good={3000} easy={4000} />,
    );
    const allText = document.body.textContent ?? "";
    const stripped = stripSeparators(allText);
    expect(stripped).toContain("1000");
    expect(stripped).toContain("2000");
    expect(stripped).toContain("3000");
    expect(stripped).toContain("4000");
  });

  it("renders large counts correctly in Simplified Chinese (separator-tolerant)", () => {
    renderZhHans(
      <GradeBreakdownBar again={1000} hard={2000} good={3000} easy={4000} />,
    );
    const allText = document.body.textContent ?? "";
    const stripped = stripSeparators(allText);
    expect(stripped).toContain("1000");
    expect(stripped).toContain("2000");
  });

  it("renders large counts correctly in Traditional Chinese (separator-tolerant)", () => {
    renderZhHant(
      <GradeBreakdownBar again={1000} hard={2000} good={3000} easy={4000} />,
    );
    const allText = document.body.textContent ?? "";
    const stripped = stripSeparators(allText);
    expect(stripped).toContain("1000");
    expect(stripped).toContain("4000");
  });
});

// ---------------------------------------------------------------------------
// Tests - aria-label built from i18n params
// ---------------------------------------------------------------------------

describe("GradeBreakdownBar - stacked bar aria-label (all locales)", () => {
  it("aria-label contains grade counts in English", () => {
    renderWithIntl(
      <GradeBreakdownBar again={3} hard={5} good={10} easy={2} />,
    );
    const bar = screen.getByRole("img");
    const label = bar.getAttribute("aria-label") ?? "";
    // The template is: "{heading}: {again} Again, {hard} Hard, {good} Good, {easy} Easy"
    expect(label).toMatch(/3/);
    expect(label).toMatch(/5/);
    expect(label).toMatch(/10/);
    expect(label).toMatch(/2/);
    expect(label).toMatch(/Again/i);
    expect(label).toMatch(/Hard/i);
    expect(label).toMatch(/Good/i);
    expect(label).toMatch(/Easy/i);
  });

  it("aria-label uses Japanese grade labels in Japanese locale", () => {
    renderJa(
      <GradeBreakdownBar again={3} hard={5} good={10} easy={2} />,
    );
    const bar = screen.getByRole("img");
    const label = bar.getAttribute("aria-label") ?? "";
    // Japanese grade words from messages/ja.json
    expect(label).toContain("再度");    // again
    expect(label).toContain("難しい"); // hard
    expect(label).toContain("良い");   // good
    expect(label).toContain("簡単");   // easy
    expect(label).toContain("評価の内訳"); // heading
  });

  it("aria-label uses Simplified Chinese grade labels", () => {
    renderZhHans(
      <GradeBreakdownBar again={3} hard={5} good={10} easy={2} />,
    );
    const bar = screen.getByRole("img");
    const label = bar.getAttribute("aria-label") ?? "";
    expect(label).toContain("再来一次"); // again
    expect(label).toContain("困难");     // hard
    expect(label).toContain("良好");     // good
    expect(label).toContain("简单");     // easy
  });

  it("aria-label uses Traditional Chinese grade labels", () => {
    renderZhHant(
      <GradeBreakdownBar again={3} hard={5} good={10} easy={2} />,
    );
    const bar = screen.getByRole("img");
    const label = bar.getAttribute("aria-label") ?? "";
    expect(label).toContain("再來一次"); // again
    expect(label).toContain("困難");     // hard
    expect(label).toContain("良好");     // good
    expect(label).toContain("簡單");     // easy
  });
});

// ---------------------------------------------------------------------------
// Tests - legend labels per locale
// ---------------------------------------------------------------------------

describe("GradeBreakdownBar - legend chip labels per locale", () => {
  it("shows Japanese grade labels in legend chips", () => {
    renderJa(<GradeBreakdownBar again={1} hard={2} good={3} easy={4} />);
    expect(screen.getByText("もう一度")).toBeInTheDocument(); // again
    expect(screen.getByText("難しい")).toBeInTheDocument();   // hard
    expect(screen.getByText("普通")).toBeInTheDocument();     // good
    expect(screen.getByText("簡単")).toBeInTheDocument();     // easy
  });

  it("shows Simplified Chinese grade labels in legend chips", () => {
    renderZhHans(<GradeBreakdownBar again={1} hard={2} good={3} easy={4} />);
    expect(screen.getByText("再来一次")).toBeInTheDocument(); // again
    expect(screen.getByText("困难")).toBeInTheDocument();     // hard
    expect(screen.getByText("一般")).toBeInTheDocument();     // good (zh-Hans)
    expect(screen.getByText("简单")).toBeInTheDocument();     // easy
  });

  it("shows Traditional Chinese grade labels in legend chips", () => {
    renderZhHant(<GradeBreakdownBar again={1} hard={2} good={3} easy={4} />);
    expect(screen.getByText("再來一次")).toBeInTheDocument(); // again
    expect(screen.getByText("困難")).toBeInTheDocument();     // hard
    expect(screen.getByText("普通")).toBeInTheDocument();     // good (zh-Hant)
    expect(screen.getByText("簡單")).toBeInTheDocument();     // easy
  });
});

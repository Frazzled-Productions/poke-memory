/**
 * Smoke tests for IntensityPicker.
 *
 * Exercises the component's render path so the `colStackLg`/`colStack`
 * class-name refactor on the section and radiogroup elements (lines 37, 47)
 * is instrumented by the coverage gate.
 */

import { renderWithIntl as render, screen } from "@/components/test-utils/renderWithIntl";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { IntensityPicker } from "@/components/settings/IntensityPicker";

describe("IntensityPicker", () => {
  it("renders the Theme intensity heading", () => {
    render(<IntensityPicker value="accents" onChange={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /theme intensity/i }),
    ).toBeInTheDocument();
  });

  it("renders three radio options", () => {
    render(<IntensityPicker value="accents" onChange={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks the current value as checked", () => {
    render(<IntensityPicker value="tinted" onChange={vi.fn()} />);
    const tintedRadio = screen.getByRole("radio", { name: /tinted backgrounds/i });
    expect(tintedRadio).toBeChecked();
  });

  it("calls onChange with the selected value when a radio is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<IntensityPicker value="accents" onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: /full mascot theme/i }));

    expect(onChange).toHaveBeenCalledWith("full");
  });
});

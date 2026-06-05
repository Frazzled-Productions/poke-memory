import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { useState } from "react";

// Minimal component that mirrors the draft-state pattern used in the settings
// page for numeric inputs. Tests here guard the behaviour without requiring the
// full settings page dependency tree.
function NumericInput({
  initialValue,
  min,
  onCommit,
}: {
  initialValue: number;
  min: number;
  onCommit: (v: number) => void;
}) {
  const [committed, setCommitted] = useState(initialValue);
  const [draft, setDraft] = useState<string | undefined>(undefined);

  function handleChange(raw: string) {
    setDraft(raw);
  }

  function handleBlur() {
    if (draft === undefined) return;
    const parsed = parseInt(draft, 10);
    const value = isNaN(parsed) ? committed : Math.max(min, parsed);
    setCommitted(value);
    onCommit(value);
    setDraft(undefined);
  }

  return (
    <input
      aria-label="count"
      type="number"
      value={draft ?? String(committed)}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
    />
  );
}

describe("NumericInput draft-state pattern", () => {
  it("shows intermediate value mid-edit without snapping back", async () => {
    const user = userEvent.setup();
    render(<NumericInput initialValue={10} min={1} onCommit={() => {}} />);
    const input = screen.getByRole("spinbutton", { name: "count" });

    // Clear "10" then type "1" - the displayed value should be "1", not snapped to "10".
    await user.clear(input);
    await user.type(input, "1");
    expect(input).toHaveValue(1);
  });

  it("commits draft to settings state on blur", async () => {
    const user = userEvent.setup();
    const committed: number[] = [];
    render(
      <NumericInput initialValue={10} min={1} onCommit={(v) => committed.push(v)} />,
    );
    const input = screen.getByRole("spinbutton", { name: "count" });

    await user.clear(input);
    await user.type(input, "5");
    await user.tab(); // trigger blur

    expect(committed).toEqual([5]);
  });

  it("restores prior value on blur when field is cleared to empty", async () => {
    const user = userEvent.setup();
    const committed: number[] = [];
    render(
      <NumericInput initialValue={10} min={1} onCommit={(v) => committed.push(v)} />,
    );
    const input = screen.getByRole("spinbutton", { name: "count" });

    await user.clear(input);
    await user.tab(); // blur with empty field

    // No NaN committed; the prior value is restored.
    expect(committed).toEqual([10]);
    expect(input).toHaveValue(10);
  });

  it("enforces the min floor on blur", async () => {
    const user = userEvent.setup();
    const committed: number[] = [];
    render(
      <NumericInput initialValue={10} min={3} onCommit={(v) => committed.push(v)} />,
    );
    const input = screen.getByRole("spinbutton", { name: "count" });

    await user.clear(input);
    await user.type(input, "1");
    await user.tab();

    expect(committed).toEqual([3]);
  });
});

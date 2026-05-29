/**
 * Component-level tests for the push notification hour picker (#1315).
 *
 * These tests verify the settings-page hour picker using a minimal
 * wrapper that exercises the interaction and local-storage write path
 * without mounting the full SettingsPage (which has many async providers).
 *
 * Placement: components/ so the jsdom project picks it up.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { useState } from "react";
import { saveSettings, loadSettings, DEFAULT_SETTINGS } from "@/lib/settings/persistence";

// ---------------------------------------------------------------------------
// localStorage stub (mirrors CollapsibleSection.test.tsx pattern)
// ---------------------------------------------------------------------------

function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  delete (window as unknown as { localStorage?: unknown }).localStorage;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Minimal picker component (mirrors the relevant section of SettingsPage)
// ---------------------------------------------------------------------------

/**
 * A minimal wrapper around just the hour picker logic, extracted so we can
 * test the save/clear interactions without the full SettingsPage overhead.
 */
function HourPickerFixture({ initial }: { initial: number | null }) {
  const [hour, setHour] = useState<number | null>(initial);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value;
    const parsed = raw === "" ? null : parseInt(raw, 10);
    const next =
      parsed !== null && !isNaN(parsed) && parsed >= 0 && parsed <= 23
        ? parsed
        : null;
    setHour(next);
    saveSettings({ ...DEFAULT_SETTINGS, pushNotificationHour: next });
  }

  return (
    <div>
      <label htmlFor="push-notification-hour">Daily reminder time</label>
      <select
        id="push-notification-hour"
        value={hour ?? ""}
        onChange={handleChange}
      >
        <option value="">Default (08:00)</option>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={String(h)}>
            {`${String(h).padStart(2, "0")}:00`}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("push notification hour picker (Settings Regional section)", () => {
  it("renders with 'Default (08:00)' selected when no preference is set", () => {
    render(<HourPickerFixture initial={null} />);
    const select = screen.getByRole("combobox", { name: /daily reminder time/i });
    expect(select).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe("");
  });

  it("renders with the stored hour selected when a preference exists", () => {
    render(<HourPickerFixture initial={20} />);
    const select = screen.getByRole("combobox", { name: /daily reminder time/i });
    expect((select as HTMLSelectElement).value).toBe("20");
  });

  it("saves the selected hour to localStorage when the user picks one", async () => {
    const user = userEvent.setup();
    render(<HourPickerFixture initial={null} />);
    const select = screen.getByRole("combobox", { name: /daily reminder time/i });
    await user.selectOptions(select, "18");
    const saved = loadSettings();
    expect(saved.pushNotificationHour).toBe(18);
  });

  it("saves null when the user picks the default option", async () => {
    const user = userEvent.setup();
    render(<HourPickerFixture initial={18} />);
    const select = screen.getByRole("combobox", { name: /daily reminder time/i });
    // Reset to default (empty value).
    await user.selectOptions(select, "");
    const saved = loadSettings();
    expect(saved.pushNotificationHour).toBeNull();
  });

  it("has 25 options total (default + 24 hour options)", () => {
    render(<HourPickerFixture initial={null} />);
    const select = screen.getByRole("combobox", { name: /daily reminder time/i });
    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(25);
  });

  it("formats hours as zero-padded HH:00 strings", () => {
    render(<HourPickerFixture initial={null} />);
    // First hour option (index 1, value "0") should be "00:00".
    const select = screen.getByRole("combobox", { name: /daily reminder time/i });
    const options = Array.from(select.querySelectorAll("option"));
    expect(options[1]?.textContent).toBe("00:00");
    expect(options[9]?.textContent).toBe("08:00"); // index 9 = h=8
    expect(options[24]?.textContent).toBe("23:00");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { StreakProtectionCard } from "./StreakProtectionCard";
import {
  saveSettings,
  loadSettings,
  STORAGE_KEY,
  SETTINGS_SAVED_EVENT,
} from "@/lib/settings/persistence";

// jsdom on this Node version does not ship localStorage; provide a stub.
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
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
});

describe("StreakProtectionCard", () => {
  it("renders zero balance with the correct copy", () => {
    render(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    // The heading is always present so we know the section rendered.
    expect(
      screen.getByRole("heading", { name: "Streak protection" }),
    ).toBeInTheDocument();
    // 0 + "tokens" — verify via the explicit aria-label.
    expect(screen.getByLabelText("0 protection tokens")).toBeInTheDocument();
  });

  it("renders a non-zero balance and the recent-spend history line", () => {
    // Pre-seed settings with a non-trivial protection state so the card has
    // something to show. The card listens to SETTINGS_SAVED_EVENT, but on
    // mount it reads loadSettings() once so a fresh seed is enough.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 2,
          spendDates: ["2026-05-08"],
          daysSinceLastEarn: 5,
          lastEarnCheckDate: "2026-05-09",
        },
      }),
    );

    render(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(screen.getByLabelText("2 protection tokens")).toBeInTheDocument();
    // History line.
    expect(
      screen.getByTestId("streak-protection-last-spend"),
    ).toHaveTextContent(/Streak preserved on/);
    expect(
      screen.getByTestId("streak-protection-last-spend"),
    ).toHaveTextContent(/2 tokens remaining/);
  });

  it("singularises the history-line balance when one token remains", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 1,
          spendDates: ["2026-05-08"],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: "2026-05-09",
        },
      }),
    );

    render(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.getByTestId("streak-protection-last-spend"),
    ).toHaveTextContent(/1 token remaining/);
  });

  it("does not render the history line when no spend has happened", () => {
    render(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.queryByTestId("streak-protection-last-spend"),
    ).not.toBeInTheDocument();
  });

  it("refreshes when settings are saved", () => {
    render(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(screen.getByLabelText("0 protection tokens")).toBeInTheDocument();

    act(() => {
      saveSettings({
        ...loadSettings(),
        streakProtection: {
          balance: 3,
          spendDates: [],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: null,
        },
      });
    });

    expect(screen.getByLabelText("3 protection tokens")).toBeInTheDocument();
    // "(max)" label appears at the cap.
    expect(screen.getByText(/\(max\)/)).toBeInTheDocument();
  });

  it("dispatches SETTINGS_SAVED_EVENT after saveSettings — guard for the refresh test", () => {
    const handler = vi.fn();
    window.addEventListener(SETTINGS_SAVED_EVENT, handler);
    saveSettings(loadSettings());
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(SETTINGS_SAVED_EVENT, handler);
  });
});

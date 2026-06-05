/**
 * PwaInstallNudge - locale coverage.
 *
 * Lives in its own file (not the shared nav-pasture-pokedex-i18n suite) on
 * purpose: PwaInstallNudge renders `null` until a mount effect reads
 * localStorage, and when these tests ran in the shared jsdom *after* the
 * NavDrawer describe (whose mocked links trigger a jsdom "navigation to another
 * Document"), that mount effect intermittently never committed - the component
 * stayed empty and `findByText` timed out (#1464). vitest isolates per file
 * (isolate: true), so a dedicated file gives these tests a clean document and
 * makes them deterministic.
 */

import React from "react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
  screen,
  act,
} from "@/components/test-utils/renderWithIntl";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const VISIT_SESSION_KEY = "poke-memory:visit-counted:v1";

// Mutable settings mock so each test can drive the dismissed/visit-count state.
const mockPwaLoadSettings = vi.fn(() => ({
  appVisitCount: 5,
  onboarding: { installNudgeDismissed: false },
}));
const mockPwaSaveSettings = vi.fn();
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockPwaLoadSettings(),
  saveSettings: (...args: unknown[]) => mockPwaSaveSettings(...args),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

const mockInstallState = vi.fn(() => ({ platform: "ios" as const }));
vi.mock("@/lib/pwa/useInstallPrompt", () => ({
  useInstallPrompt: () => mockInstallState(),
}));

import { PwaInstallNudge } from "@/components/onboarding/PwaInstallNudge";

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

describe("PwaInstallNudge - locale coverage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "sessionStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    // Pre-count the session so the mount effect skips the increment branch.
    sessionStorage.setItem(VISIT_SESSION_KEY, "1");
    mockPwaLoadSettings.mockReturnValue({
      appVisitCount: 5,
      onboarding: { installNudgeDismissed: false },
    });
    mockInstallState.mockReturnValue({ platform: "ios" as const });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("en: shows nudge heading when visit threshold is met and not dismissed (state in)", async () => {
    renderWithIntl(<PwaInstallNudge />);
    await screen.findByText("Install Poké Memory", undefined, { timeout: 3000 });
  });

  it("en: does not show nudge when dismissed (state out)", async () => {
    mockPwaLoadSettings.mockReturnValue({
      appVisitCount: 5,
      onboarding: { installNudgeDismissed: true },
    });
    renderWithIntl(<PwaInstallNudge />);
    await act(async () => {});
    expect(screen.queryByText("Install Poké Memory")).not.toBeInTheDocument();
  });

  it("ja: heading in Japanese", async () => {
    renderJa(<PwaInstallNudge />);
    await screen.findByText("Poké Memory をインストール", undefined, {
      timeout: 3000,
    });
  });

  it("zh-Hans: heading in Simplified Chinese", async () => {
    renderZhHans(<PwaInstallNudge />);
    await screen.findByText("安装 Poké Memory", undefined, { timeout: 3000 });
  });

  it("zh-Hant: heading in Traditional Chinese", async () => {
    renderZhHant(<PwaInstallNudge />);
    await screen.findByText("安裝 Poké Memory", undefined, { timeout: 3000 });
  });
});

/**
 * Component tests for BottomTabBar (issue #852).
 *
 * Covers:
 *   - Static tab list includes the Journey entry.
 *   - Active tab carries aria-current="page".
 *   - Pasture tab appears when pretendAllMastered flag is on.
 *   - Pasture tab hidden when hasMastered=false and flag is off.
 *   - Pasture tab re-derives on a SETTINGS_SAVED_EVENT (#868 follow-up).
 *   - The bar is hidden in hamburger mode.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { mockPathname } = vi.hoisted(() => ({ mockPathname: { value: "/" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "aria-current": ariaCurrent,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-current"?: React.AriaAttributes["aria-current"];
  }) => (
    <a href={href} className={className} aria-current={ariaCurrent}>
      {children}
    </a>
  ),
}));

const mockLoadSession = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/review/persistence", () => ({
  loadSession: () => mockLoadSession(),
  STORAGE_KEY: "poke-memory:review-session:v1",
  SESSION_CHANGED_EVENT: "poke-memory:session-changed",
}));

const mockFilterMastered = vi.fn().mockReturnValue([]);
vi.mock("@/lib/pasture/arrivals", () => ({
  filterMastered: (...args: unknown[]) => mockFilterMastered(...args),
}));

vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn().mockReturnValue(0),
}));

const mockUseSuperuser = vi.fn(() => ({ flags: { pretendAllMastered: false } }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

import type { MobileNav } from "@/lib/settings/persistence";

const mockLoadSettings = vi.fn(
  (): { mobileNav: MobileNav; masteryRepetitions: number } => ({
    mobileNav: "bottom",
    masteryRepetitions: 3,
  }),
);
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

// ---------------------------------------------------------------------------

import { BottomTabBar } from "@/components/BottomTabBar";

// ---------------------------------------------------------------------------

// jsdom on this Node version does not ship localStorage out of the box.
// Install an in-memory stub before each test, matching the pattern used in
// ReviewSession.test.tsx.
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
  mockPathname.value = "/";
  mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
  mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });
  mockLoadSession.mockResolvedValue(null);
  mockFilterMastered.mockReturnValue([]);
});

describe("BottomTabBar", () => {
  it("renders the Journey tab link", async () => {
    render(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    });
  });

  it("includes all core tabs: Practice, Stats, Journey, Pokédex, Settings", async () => {
    render(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Pokédex" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    });
  });

  it("marks the active tab with aria-current='page'", async () => {
    mockPathname.value = "/journey";

    render(<BottomTabBar />);

    await waitFor(() => {
      const journeyLink = screen.getByRole("link", { name: "Journey" });
      expect(journeyLink).toHaveAttribute("aria-current", "page");
    });

    const practiceLink = screen.getByRole("link", { name: "Practice" });
    expect(practiceLink).not.toHaveAttribute("aria-current");
  });

  it("marks /stats as current when pathname is /stats", async () => {
    mockPathname.value = "/stats";

    render(<BottomTabBar />);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Stats" }),
      ).toHaveAttribute("aria-current", "page");
    });
  });

  it("hides Pasture tab when hasMastered=false and pretendAllMastered=false", async () => {
    render(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "Pasture" })).toBeNull();
  });

  it("shows Pasture tab when pretendAllMastered flag is on", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: true } });

    render(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pasture" })).toBeInTheDocument();
    });
  });

  it("re-derives Pasture visibility when SETTINGS_SAVED_EVENT fires", async () => {
    // A real session exists, but with the default threshold nothing is mastered.
    mockLoadSession.mockResolvedValue({ cards: [] });
    mockFilterMastered.mockReturnValue([]);

    render(<BottomTabBar />);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Practice" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "Pasture" })).toBeNull();

    // The user lowers the mastery threshold in Settings; now the same session
    // has a mastered card. A SETTINGS_SAVED_EVENT must re-run the derivation.
    mockLoadSettings.mockReturnValue({
      mobileNav: "bottom",
      masteryRepetitions: 1,
    });
    mockFilterMastered.mockReturnValue([{ id: 1 }]);
    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Pasture" }),
      ).toBeInTheDocument();
    });
  });

  it("shows Pasture tab when KEY_HAS_MASTERED flag is set to 'true'", async () => {
    // Start with no mastered cards — Pasture tab should be absent.
    mockLoadSession.mockResolvedValue(null);
    mockFilterMastered.mockReturnValue([]);

    render(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "Pasture" })).toBeNull();

    // Simulate ReviewSession writing the lightweight mastery flag after a
    // name card crosses the mastery threshold (#1191). The component re-reads
    // the flag whenever its effect re-runs (here we trigger it via
    // SETTINGS_SAVED_EVENT so settingsVersion bumps and the effect fires).
    localStorage.setItem("poke-memory:has-mastered:v2", "true");
    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pasture" })).toBeInTheDocument();
    });
  });

  it("renders nothing when mobileNav is 'hamburger'", async () => {
    mockLoadSettings.mockReturnValue({
      mobileNav: "hamburger" as MobileNav,
      masteryRepetitions: 3,
    });

    const { container } = render(<BottomTabBar />);

    // Allow time for the effect to read the setting
    await waitFor(() => {
      // The nav landmark should not exist
      expect(
        container.querySelector('[aria-label="Mobile tab navigation"]'),
      ).toBeNull();
    });
  });
});

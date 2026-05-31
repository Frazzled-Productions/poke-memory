/**
 * BottomTabBar — streak overlay tests (#1439 / #1442).
 *
 * Tests in a separate file so the useStreakNavState mock can return non-null
 * state (the main BottomTabBar.test.tsx defaults to null to keep existing
 * assertions stable).
 *
 * Covers:
 *   - Stats tab aria-label includes streak + token + milestone info.
 *   - No aria-label on non-Stats tabs.
 *   - Start-your-streak state.
 *   - Token-absent state.
 *   - Locale coverage for aria-label in en, ja, zh-Hans, zh-Hant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";

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
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-current"?: React.AriaAttributes["aria-current"];
    "aria-label"?: string;
  }) => (
    <a href={href} className={className} aria-current={ariaCurrent} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  STORAGE_KEY: "poke-memory:review-session:v1",
  SESSION_CHANGED_EVENT: "poke-memory:session-changed",
}));

vi.mock("@/lib/pasture/arrivals", () => ({
  filterMastered: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({
    flags: { pretendAllMastered: false, forceNextStreakMilestone: false },
  }),
}));

import type { MobileNav } from "@/lib/settings/persistence";

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn((): { mobileNav: MobileNav; masteryRepetitions: number } => ({
    mobileNav: "bottom",
    masteryRepetitions: 3,
  })),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

// useStreakNavState returns loaded streak data for this test suite.
const mockStreakState = vi.fn(() => ({
  streak: 7 as number | null,
  tokenBalance: 1 as number | null,
  daysToNextMilestone: 7 as number | null,
}));

vi.mock("@/lib/streak/useStreakNavState", () => ({
  useStreakNavState: () => mockStreakState(),
}));

// ---------------------------------------------------------------------------

import { BottomTabBar } from "@/components/BottomTabBar";

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
  mockPathname.value = "/";
  mockStreakState.mockReturnValue({ streak: 7, tokenBalance: 1, daysToNextMilestone: 7 });
});

// ---------------------------------------------------------------------------

describe("BottomTabBar — Stats tab streak overlay", () => {
  it("Stats tab aria-label includes streak count", async () => {
    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      const statsLink = screen.getByRole("link", { name: /stats/i });
      const label = statsLink.getAttribute("aria-label") ?? "";
      expect(label).toMatch(/7/);
    });
  });

  it("Stats tab aria-label includes token label when tokenBalance >= 1", async () => {
    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      const statsLink = screen.getByRole("link", { name: /stats/i });
      const label = statsLink.getAttribute("aria-label") ?? "";
      expect(label.toLowerCase()).toMatch(/token/);
    });
  });

  it("Stats tab aria-label includes milestone distance", async () => {
    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      const statsLink = screen.getByRole("link", { name: /stats/i });
      const label = statsLink.getAttribute("aria-label") ?? "";
      expect(label.toLowerCase()).toMatch(/milestone/);
    });
  });

  it("Stats tab aria-label omits token label when tokenBalance is 0", async () => {
    mockStreakState.mockReturnValue({ streak: 5, tokenBalance: 0, daysToNextMilestone: null });

    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      const statsLink = screen.getByRole("link", { name: /stats/i });
      const label = statsLink.getAttribute("aria-label") ?? "";
      expect(label.toLowerCase()).not.toMatch(/token/);
    });
  });

  it("Stats tab aria-label shows 'Start your streak' at 0-day streak", async () => {
    mockStreakState.mockReturnValue({ streak: 0, tokenBalance: 0, daysToNextMilestone: null });

    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      const statsLink = screen.getByRole("link", { name: /stats/i });
      const label = statsLink.getAttribute("aria-label") ?? "";
      expect(label.toLowerCase()).toMatch(/start your streak/);
    });
  });

  it("Practice tab does NOT get an aria-label override", async () => {
    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      const practiceLink = screen.getByRole("link", { name: "Practice" });
      expect(practiceLink).not.toHaveAttribute("aria-label");
    });
  });
});

describe("BottomTabBar — streak overlay locale coverage", () => {
  it("Stats tab aria-label contains Japanese streak text", async () => {
    renderJa(<BottomTabBar />);

    await waitFor(() => {
      // Find Stats tab by its Japanese label (記録)
      const links = screen.getAllByRole("link");
      const statsLink = links.find(
        (l) => l.getAttribute("aria-label")?.includes("7日"),
      );
      expect(statsLink).toBeDefined();
      expect(statsLink?.getAttribute("aria-label")).toMatch(/7日/);
    });
  });

  it("Stats tab aria-label contains Simplified Chinese streak text", async () => {
    renderZhHans(<BottomTabBar />);

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      const statsLink = links.find(
        (l) => l.getAttribute("aria-label")?.includes("7天"),
      );
      expect(statsLink).toBeDefined();
      expect(statsLink?.getAttribute("aria-label")).toMatch(/7天/);
    });
  });

  it("Stats tab aria-label contains Traditional Chinese streak text", async () => {
    renderZhHant(<BottomTabBar />);

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      const statsLink = links.find(
        (l) => l.getAttribute("aria-label")?.includes("7天"),
      );
      expect(statsLink).toBeDefined();
      expect(statsLink?.getAttribute("aria-label")).toMatch(/7天/);
    });
  });
});

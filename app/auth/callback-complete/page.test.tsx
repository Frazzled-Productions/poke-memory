/**
 * Component tests for the auth callback-complete page.
 *
 * The page renders a loading spinner while the auth session is resolving.
 * We drive the loading state by mocking useAuth to return { loading: true }
 * so the mount effect exits early and the component stays in the initial
 * `{ kind: "loading" }` state. This covers the `useTranslations("auth")` call
 * (line 89) and the localised aria-label on the loading div (line 356), which
 * were added as part of the #1607 aria-label i18n sweep.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mocks - declared before the component import so vi.mock hoisting applies.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: true, supabase: null }),
}));

// Stub the many sync/persistence helpers the page imports but does not call
// while loading=true. This prevents module-level side-effects from failing.
vi.mock("@/lib/sync/cloud", () => ({
  hasCloudData: vi.fn(),
  applyCloudAuthoritative: vi.fn(),
  maxCloudUpdatedAt: vi.fn(),
  pullSession: vi.fn(),
  pushSession: vi.fn(),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({})),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(async () => null),
  saveSession: vi.fn(),
  bumpSessionStorageKey: vi.fn(),
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
}));

vi.mock("@/lib/pokemon/SeedContext", () => ({
  useSeed: () => ({
    seed: { seedPokemon: [], seedEvolutionCards: [], seedReverseEvolutionCards: [] },
    error: null,
    retry: vi.fn(),
  }),
}));

vi.mock("@/lib/settings/persistence", () => ({
  hasStoredSettings: vi.fn(() => false),
  loadSettings: vi.fn(() => ({})),
  saveSettings: vi.fn(),
  DEFAULT_SETTINGS: {},
}));

vi.mock("@/lib/sync/settings", () => ({
  pullUserSettingsRow: vi.fn(),
  pullRegionalPrefs: vi.fn(),
  pushSettings: vi.fn(),
  pushRegionalPrefs: vi.fn(),
}));

vi.mock("@/lib/sync/streak", () => ({
  pullStreak: vi.fn(),
  pushStreak: vi.fn(),
}));

vi.mock("@/lib/sync/gradeLog", () => ({
  pullGradeLog: vi.fn(),
  pushGradeLog: vi.fn(),
}));

vi.mock("@/lib/streak/persistence", () => ({
  loadStreakData: vi.fn(() => ({ days: [] })),
  saveStreakData: vi.fn(),
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn(() => []),
  saveGradeLog: vi.fn(),
}));

vi.mock("@/lib/review/seedOpts", () => ({
  seedOptsFromSettings: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Import component after mocks.
// ---------------------------------------------------------------------------

import CallbackCompletePage from "./page";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CallbackCompletePage - loading state", () => {
  it("renders the loading spinner with an aria-busy div in English", () => {
    const { container } = renderWithIntl(<CallbackCompletePage />);
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).not.toBeNull();
    expect(busyEl?.getAttribute("aria-label")).toBe("Checking sync status");
  });

  it("loading div aria-label is localised in Japanese", () => {
    const { container } = renderJa(<CallbackCompletePage />);
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl?.getAttribute("aria-label")).toBe("同期状態を確認中");
  });
});

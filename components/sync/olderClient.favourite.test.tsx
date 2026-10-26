/**
 * Older-client safety for the favourite keys (#2187), the client half of the
 * change's safety fact (the SQL half is
 * `lib/sync/integration/favourite-settings.test.ts`).
 *
 * A device on the previous release rebuilds the settings blob field by field
 * (`parseStoredSettings`), so it holds none of the four new keys. Its
 * AutoSyncOnChange push sends only top-level keys that differ from its last
 * pushed snapshot, so the new keys never appear in its patch and the cloud
 * row keeps them. The previous release's shape is modelled as the current
 * parse with the four new keys removed (they are the only fields this change
 * adds to the parser).
 */

import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AutoSyncOnChange } from "@/components/sync/AutoSyncOnChange";
import {
  loadSettings,
  SETTINGS_SAVED_EVENT,
  STORAGE_KEY,
  type UserSettings,
} from "@/lib/settings/persistence";
import { saveLastPushedSettings } from "@/lib/settings/lastPushedSnapshot";
import { pushSettings } from "@/lib/sync/settings";

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ unlocked: false, flags: {}, anyFlagOn: false, setFlag: vi.fn() }),
}));
vi.mock("@/lib/sync/persistence", () => ({ markPushSucceeded: vi.fn() }));
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "00000000-0000-0000-0000-000000000000" },
    supabase: {} as unknown as SupabaseClient,
  }),
}));
vi.mock("@/lib/sync/settings", () => ({ pushSettings: vi.fn() }));
vi.mock("@/lib/sync/streak", () => ({ pushStreak: vi.fn() }));
vi.mock("@/lib/sync/gradeLog", () => ({ pushGradeLog: vi.fn() }));

const NEW_KEYS = [
  "favouritePokemonId",
  "heartedSpeciesIds",
  "priorityNewSpeciesIds",
  "favouriteThemeOfferedForId",
  "learnFirstAskedSpeciesIds",
] as const;

type OlderSettings = Omit<UserSettings, (typeof NEW_KEYS)[number]>;

/** What the previous release's field-by-field loader keeps of a blob. */
function asOlderClient(settings: UserSettings): OlderSettings {
  const older: Record<string, unknown> = { ...settings };
  for (const key of NEW_KEYS) delete older[key];
  return older as OlderSettings;
}

// The cloud blob after a new-release device has hearted, favourited and
// themed a non-curated species (Bulbasaur).
const CLOUD_BLOB = {
  maxNewPerDay: 10,
  favouriteTheme: {
    id: 1,
    name: "Bulbasaur",
    colors: { primary: "#3E8E2E", secondary: "#9ACF8C", accent: "#E25C8C", fgOnPrimary: "#000000" },
    spriteUrl: "/sprites/pokemon/1.png",
  },
  favouritePokemonId: 1,
  heartedSpeciesIds: [1, 25],
  priorityNewSpeciesIds: [2, 3],
  favouriteThemeOfferedForId: 1,
  learnFirstAskedSpeciesIds: [93],
};

function pushedPatches(): Record<string, unknown>[] {
  return vi.mocked(pushSettings).mock.calls.map((c) => c[2] as Record<string, unknown>);
}

describe("an older app version never pushes the favourite keys (#2187)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(pushSettings).mockResolvedValue(true);
  });

  it("Older version edits another setting: its patch holds only that key", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(CLOUD_BLOB));
    const older = asOlderClient(loadSettings());
    // The older device's last push matched the cloud row it pulled.
    saveLastPushedSettings(older as UserSettings);
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { ...older, maxNewPerDay: 15 } }),
      );
    });

    expect(pushedPatches()).toEqual([{ maxNewPerDay: 15 }]);
  });

  it("An older app version on another device: a dropped Favourites preset is not pushed unless the scope is edited", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...CLOUD_BLOB,
      practiceScope: { gens: [], types: [], presets: ["starters", "favourites"], formCategories: { mode: "all" }, games: [] },
    }));
    const loaded = asOlderClient(loadSettings());
    // The previous release's validator keeps only the presets it knows.
    const older = {
      ...loaded,
      practiceScope: { ...loaded.practiceScope, presets: loaded.practiceScope.presets.filter((p) => p !== "favourites") },
    } as OlderSettings;
    saveLastPushedSettings(older as UserSettings);
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { ...older, maxNewPerDay: 15 } }),
      );
    });

    expect(pushedPatches()).toEqual([{ maxNewPerDay: 15 }]);
  });

  it("a first push from an older device carries none of the new keys and leaves the theme alone", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(CLOUD_BLOB));
    const older = asOlderClient(loadSettings());
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT, { detail: older }));
    });

    const [patch] = pushedPatches();
    for (const key of NEW_KEYS) expect(patch).not.toHaveProperty(key);
    // It pushes the theme it holds, unchanged: never a null in its place.
    expect(patch.favouriteTheme).toEqual(CLOUD_BLOB.favouriteTheme);
  });
});

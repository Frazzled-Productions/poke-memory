import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  DEFAULT_ONBOARDING,
  type ThemeIntensity,
} from '@/lib/settings/persistence';

const STORAGE_KEY = 'poke-memory:settings:v1';

// The lib/ test suite runs in the node environment where window and localStorage
// are not defined. loadSettings() guards with `typeof window === "undefined"` and
// returns DEFAULT_SETTINGS on the server side, so we stub both globals to exercise
// the browser path.
function makeLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
    _store: store,
  };
}

const mockLocalStorage = makeLocalStorageMock();

// Stub window and localStorage before any tests run.
vi.stubGlobal('window', { localStorage: mockLocalStorage, dispatchEvent: vi.fn() });
vi.stubGlobal('localStorage', mockLocalStorage);

beforeEach(() => {
  mockLocalStorage.clear();
});

describe('loadSettings migration', () => {
  it('returns DEFAULT_SETTINGS when localStorage is empty (null)', () => {
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('stored object missing nameCardsEnabled defaults to true', () => {
    const partial = {
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      // nameCardsEnabled intentionally absent
      evolutionCardsEnabled: true,
      reverseCardsEnabled: false,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
    };
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
    const settings = loadSettings();
    expect(settings.nameCardsEnabled).toBe(true);
  });

  it('stored object missing evolutionCardsEnabled defaults to true', () => {
    const partial = {
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      nameCardsEnabled: true,
      // evolutionCardsEnabled intentionally absent
      reverseCardsEnabled: false,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
    };
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
    const settings = loadSettings();
    expect(settings.evolutionCardsEnabled).toBe(true);
  });

  it('stored object with both fields explicitly false respects them', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      nameCardsEnabled: false,
      evolutionCardsEnabled: false,
    });
    const settings = loadSettings();
    expect(settings.nameCardsEnabled).toBe(false);
    expect(settings.evolutionCardsEnabled).toBe(false);
  });

  it('stored object with both fields explicitly true respects them', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
    });
    const settings = loadSettings();
    expect(settings.nameCardsEnabled).toBe(true);
    expect(settings.evolutionCardsEnabled).toBe(true);
  });

  it('empty stored object (non-null but no fields) returns all DEFAULT_SETTINGS values', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings + loadSettings round-trips all settings correctly', () => {
    const custom = {
      masteryRepetitions: 5,
      maxNewPerDay: 20,
      maxReviewsPerDay: 200,
      maxNewEvolutionPerDay: 10,
      maxReviewsEvolutionPerDay: 75,
      nameCardsEnabled: false,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: true,
      reverseCardsEnabled: true,
      maxNewReversePerDay: 15,
      maxReviewsReversePerDay: 50,
      playCryOnReveal: true,
      speakNameOnReveal: false,
      cryCardsEnabled: true,
      maxNewCryPerDay: 12,
      maxReviewsCryPerDay: 80,
      favouriteTheme: null,
      themeIntensity: 'accents' as const,
      retentionTarget: 0.95,
      practiceScope: { gens: [1, 3], types: ['fire', 'water'], presets: ['starters' as const], formCategories: { mode: 'all' as const } },
      miniGameBestScore: 0,
      seenStreakMilestones: [3, 7],
      earnedBadges: [{ id: 'cascade-badge', earnedAt: '2026-05-13T09:00:00.000Z' }],
      onboarding: { ...DEFAULT_ONBOARDING },
    };
    saveSettings(custom);
    const loaded = loadSettings();
    expect(loaded).toEqual(custom);
  });
});

describe('loadSettings: earnedBadges (#420)', () => {
  it('defaults to [] when the field is missing', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    expect(loadSettings().earnedBadges).toEqual([]);
  });

  it('round-trips a populated list', () => {
    const entries = [
      { id: 'cascade-badge', earnedAt: '2026-05-13T09:00:00.000Z' },
      { id: 'eeveelutions', earnedAt: '2026-05-13T09:01:00.000Z' },
    ];
    saveSettings({ ...DEFAULT_SETTINGS, earnedBadges: entries });
    expect(loadSettings().earnedBadges).toEqual(entries);
  });

  it('falls back to [] when the field is not an array', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ earnedBadges: 'broken' }));
    expect(loadSettings().earnedBadges).toEqual([]);
  });

  it('keeps well-formed entries and silently drops malformed ones', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        earnedBadges: [
          { id: 'cascade-badge', earnedAt: '2026-05-13T09:00:00.000Z' },
          { id: 'no-timestamp' }, // malformed — missing earnedAt
          { id: 'eeveelutions', earnedAt: '2026-05-13T10:00:00.000Z' },
        ],
      }),
    );
    expect(loadSettings().earnedBadges).toEqual([
      { id: 'cascade-badge', earnedAt: '2026-05-13T09:00:00.000Z' },
      { id: 'eeveelutions', earnedAt: '2026-05-13T10:00:00.000Z' },
    ]);
  });

  it('drops non-object entries (e.g. bare strings)', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        earnedBadges: [
          'cascade-badge', // wrong shape
          { id: 'eeveelutions', earnedAt: '2026-05-13T10:00:00.000Z' },
        ],
      }),
    );
    expect(loadSettings().earnedBadges).toEqual([
      { id: 'eeveelutions', earnedAt: '2026-05-13T10:00:00.000Z' },
    ]);
  });
});

describe('loadSettings: practiceScope (#333)', () => {
  it('loads stored practiceScope with all axes populated', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      practiceScope: { gens: [1, 2], types: ['fire'], presets: ['starters'] },
    });
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({
      gens: [1, 2],
      types: ['fire'],
      presets: ['starters'],
      formCategories: { mode: 'all' },
    });
  });

  it('falls back to the empty scope when the field is missing', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, practiceScope: undefined }));
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });
  });

  it('falls back to the empty scope on a non-object value', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, practiceScope: 'broken' }));
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });
  });

  it('falls back to the empty scope when gens contains an out-of-range value', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [0], types: [], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });
  });

  it('falls back to the empty scope when gens contains a non-integer', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [1.5], types: [], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });
  });

  it('falls back to the empty scope when any axis is not an array', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: 1, types: [], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });

    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [], types: 'fire', presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });

    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [], types: [], presets: 'starters' },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });
  });

  it('dedupes repeated gen values', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [1, 1, 2, 1], types: [], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [1, 2], types: [], presets: [], formCategories: { mode: 'all' } });
  });

  it('drops unknown preset literals silently (no payload-wide rejection)', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [], types: [], presets: ['starters', 'banana', 'legendaries'] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({
      gens: [],
      types: [],
      presets: ['starters', 'legendaries'],
      formCategories: { mode: 'all' },
    });
  });

  it('accepts permissive type strings — UI restricts inputs, validator does not', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [], types: ['fire', 'unknown-but-stringy'], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({
      gens: [],
      types: ['fire', 'unknown-but-stringy'],
      presets: [],
      formCategories: { mode: 'all' },
    });
  });
});

// ─── legacy scope migration ──────────────────────────────────────────────

const LEGACY_SCOPE_KEY = 'poke-memory:practice-scope:v1';

describe('loadSettings: legacy practice-scope migration', () => {
  it('copies a non-empty legacy scope into settings.practiceScope and clears the legacy key', () => {
    // No settings yet — fresh device with a pre-#333 scope set.
    mockLocalStorage.setItem(
      LEGACY_SCOPE_KEY,
      JSON.stringify({ gens: [1], types: ['fire'], presets: [] }),
    );
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [1], types: ['fire'], presets: [], formCategories: { mode: 'all' } });
    // Legacy key removed after migration — never fires again.
    expect(mockLocalStorage.getItem(LEGACY_SCOPE_KEY)).toBeNull();
    // Settings persisted, so the next load reads the migrated scope from
    // the canonical settings blob without needing the legacy key.
    expect(mockLocalStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const reloaded = loadSettings();
    expect(reloaded.practiceScope).toEqual({ gens: [1], types: ['fire'], presets: [], formCategories: { mode: 'all' } });
  });

  it('no-ops when the legacy key is absent', () => {
    // No legacy key → loadSettings returns defaults; no persistence side effect.
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });
    // No settings blob was written (legacy absent → no migration fired).
    expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('stored settings.practiceScope wins over the legacy key; legacy key is still cleared', () => {
    // Existing settings carry an explicit non-default scope. The legacy
    // key is treated as stale — clear it without overwriting.
    saveSettings({
      ...DEFAULT_SETTINGS,
      practiceScope: { gens: [2], types: [], presets: [] },
    });
    mockLocalStorage.setItem(
      LEGACY_SCOPE_KEY,
      JSON.stringify({ gens: [1], types: ['fire'], presets: [] }),
    );
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [2], types: [], presets: [], formCategories: { mode: 'all' } });
    expect(mockLocalStorage.getItem(LEGACY_SCOPE_KEY)).toBeNull();
  });

  it('clears a legacy key with an empty scope payload (no copy, just cleanup)', () => {
    mockLocalStorage.setItem(
      LEGACY_SCOPE_KEY,
      JSON.stringify({ gens: [], types: [], presets: [] }),
    );
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });
    expect(mockLocalStorage.getItem(LEGACY_SCOPE_KEY)).toBeNull();
  });

  it('ignores a malformed legacy payload without throwing', () => {
    mockLocalStorage.setItem(LEGACY_SCOPE_KEY, '{not json');
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' } });
  });
});

// ─── themeIntensity (#411) ───────────────────────────────────────────────────

describe('themeIntensity setting (#411)', () => {
  it('loadSettings returns themeIntensity: "accents" for a brand-new device (no localStorage)', () => {
    // mockLocalStorage is cleared in beforeEach — nothing stored.
    const settings = loadSettings();
    expect(settings.themeIntensity).toBe('accents');
  });

  it('parseStoredSettings accepts each valid ThemeIntensity literal', () => {
    const intensities: ThemeIntensity[] = ['accents', 'tinted', 'full'];
    for (const intensity of intensities) {
      mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, themeIntensity: intensity }));
      expect(loadSettings().themeIntensity).toBe(intensity);
    }
  });

  it('parseStoredSettings falls back to "accents" for any unknown value', () => {
    for (const bad of ['FULL', 'Full', 'none', '', 42, null, undefined, {}]) {
      mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, themeIntensity: bad }));
      expect(loadSettings().themeIntensity).toBe('accents');
    }
  });

  it('saveSettings + loadSettings round-trips themeIntensity correctly', () => {
    saveSettings({ ...DEFAULT_SETTINGS, themeIntensity: 'full' });
    expect(loadSettings().themeIntensity).toBe('full');

    saveSettings({ ...DEFAULT_SETTINGS, themeIntensity: 'tinted' });
    expect(loadSettings().themeIntensity).toBe('tinted');

    saveSettings({ ...DEFAULT_SETTINGS, themeIntensity: 'accents' });
    expect(loadSettings().themeIntensity).toBe('accents');
  });

  describe('onboarding flags (#433)', () => {
    it('defaults all flags to false on a fresh load', () => {
      expect(loadSettings().onboarding).toEqual(DEFAULT_ONBOARDING);
    });

    it('stored settings missing the onboarding field default to all false', () => {
      mockLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...DEFAULT_SETTINGS, onboarding: undefined }),
      );
      expect(loadSettings().onboarding).toEqual(DEFAULT_ONBOARDING);
    });

    it('round-trips dismissals via saveSettings', () => {
      saveSettings({
        ...DEFAULT_SETTINGS,
        onboarding: {
          welcomeDismissed: true,
          practiceHintDismissed: false,
          statsHintDismissed: true,
          settingsHintDismissed: false,
        },
      });
      expect(loadSettings().onboarding).toEqual({
        welcomeDismissed: true,
        practiceHintDismissed: false,
        statsHintDismissed: true,
        settingsHintDismissed: false,
      });
    });

    it('treats malformed onboarding payloads as all false', () => {
      for (const bad of [null, 'oops', 42, true, []]) {
        mockLocalStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...DEFAULT_SETTINGS, onboarding: bad }),
        );
        expect(loadSettings().onboarding).toEqual(DEFAULT_ONBOARDING);
      }
    });

    it('non-boolean per-flag values coerce to false', () => {
      mockLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...DEFAULT_SETTINGS,
          onboarding: {
            welcomeDismissed: 'true',
            practiceHintDismissed: 1,
            statsHintDismissed: null,
            settingsHintDismissed: true,
          },
        }),
      );
      expect(loadSettings().onboarding).toEqual({
        welcomeDismissed: false,
        practiceHintDismissed: false,
        statsHintDismissed: false,
        settingsHintDismissed: true,
      });
    });
  });
});

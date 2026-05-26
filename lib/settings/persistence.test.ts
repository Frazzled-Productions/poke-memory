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

  it('empty stored object (non-null but no fields) returns DEFAULT_SETTINGS values, except mobileNav which defaults to hamburger for existing users', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    const settings = loadSettings();
    // mobileNav defaults to 'hamburger' for existing records without the field
    // (preserving the pre-#661 experience for existing users). All other fields
    // match DEFAULT_SETTINGS.
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, mobileNav: 'hamburger' });
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
      practiceScope: { gens: [1, 3], types: ['fire', 'water'], presets: ['starters' as const], formCategories: { mode: 'all' as const }, games: [] },
      miniGameBestScore: 0,
      seenStreakMilestones: [3, 7],
      earnedBadges: [{ id: 'cascade-badge', earnedAt: '2026-05-13T09:00:00.000Z' }],
      onboarding: { ...DEFAULT_ONBOARDING },
      appVisitCount: 7,
      alternateFormsEnabled: true,
      ttsVoice: 'Daniel:en-GB',
      ttsRate: 1.5,
      ttsVolume: 0.75,
      waitForAudioOnGrade: false,
      reverseFeedbackDelay: 'fast' as const,
      timezone: 'Europe/London',
      dateFormat: 'dmy' as const,
      mobileNav: 'bottom' as const,
      streakProtection: {
        balance: 2,
        spendDates: ['2026-05-08'],
        daysSinceLastEarn: 12,
        lastEarnCheckDate: '2026-05-09',
        protectionEvents: [],
        lastAcknowledgedProtectionEventDate: null,
      },
    };
    saveSettings(custom);
    const loaded = loadSettings();
    expect(loaded).toEqual(custom);
  });
});

describe('loadSettings: waitForAudioOnGrade (#1191)', () => {
  it('defaults to true when the field is absent (existing records get the safe default)', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    expect(loadSettings().waitForAudioOnGrade).toBe(true);
  });

  it('round-trips false correctly', () => {
    saveSettings({ ...DEFAULT_SETTINGS, waitForAudioOnGrade: false });
    expect(loadSettings().waitForAudioOnGrade).toBe(false);
  });

  it('round-trips true correctly', () => {
    saveSettings({ ...DEFAULT_SETTINGS, waitForAudioOnGrade: true });
    expect(loadSettings().waitForAudioOnGrade).toBe(true);
  });

  it('non-boolean value falls back to default (true)', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ waitForAudioOnGrade: 'yes' }));
    expect(loadSettings().waitForAudioOnGrade).toBe(true);
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
      games: [],
    });
  });

  it('falls back to the empty scope when the field is missing', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, practiceScope: undefined }));
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
  });

  it('falls back to the empty scope on a non-object value', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, practiceScope: 'broken' }));
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
  });

  it('falls back to the empty scope when gens contains an out-of-range value', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [0], types: [], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
  });

  it('falls back to the empty scope when gens contains a non-integer', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [1.5], types: [], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
  });

  it('falls back to the empty scope when any axis is not an array', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: 1, types: [], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });

    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [], types: 'fire', presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });

    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [], types: [], presets: 'starters' },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
  });

  it('dedupes repeated gen values', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [1, 1, 2, 1], types: [], presets: [] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({ gens: [1, 2], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
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
      games: [],
    });
  });

  it('preserves the incomplete-chains preset literal (#995)', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        practiceScope: { gens: [], types: [], presets: ['incomplete-chains'] },
      }),
    );
    expect(loadSettings().practiceScope).toEqual({
      gens: [],
      types: [],
      presets: ['incomplete-chains'],
      formCategories: { mode: 'all' },
      games: [],
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
      games: [],
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
    expect(settings.practiceScope).toEqual({ gens: [1], types: ['fire'], presets: [], formCategories: { mode: 'all' }, games: [] });
    // Legacy key removed after migration — never fires again.
    expect(mockLocalStorage.getItem(LEGACY_SCOPE_KEY)).toBeNull();
    // Settings persisted, so the next load reads the migrated scope from
    // the canonical settings blob without needing the legacy key.
    expect(mockLocalStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const reloaded = loadSettings();
    expect(reloaded.practiceScope).toEqual({ gens: [1], types: ['fire'], presets: [], formCategories: { mode: 'all' }, games: [] });
  });

  it('no-ops when the legacy key is absent', () => {
    // No legacy key → loadSettings returns defaults; no persistence side effect.
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
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
    expect(settings.practiceScope).toEqual({ gens: [2], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
    expect(mockLocalStorage.getItem(LEGACY_SCOPE_KEY)).toBeNull();
  });

  it('clears a legacy key with an empty scope payload (no copy, just cleanup)', () => {
    mockLocalStorage.setItem(
      LEGACY_SCOPE_KEY,
      JSON.stringify({ gens: [], types: [], presets: [] }),
    );
    const settings = loadSettings();
    expect(settings.practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
    expect(mockLocalStorage.getItem(LEGACY_SCOPE_KEY)).toBeNull();
  });

  it('ignores a malformed legacy payload without throwing', () => {
    mockLocalStorage.setItem(LEGACY_SCOPE_KEY, '{not json');
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings().practiceScope).toEqual({ gens: [], types: [], presets: [], formCategories: { mode: 'all' }, games: [] });
  });
});

// ─── TTS settings (#429) ────────────────────────────────────────────────────

describe('TTS settings (#429)', () => {
  it('defaults ttsVoice to null, ttsRate to 1, ttsVolume to 1 on a fresh load', () => {
    const s = loadSettings();
    expect(s.ttsVoice).toBeNull();
    expect(s.ttsRate).toBe(1);
    expect(s.ttsVolume).toBe(1);
  });

  it('round-trips ttsVoice, ttsRate, and ttsVolume via saveSettings', () => {
    saveSettings({ ...DEFAULT_SETTINGS, ttsVoice: 'Daniel:en-GB', ttsRate: 1.5, ttsVolume: 0.8 });
    const s = loadSettings();
    expect(s.ttsVoice).toBe('Daniel:en-GB');
    expect(s.ttsRate).toBe(1.5);
    expect(s.ttsVolume).toBe(0.8);
  });

  it('defaults ttsVoice to null when the stored value is not a string', () => {
    for (const bad of [42, null, undefined, true, {}]) {
      mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ttsVoice: bad }));
      expect(loadSettings().ttsVoice).toBeNull();
    }
  });

  it('clamps ttsRate into [0.5, 2.0]', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ttsRate: 0.1 }));
    expect(loadSettings().ttsRate).toBe(0.5);
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ttsRate: 5.0 }));
    expect(loadSettings().ttsRate).toBe(2.0);
  });

  it('clamps ttsVolume into [0, 1]', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ttsVolume: -0.5 }));
    expect(loadSettings().ttsVolume).toBe(0);
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ttsVolume: 2 }));
    expect(loadSettings().ttsVolume).toBe(1);
  });

  it('defaults ttsRate and ttsVolume when the stored value is non-finite', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'fast', null]) {
      mockLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...DEFAULT_SETTINGS, ttsRate: bad, ttsVolume: bad }),
      );
      const s = loadSettings();
      expect(s.ttsRate).toBe(1);
      expect(s.ttsVolume).toBe(1);
    }
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
          firstVisitOnboardingDismissed: true,
          welcomeDismissed: true,
          practiceHintDismissed: false,
          statsHintDismissed: true,
          settingsHintDismissed: false,
          installNudgeDismissed: true,
          audioHintDismissed: false,
          cardTypesHintDismissed: true,
          guestStorageNoticeDismissed: false,
        },
      });
      expect(loadSettings().onboarding).toEqual({
        firstVisitOnboardingDismissed: true,
        welcomeDismissed: true,
        practiceHintDismissed: false,
        statsHintDismissed: true,
        settingsHintDismissed: false,
        installNudgeDismissed: true,
        audioHintDismissed: false,
        cardTypesHintDismissed: true,
        guestStorageNoticeDismissed: false,
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
            audioHintDismissed: 'yes',
            cardTypesHintDismissed: 0,
          },
        }),
      );
      expect(loadSettings().onboarding).toEqual({
        firstVisitOnboardingDismissed: false,
        welcomeDismissed: false,
        practiceHintDismissed: false,
        statsHintDismissed: false,
        settingsHintDismissed: true,
        installNudgeDismissed: false,
        audioHintDismissed: false,
        cardTypesHintDismissed: false,
        guestStorageNoticeDismissed: false,
      });
    });
  });
});

// ─── alternateFormsEnabled (#658) ───────────────────────────────────────────

describe('alternateFormsEnabled (#658)', () => {
  it('defaults to false on a fresh load (no localStorage)', () => {
    expect(loadSettings().alternateFormsEnabled).toBe(false);
  });

  it('stored object missing alternateFormsEnabled defaults to false', () => {
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    expect(loadSettings().alternateFormsEnabled).toBe(false);
  });

  it('non-boolean alternateFormsEnabled falls back to false', () => {
    for (const bad of [1, 'true', null, undefined, {}]) {
      mockLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...DEFAULT_SETTINGS, alternateFormsEnabled: bad }),
      );
      expect(loadSettings().alternateFormsEnabled).toBe(false);
    }
  });

  it('round-trips true via saveSettings', () => {
    saveSettings({ ...DEFAULT_SETTINGS, alternateFormsEnabled: true });
    expect(loadSettings().alternateFormsEnabled).toBe(true);
  });

  it('round-trips false via saveSettings', () => {
    saveSettings({ ...DEFAULT_SETTINGS, alternateFormsEnabled: false });
    expect(loadSettings().alternateFormsEnabled).toBe(false);
  });
});

// ─── coercion helper coverage ────────────────────────────────────────────────
//
// These tests assert behaviour that the num/bool/str helpers must preserve.
// They serve as a regression guard confirming the refactor did not change
// observable outcomes for any of the collapsed fields.

describe('coercion helper: num fields fall back to DEFAULT_SETTINGS on wrong type', () => {
  const numFields = [
    'masteryRepetitions',
    'maxNewPerDay',
    'maxReviewsPerDay',
    'maxNewEvolutionPerDay',
    'maxReviewsEvolutionPerDay',
    'maxNewReversePerDay',
    'maxReviewsReversePerDay',
    'maxNewCryPerDay',
    'maxReviewsCryPerDay',
  ] as const;

  it('returns the default value when the stored field is a non-number', () => {
    for (const field of numFields) {
      for (const bad of ['42', true, null, [], {}]) {
        mockLocalStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...DEFAULT_SETTINGS, [field]: bad }),
        );
        expect(loadSettings()[field]).toBe(DEFAULT_SETTINGS[field]);
      }
    }
  });

  it('round-trips a non-default number correctly', () => {
    for (const field of numFields) {
      const nonDefault = DEFAULT_SETTINGS[field] + 7;
      mockLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...DEFAULT_SETTINGS, [field]: nonDefault }),
      );
      expect(loadSettings()[field]).toBe(nonDefault);
    }
  });
});

describe('coercion helper: bool fields fall back to DEFAULT_SETTINGS on wrong type', () => {
  const boolFields = [
    'nameCardsEnabled',
    'evolutionCardsEnabled',
    'reverseEvolutionCardsEnabled',
    'reverseCardsEnabled',
    'playCryOnReveal',
    'speakNameOnReveal',
    'cryCardsEnabled',
    'alternateFormsEnabled',
  ] as const;

  it('returns the default value when the stored field is a non-boolean', () => {
    for (const field of boolFields) {
      for (const bad of [1, 'true', null, {}, []]) {
        mockLocalStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...DEFAULT_SETTINGS, [field]: bad }),
        );
        expect(loadSettings()[field]).toBe(DEFAULT_SETTINGS[field]);
      }
    }
  });
});

describe('coercion helper: str fields fall back to DEFAULT_SETTINGS on wrong type', () => {
  it('timezone defaults to null when the stored value is not a string', () => {
    for (const bad of [42, null, undefined, true, {}]) {
      mockLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...DEFAULT_SETTINGS, timezone: bad }),
      );
      expect(loadSettings().timezone).toBeNull();
    }
  });

  it('timezone round-trips a stored string value', () => {
    mockLocalStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, timezone: 'Europe/London' }),
    );
    expect(loadSettings().timezone).toBe('Europe/London');
  });
});

describe('reverseFeedbackDelay migration (#1200)', () => {
  it('defaults to "default" when the field is absent (pre-#1200 record)', () => {
    const { reverseFeedbackDelay: _omitted, ...withoutField } = DEFAULT_SETTINGS;
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify(withoutField));
    expect(loadSettings().reverseFeedbackDelay).toBe('default');
  });

  it('round-trips each valid value', () => {
    for (const value of ['off', 'fast', 'default'] as const) {
      mockLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...DEFAULT_SETTINGS, reverseFeedbackDelay: value }),
      );
      expect(loadSettings().reverseFeedbackDelay).toBe(value);
    }
  });

  it('falls back to "default" for unknown/invalid stored values', () => {
    for (const bad of ['instant', 'slow', 42, null, true, {}]) {
      mockLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...DEFAULT_SETTINGS, reverseFeedbackDelay: bad }),
      );
      expect(loadSettings().reverseFeedbackDelay).toBe('default');
    }
  });
});

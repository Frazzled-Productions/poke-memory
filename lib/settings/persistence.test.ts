import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '@/lib/settings/persistence';

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
vi.stubGlobal('window', { localStorage: mockLocalStorage });
vi.stubGlobal('localStorage', mockLocalStorage);

beforeEach(() => {
  mockLocalStorage.clear();
});

describe('loadSettings migration', () => {
  it('returns DEFAULT_SETTINGS when localStorage is empty (null)', () => {
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('returns DEFAULT_SETTINGS when stored value is null (key absent)', () => {
    // key is absent — getItem returns null
    const settings = loadSettings();
    expect(settings.nameCardsEnabled).toBe(DEFAULT_SETTINGS.nameCardsEnabled);
    expect(settings.evolutionCardsEnabled).toBe(DEFAULT_SETTINGS.evolutionCardsEnabled);
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
      reverseCardsEnabled: true,
      maxNewReversePerDay: 15,
      maxReviewsReversePerDay: 50,
    };
    saveSettings(custom);
    const loaded = loadSettings();
    expect(loaded).toEqual(custom);
  });
});

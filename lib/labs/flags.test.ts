import { describe, it, expect } from 'vitest';
import {
  LABS_FLAGS,
  DEFAULT_LABS_FLAGS,
  parseLabsFlags,
  isLabsFlagEnabled,
  type LabsFlagKey,
  type LabsFlags,
} from './flags';

describe('LABS_FLAGS registry (#1258)', () => {
  it('is an object (may be empty - infrastructure-only on initial ship)', () => {
    expect(typeof LABS_FLAGS).toBe('object');
  });

  it('DEFAULT_LABS_FLAGS contains every registry key with a boolean value', () => {
    for (const key of Object.keys(LABS_FLAGS) as LabsFlagKey[]) {
      expect(typeof DEFAULT_LABS_FLAGS[key]).toBe('boolean');
    }
  });

  it('DEFAULT_LABS_FLAGS has no keys beyond those in the registry', () => {
    const registryKeys = new Set(Object.keys(LABS_FLAGS));
    for (const key of Object.keys(DEFAULT_LABS_FLAGS)) {
      expect(registryKeys.has(key)).toBe(true);
    }
  });
});

describe('parseLabsFlags (#1258)', () => {
  it('returns DEFAULT_LABS_FLAGS when passed null', () => {
    expect(parseLabsFlags(null)).toEqual(DEFAULT_LABS_FLAGS);
  });

  it('returns DEFAULT_LABS_FLAGS when passed undefined', () => {
    expect(parseLabsFlags(undefined)).toEqual(DEFAULT_LABS_FLAGS);
  });

  it('returns DEFAULT_LABS_FLAGS when passed a non-object', () => {
    for (const bad of [42, 'string', true, []]) {
      expect(parseLabsFlags(bad)).toEqual(DEFAULT_LABS_FLAGS);
    }
  });

  it('returns DEFAULT_LABS_FLAGS when passed an empty object', () => {
    expect(parseLabsFlags({})).toEqual(DEFAULT_LABS_FLAGS);
  });

  it('silently drops unknown keys - only registry keys survive', () => {
    const result = parseLabsFlags({ unknownFeature: true, anotherOne: false });
    // Result must equal DEFAULT_LABS_FLAGS (unknown keys discarded).
    expect(result).toEqual(DEFAULT_LABS_FLAGS);
    expect(Object.keys(result)).toEqual(Object.keys(DEFAULT_LABS_FLAGS));
  });

  it('back-fills missing registry keys with their defaults', () => {
    // Passing an empty object triggers back-fill for every key.
    const result = parseLabsFlags({});
    for (const key of Object.keys(LABS_FLAGS) as LabsFlagKey[]) {
      expect(result[key]).toBe(DEFAULT_LABS_FLAGS[key]);
    }
  });

  it('does not throw on completely malformed input', () => {
    expect(() => parseLabsFlags(null)).not.toThrow();
    expect(() => parseLabsFlags(undefined)).not.toThrow();
    expect(() => parseLabsFlags('{"broken')).not.toThrow();
    expect(() => parseLabsFlags(Symbol('x'))).not.toThrow();
  });
});

describe('isLabsFlagEnabled (#1258)', () => {
  it('returns false for an unknown key when labsFlags is undefined', () => {
    // LabsFlagKey is `never` when the registry is empty, so cast to test the guard.
    const result = isLabsFlagEnabled(undefined, 'nonexistent' as LabsFlagKey);
    expect(result).toBe(false);
  });

  it('returns the correct value for a known key in a populated record', () => {
    // Only meaningful when the registry has entries; tested with a cast for
    // infrastructure coverage while the registry is empty.
    const flags = { ...DEFAULT_LABS_FLAGS } as LabsFlags & Record<string, boolean>;
    for (const key of Object.keys(LABS_FLAGS) as LabsFlagKey[]) {
      // Round-trip: default value matches isLabsFlagEnabled(flags, key).
      expect(isLabsFlagEnabled(flags, key)).toBe(DEFAULT_LABS_FLAGS[key]);
    }
  });

  it('falls back to false when the key is missing from the provided record', () => {
    // Cast an empty object as LabsFlags to simulate a blob with missing keys.
    const result = isLabsFlagEnabled({} as LabsFlags, 'nonexistent' as LabsFlagKey);
    expect(result).toBe(false);
  });

  it('returns false for every key in DEFAULT_LABS_FLAGS (all flags default off)', () => {
    for (const key of Object.keys(LABS_FLAGS) as LabsFlagKey[]) {
      expect(DEFAULT_LABS_FLAGS[key]).toBe(false);
      expect(isLabsFlagEnabled(DEFAULT_LABS_FLAGS, key)).toBe(false);
    }
  });
});

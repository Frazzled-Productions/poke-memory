/**
 * Labs flags infrastructure (#1258).
 *
 * Labs flags are opt-in feature flags for preview / pre-release features.
 * They are distinct from Superuser/Developer flags (which are QA cheats):
 * Labs flags are real user preferences, sync normally, and are never gated
 * by the superuser write-guard.
 *
 * Shape of LABS_FLAGS registry:
 *
 *   const LABS_FLAGS = {
 *     someFeature: {
 *       label: "Some Feature",
 *       description: "What this does and why you might want it.",
 *       default: false,
 *     },
 *   } as const;
 *
 * The registry is intentionally empty here — this issue ships infrastructure
 * only. Subsequent issues register the first flags.
 */

/**
 * Static registry of all known Labs flags.
 * Each key is the canonical flag identifier used as a key in
 * `UserSettings.labsFlags`.
 *
 * Currently empty — infrastructure only (#1258).
 */
export const LABS_FLAGS = {
  // Future flags are registered here. Example shape:
  //
  // languages: {
  //   label: "Languages",
  //   description: "Multi-locale Pokémon names and app UI translation. Translations are machine-generated; feedback welcome.",
  //   default: false,
  // },
} as const;

/**
 * Union of all known Labs flag keys, derived from the registry.
 * Expands to `never` while the registry is empty.
 */
export type LabsFlagKey = keyof typeof LABS_FLAGS;

/**
 * The concrete record type stored under `UserSettings.labsFlags`.
 * Maps each known flag key to a boolean.
 */
export type LabsFlags = Record<LabsFlagKey, boolean>;

/**
 * Default values for all known Labs flags, derived from the registry.
 * Back-fill on read uses this to populate any key missing from the
 * persisted blob.
 */
export const DEFAULT_LABS_FLAGS: LabsFlags = Object.fromEntries(
  (Object.entries(LABS_FLAGS) as [LabsFlagKey, { default: boolean }][]).map(
    ([key, meta]) => [key, meta.default],
  ),
) as LabsFlags;

/**
 * Parses a raw (unknown) value from the persisted settings blob into a fully-
 * populated `LabsFlags` object. Missing keys are back-filled from
 * `DEFAULT_LABS_FLAGS`. Malformed or unknown keys are silently ignored.
 *
 * Does not throw.
 */
export function parseLabsFlags(value: unknown): LabsFlags {
  const out = { ...DEFAULT_LABS_FLAGS };
  if (typeof value !== "object" || value === null) return out;
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(LABS_FLAGS) as LabsFlagKey[]) {
    if (typeof raw[key] === "boolean") {
      (out as Record<string, boolean>)[key] = raw[key] as boolean;
    }
    // Non-boolean or missing → keep the default already in `out`.
  }
  return out;
}

/**
 * Returns whether a specific Labs flag is enabled for the given `labsFlags`
 * record. Handles the empty-registry case (always returns `false`) and back-
 * fills missing keys so callers do not need to guard for `undefined`.
 *
 * For use in non-React call sites. React components should prefer
 * `useLabsFlag` from `lib/labs/useLabsFlag.ts`.
 */
export function isLabsFlagEnabled(
  labsFlags: LabsFlags | undefined,
  key: LabsFlagKey,
): boolean {
  if (labsFlags === undefined) return DEFAULT_LABS_FLAGS[key] ?? false;
  return labsFlags[key] ?? DEFAULT_LABS_FLAGS[key] ?? false;
}

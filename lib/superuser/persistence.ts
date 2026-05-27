// Two-level state:
//   UNLOCKED_KEY ("poke-memory:superuser") gates visibility of the Developer
//   panel. Toggled by the chord/tap gesture. Persisting "true" here does not
//   itself change any user-visible behaviour beyond revealing the panel.
//
//   FLAGS_KEY ("poke-memory:superuser:flags:v1") stores the per-behaviour
//   toggles. Each flag is independently set from the Developer panel.
//
// Flags are kept separate from "unlocked" so a user can have superuser
// unlocked but no flags active — equivalent to a closed inspector window.

import { KEY_SUPERUSER_UNLOCKED, KEY_SUPERUSER_FLAGS } from "@/lib/storage/keys";

export const UNLOCKED_KEY = KEY_SUPERUSER_UNLOCKED;
export const FLAGS_KEY = KEY_SUPERUSER_FLAGS;

export type SuperuserFlagKey =
  | "pretendAllMastered"
  | "forceNextStreakMilestone"
  | "forceCardsGraduated";

export type SuperuserFlags = {
  pretendAllMastered: boolean;
  // When true, the next render of StreakBadge fires the smallest un-seen
  // streak milestone celebration regardless of the actual streak count.
  // Self-clears after the celebration is dismissed so QA gets a single
  // forced fire per toggle. See #419.
  forceNextStreakMilestone: boolean;
  // When true, all cards are treated as graduated (learning phase bypassed).
  // isInLearningPhase returns false for every card, so typed-entry mode kicks
  // in immediately for name cards. Use to QA the typed-entry surface without
  // grinding through learning steps. See #1270.
  forceCardsGraduated: boolean;
};

export const DEFAULT_FLAGS: SuperuserFlags = {
  pretendAllMastered: false,
  forceNextStreakMilestone: false,
  forceCardsGraduated: false,
};

export function isUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(UNLOCKED_KEY) === "true";
}

export function setUnlocked(value: boolean): void {
  if (value) localStorage.setItem(UNLOCKED_KEY, "true");
  else localStorage.removeItem(UNLOCKED_KEY);
}

export function loadFlags(): SuperuserFlags {
  if (typeof window === "undefined") return DEFAULT_FLAGS;
  try {
    const raw = localStorage.getItem(FLAGS_KEY);
    if (!raw) return DEFAULT_FLAGS;
    const parsed = JSON.parse(raw) as Partial<SuperuserFlags> | null;
    return {
      pretendAllMastered: parsed?.pretendAllMastered === true,
      forceNextStreakMilestone: parsed?.forceNextStreakMilestone === true,
      forceCardsGraduated: parsed?.forceCardsGraduated === true,
    };
  } catch {
    return DEFAULT_FLAGS;
  }
}

export function saveFlags(flags: SuperuserFlags): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
}

export function clearFlags(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(FLAGS_KEY);
}

export function anyFlagTrue(flags: SuperuserFlags): boolean {
  return (Object.values(flags) as boolean[]).some((v) => v === true);
}

// Synchronous read for non-React contexts (e.g. unload-time beacon handlers
// where the React tree may already be tearing down).
export function isAnyFlagOn(): boolean {
  if (typeof window === "undefined") return false;
  return anyFlagTrue(loadFlags());
}

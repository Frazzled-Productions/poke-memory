import type { Locator, Page } from "@playwright/test";

/**
 * Locator for "the Practice page has presented an interactable first card, or
 * a legitimate end-state".
 *
 * The first card a fresh guest session presents is chosen by a deterministic
 * per-(user, day) shuffle (`stableShuffleForDay` in `lib/review/session.ts`),
 * so on some calendar days it is a flip name card (Reveal button) and on other
 * days it is a reverse / sprite-picker or multiple-choice card. A locator that
 * only matches the Reveal button times out on the days the shuffle leads with a
 * reverse card, which is a date-dependent failure, NOT a hydration/perf
 * timeout (the card renders promptly; the assertion just cannot match it).
 *
 * This locator therefore matches every legitimate first-card surface:
 *
 *  - Reveal button: flip name / evolution / reverse-evolution cards.
 *  - "Which Pokemon is X?" group: the SpritePicker (reverse name card).
 *  - "Choose the Pokemon name" group: the MultipleChoiceNameCard (verified
 *    typed-entry learning phase).
 *  - An end-state heading: All caught up / Daily review limit reached / etc.
 *
 * Use this everywhere a test means "the Practice surface is ready and
 * interactable" so a calendar roll cannot reintroduce the flake.
 */
export function practiceReadyLocator(page: Page): Locator {
  const reveal = page.getByRole("button", { name: /^reveal$/i });
  const spritePicker = page.getByRole("group", { name: /Which Pok[eé]mon is .+\?/ });
  const multipleChoice = page.getByRole("group", { name: "Choose the Pokémon name" });
  const endState = page.getByRole("heading", {
    name: /All caught up|Daily review limit reached|New cards locked|Next card in|No card types enabled/,
  });
  return reveal.or(spritePicker).or(multipleChoice).or(endState);
}

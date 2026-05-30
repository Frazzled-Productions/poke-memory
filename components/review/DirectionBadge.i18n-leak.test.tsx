/**
 * DirectionBadge.i18n-leak.test.tsx
 *
 * English-leak harness validation for DirectionBadge (#1405).
 *
 * This test renders DirectionBadge under the "xx-pseudo" locale, where every
 * message-catalogue string is wrapped in sentinel brackets ("[...]").  Any
 * visible text node that is NOT bracket-wrapped and NOT on the allowlist is an
 * untranslated English string -- a hard-coded label that bypasses the catalogue.
 *
 * PURPOSE: validate that the harness itself works end-to-end.  DirectionBadge
 * currently hard-codes its labels (it predates i18n) so this test acts as a
 * CANARY: it must fail when DirectionBadge uses hard-coded English AND pass once
 * the labels are moved into the catalogue (that sweep is #1434).
 *
 * For PR1 (gate infrastructure), the test is written to PASS against the
 * wide allowlist in scripts/i18n-leak-allowlist.ts, which allowlists Title-Case
 * words broadly to keep the baseline green.  When #1434 narrows the allowlist,
 * DirectionBadge's labels will need to be translated for this to continue to
 * pass.
 *
 * PATTERN to copy for other components:
 *   1. Import renderPseudo from the test-utils helper.
 *   2. Render the component with the pseudo locale.
 *   3. Collect all text content from the container.
 *   4. Strip sentinel-wrapped values (they are translated).
 *   5. Strip allowlist matches (they are legitimately untranslated).
 *   6. Assert the remainder is empty -- any remaining text is an i18n leak.
 */

import { describe, it, expect } from "vitest";
import { renderPseudo } from "@/components/test-utils/renderWithIntl";
import { isAllowlisted } from "@/scripts/i18n-leak-allowlist";
import { DirectionBadge, type CardDirection } from "@/components/review/DirectionBadge";

// Sentinel pattern: strings wrapped in "[...]" came from the catalogue.
// The /s (dotAll) flag is not used to stay compatible with es2017 targets;
// multi-line text nodes are rare in DOM text content after trimming.
const SENTINEL_RE = /^\[[\s\S]*\]$/;

/**
 * Collect all non-empty text nodes in a rendered container.
 * Walks the DOM recursively so it catches text in nested elements.
 */
function collectTextNodes(container: HTMLElement): string[] {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
  );
  const texts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const text = (node.textContent ?? "").trim();
    if (text !== "") texts.push(text);
  }
  return texts;
}

/**
 * Given a list of text nodes from a pseudo-locale render, return the subset
 * that are neither sentinel-wrapped nor allowlisted -- i.e. untranslated
 * English strings that should be in the catalogue.
 */
function findLeaks(texts: string[]): string[] {
  return texts.filter((t) => !SENTINEL_RE.test(t) && !isAllowlisted(t));
}

const ALL_DIRECTIONS: CardDirection[] = [
  "name",
  "evolution",
  "reverse-evolution",
  "reverse",
  "cry",
];

describe("DirectionBadge -- i18n-leak harness validation", () => {
  it("harness is exercised: at least one text node is rendered for each direction", () => {
    for (const direction of ALL_DIRECTIONS) {
      const { container } = renderPseudo(
        <DirectionBadge direction={direction} />,
      );
      const texts = collectTextNodes(container as HTMLElement);
      expect(
        texts.length,
        `Expected at least one text node for direction="${direction}"`,
      ).toBeGreaterThan(0);
    }
  });

  it("all visible text is either sentinel-wrapped or allowlisted (no i18n leaks)", () => {
    for (const direction of ALL_DIRECTIONS) {
      const { container } = renderPseudo(
        <DirectionBadge direction={direction} />,
      );
      const texts = collectTextNodes(container as HTMLElement);
      const leaks = findLeaks(texts);
      expect(
        leaks,
        `Untranslated text found for direction="${direction}": ${JSON.stringify(leaks)}\n` +
          `All text nodes: ${JSON.stringify(texts)}\n` +
          `Fix: move the hard-coded string into messages/en.json and render via useTranslations().`,
      ).toEqual([]);
    }
  });
});

/**
 * i18n-leak test for QueueCounterRow.
 *
 * Renders the component under the pseudo-locale and asserts that every visible
 * text node is either sentinel-bracketed (from the catalogue) or on the
 * allowlist. Any unwrapped English string is an untranslated hard-code.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderPseudo, screen } from "@/components/test-utils/renderWithIntl";
import { isAllowlisted } from "@/scripts/i18n-leak-allowlist";
import { QueueCounterRow } from "./QueueCounterRow";

const SENTINEL_RE = /^\[[\s\S]*\]$/;

function collectLeaks(container: HTMLElement): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const leaks: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = (node.textContent ?? "").trim();
    if (text && !SENTINEL_RE.test(text) && !isAllowlisted(text)) {
      leaks.push(text);
    }
    node = walker.nextNode();
  }
  return leaks;
}

describe("QueueCounterRow - i18n leak", () => {
  it("has no untranslated English strings when rendered under pseudo-locale", () => {
    const { container } = renderPseudo(
      <QueueCounterRow newCount={3} learningCount={5} reviewCount={10} />,
    );
    expect(collectLeaks(container)).toEqual([]);
  });
});

/**
 * i18n-leak test for PracticeSidebar.
 *
 * Renders both the empty (zero grades) and populated (non-zero grades) states
 * under the pseudo-locale. Any visible text not sentinel-wrapped or allowlisted
 * is an untranslated hard-coded English string.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderPseudo, screen, waitFor } from "@/components/test-utils/renderWithIntl";
import { isAllowlisted } from "@/scripts/i18n-leak-allowlist";
import { PracticeSidebar } from "./PracticeSidebar";

const SENTINEL_RE = /^\[[\s\S]*\]$/;

vi.mock("@/lib/gradelog/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gradelog/persistence")>();
  return { ...actual, loadGradeLog: vi.fn() };
});

vi.mock("@/lib/review/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review/session")>();
  return { ...actual, todayString: () => "2026-01-15" };
});

import { loadGradeLog } from "@/lib/gradelog/persistence";
const mockLoadGradeLog = loadGradeLog as ReturnType<typeof vi.fn>;

function makeEntry(grade: 1 | 2 | 4 | 5) {
  return {
    date: "2026-01-15",
    grade,
    cardType: "name" as const,
    occurredAt: Date.now(),
    subjectKey: String(grade),
  };
}

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

describe("PracticeSidebar - i18n leak (empty state)", () => {
  beforeEach(() => {
    mockLoadGradeLog.mockResolvedValue([]);
  });

  it("has no untranslated strings in the zero-grades state", async () => {
    const { container } = renderPseudo(<PracticeSidebar />);
    await waitFor(() => {
      expect(screen.queryByText(/\[No cards reviewed/)).toBeInTheDocument();
    });
    expect(collectLeaks(container)).toEqual([]);
  });
});

describe("PracticeSidebar - i18n leak (populated state)", () => {
  beforeEach(() => {
    mockLoadGradeLog.mockResolvedValue([
      makeEntry(4),
      makeEntry(5),
      makeEntry(1),
      makeEntry(2),
    ]);
  });

  it("has no untranslated strings when grades are present", async () => {
    const { container } = renderPseudo(<PracticeSidebar />);
    await waitFor(() => {
      expect(screen.queryByText(/\[Cards reviewed\]/)).toBeInTheDocument();
    });
    expect(collectLeaks(container)).toEqual([]);
  });
});

/**
 * Component tests for ChildFriendlySummary (#1544).
 *
 * ChildFriendlySummary is an async server component that calls
 * `getTranslations("privacy.childFriendlySummary")` from next-intl/server.
 * In jsdom we stub `next-intl/server` so getTranslations returns a function
 * backed by the real message catalogues (same approach as Nav.test.tsx).
 *
 * Covers:
 *   1. English: heading and at least one list item render with translated text.
 *   2. Japanese: heading renders in Japanese (non-English locale is translated).
 *   3. Simplified Chinese: heading renders in Simplified Chinese.
 *   4. Traditional Chinese: heading renders in Traditional Chinese.
 *   5. Both Settings links are present in the English render.
 *   6. <strong> labels are rendered (bold intro text preserved via t.rich).
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Load all four catalogues synchronously for locale-switching.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const enMessages = require("../../messages/en.json") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jaMessages = require("../../messages/ja.json") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zhHansMessages = require("../../messages/zh-Hans.json") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zhHantMessages = require("../../messages/zh-Hant.json") as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a dotted namespace path (e.g. "privacy.childFriendlySummary")
 * against a messages object and returns the nested section.
 */
function resolveNamespace(
  messages: Record<string, unknown>,
  namespace: string,
): Record<string, string> {
  const parts = namespace.split(".");
  let node: unknown = messages;
  for (const part of parts) {
    if (typeof node !== "object" || node === null) return {};
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "object" || node === null) return {};
  return node as Record<string, string>;
}

/**
 * Builds a mock `t` function backed by the given namespace section.
 *
 * - `t(key)` returns the raw ICU string with tag syntax stripped.
 * - `t.rich(key, tags)` strips the tag wrappers from the ICU string and
 *   calls the matching tag callback with the inner text, then assembles the
 *   resulting React nodes. This is intentionally simple — it gives tests
 *   enough signal to assert on key visible text and rendered elements
 *   without a full ICU parser.
 */
function buildT(ns: Record<string, string>) {
  // Remove the specific named ICU tokens used in the privacy.childFriendlySummary
  // catalogue: <s>, </s>, <export>, </export>, <reset>, </reset>.
  // A general HTML-tag-stripping regex is intentionally avoided here — we only
  // need to handle our own catalogue tokens, and the named-token approach does
  // not constitute an incomplete sanitizer under CodeQL's
  // js/incomplete-multi-character-sanitization rule.
  function stripCatalogueTokens(raw: string): string {
    return raw
      .replaceAll("<s>", "")
      .replaceAll("</s>", "")
      .replaceAll("<export>", "")
      .replaceAll("</export>", "")
      .replaceAll("<reset>", "")
      .replaceAll("</reset>", "");
  }

  function t(key: string): string {
    return stripCatalogueTokens(ns[key] ?? key);
  }

  // t.rich: parse the ICU string for named tags and invoke callbacks.
  // Returns an array of React nodes assembled in source order.
  t.rich = function (
    key: string,
    tags: Record<string, (chunks: React.ReactNode) => React.ReactNode>,
  ): React.ReactNode {
    const raw = ns[key] ?? key;
    // Split the string on tag boundaries, preserving structure.
    const parts: React.ReactNode[] = [];
    const tagRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tagRe.exec(raw)) !== null) {
      // Text before this tag.
      if (match.index > lastIndex) {
        parts.push(raw.slice(lastIndex, match.index));
      }
      const tagName = match[1];
      const inner = match[2];
      const callback = tags[tagName];
      if (callback) {
        parts.push(callback(inner));
      } else {
        parts.push(inner);
      }
      lastIndex = tagRe.lastIndex;
    }
    // Trailing text.
    if (lastIndex < raw.length) {
      parts.push(raw.slice(lastIndex));
    }
    return parts;
  };

  return t;
}

// ---------------------------------------------------------------------------
// Mock next-intl/server
// ---------------------------------------------------------------------------

vi.mock("next-intl/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl/server")>();
  return {
    ...actual,
    getTranslations: vi.fn(async (namespace: string) => {
      const ns = resolveNamespace(enMessages, namespace);
      return buildT(ns);
    }),
    setRequestLocale: vi.fn(),
    getMessages: vi.fn(async () => enMessages),
  };
});

// Mock next/link as a plain anchor in jsdom.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks.
// ---------------------------------------------------------------------------

import * as nextIntlServer from "next-intl/server";
import ChildFriendlySummary from "./ChildFriendlySummary";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function switchLocale(messages: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(nextIntlServer.getTranslations as any).mockImplementation(
    async (namespace: string) => {
      const ns = resolveNamespace(messages, namespace);
      return buildT(ns);
    },
  );
}

describe("ChildFriendlySummary", () => {
  beforeEach(() => {
    // Reset to English before each test.
    switchLocale(enMessages);
  });

  it("renders the section heading in English", async () => {
    render(await ChildFriendlySummary());
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /in plain language/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders bold intro labels via t.rich (strong tag preserved)", async () => {
    render(await ChildFriendlySummary());
    // The first list item's bold label.
    const bold = screen.getByText(/just playing/i);
    expect(bold.tagName.toLowerCase()).toBe("strong");
  });

  it("renders both Settings page links", async () => {
    render(await ChildFriendlySummary());
    const exportLink = screen.getByRole("link", { name: /export your progress/i });
    expect(exportLink).toHaveAttribute("href", "/settings#backup-heading");

    const resetLink = screen.getByRole("link", { name: /reset all progress/i });
    expect(resetLink).toHaveAttribute("href", "/settings#danger-zone-heading");
  });

  it("renders the list with five items", async () => {
    render(await ChildFriendlySummary());
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
  });

  describe("Japanese locale", () => {
    it("renders the heading in Japanese (not English)", async () => {
      switchLocale(jaMessages);
      render(await ChildFriendlySummary());
      // Japanese heading: ポケモリーはあなたのデータをどう扱う?
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        "ポケモリーはあなたのデータをどう扱う?",
      );
      // English heading must not appear.
      expect(screen.queryByText(/in plain language/i)).toBeNull();
    });

    it("renders the first item with a Japanese bold label", async () => {
      switchLocale(jaMessages);
      render(await ChildFriendlySummary());
      const bold = screen.getByText(/サインインせずに遊ぶ場合/);
      expect(bold.tagName.toLowerCase()).toBe("strong");
    });
  });

  describe("Simplified Chinese locale", () => {
    it("renders the heading in Simplified Chinese (not English)", async () => {
      switchLocale(zhHansMessages);
      render(await ChildFriendlySummary());
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        "用简单的话说",
      );
      expect(screen.queryByText(/in plain language/i)).toBeNull();
    });

    it("renders the first item with a Simplified Chinese bold label", async () => {
      switchLocale(zhHansMessages);
      render(await ChildFriendlySummary());
      const bold = screen.getByText(/仅游玩（无需登录）/);
      expect(bold.tagName.toLowerCase()).toBe("strong");
    });
  });

  describe("Traditional Chinese locale", () => {
    it("renders the heading in Traditional Chinese (not English)", async () => {
      switchLocale(zhHantMessages);
      render(await ChildFriendlySummary());
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        "用簡單的話說",
      );
      expect(screen.queryByText(/in plain language/i)).toBeNull();
    });

    it("renders the first item with a Traditional Chinese bold label", async () => {
      switchLocale(zhHantMessages);
      render(await ChildFriendlySummary());
      const bold = screen.getByText(/僅遊玩（無需登入）/);
      expect(bold.tagName.toLowerCase()).toBe("strong");
    });
  });
});

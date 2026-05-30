/**
 * Locale tests for ScopeControl — type pill names (#1389).
 *
 * Verifies that the type-filter pill labels localise correctly when the
 * app locale changes. The ScopeControl panel starts closed; tests click
 * the "Scope" toggle to open it before querying type pills.
 *
 * Covers all four supported locales (en / ja / zh-Hans / zh-Hant).
 */

import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithIntl,
  screen,
} from "@/components/test-utils/renderWithIntl";
import { ScopeControl } from "@/components/review/ScopeControl";
import { EMPTY_SCOPE } from "@/lib/review/scope";

// ---------------------------------------------------------------------------
// Helper — render ScopeControl and open the scope panel
// ---------------------------------------------------------------------------

/** Label for the scope toggle button per locale. */
const SCOPE_LABEL_PATTERN: Record<"en" | "ja" | "zh-Hans" | "zh-Hant", RegExp> = {
  en: /scope/i,
  ja: /スコープ/,
  "zh-Hans": /范围/,
  "zh-Hant": /範圍/,
};

async function renderAndOpen(locale: "en" | "ja" | "zh-Hans" | "zh-Hant" = "en") {
  const user = userEvent.setup();
  renderWithIntl(
    <ScopeControl scope={EMPTY_SCOPE} onChange={vi.fn()} />,
    { locale },
  );
  // The scope panel is initially closed. Click the locale-appropriate toggle to open it.
  const toggleBtn = screen.getByRole("button", { name: SCOPE_LABEL_PATTERN[locale] });
  await user.click(toggleBtn);
  return user;
}

// ---------------------------------------------------------------------------
// English — baseline
// ---------------------------------------------------------------------------

describe("ScopeControl — type pills in English locale", () => {
  it("renders the Fire pill as 'Fire'", async () => {
    await renderAndOpen("en");
    // The type section contains pills with localised names.
    // In English the fire pill is labelled "Fire" (aria-label and text).
    expect(screen.getByRole("button", { name: "Fire" })).toBeInTheDocument();
  });

  it("renders the Water pill as 'Water'", async () => {
    await renderAndOpen("en");
    expect(screen.getByRole("button", { name: "Water" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// English — scope section legends
// ---------------------------------------------------------------------------

describe("ScopeControl — scope section legends in English locale (#1393)", () => {
  it("renders the Generation section legend as 'Generation'", async () => {
    await renderAndOpen("en");
    // practice.scope.generation = "Generation"
    expect(screen.getByText("Generation")).toBeInTheDocument();
  });

  it("renders the Type section legend as 'Type'", async () => {
    await renderAndOpen("en");
    expect(screen.getByText("Type")).toBeInTheDocument();
  });

  it("renders the Groups section legend as 'Groups'", async () => {
    await renderAndOpen("en");
    expect(screen.getByText("Groups")).toBeInTheDocument();
  });

  it("renders the Games section legend as 'Games'", async () => {
    await renderAndOpen("en");
    expect(screen.getByText("Games")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Japanese
// ---------------------------------------------------------------------------

describe("ScopeControl — type pills in Japanese locale", () => {
  it("renders the Fire pill as ほのお", async () => {
    await renderAndOpen("ja");
    // messages/ja.json types.fire = "ほのお"
    expect(screen.getByRole("button", { name: "ほのお" })).toBeInTheDocument();
  });

  it("renders the Psychic pill as エスパー", async () => {
    await renderAndOpen("ja");
    // messages/ja.json types.psychic = "エスパー"
    expect(screen.getByRole("button", { name: "エスパー" })).toBeInTheDocument();
  });
});

describe("ScopeControl — scope section legends in Japanese locale (#1393)", () => {
  it("renders the Japanese Scope label in ja locale", async () => {
    await renderAndOpen("ja");
    // ja practice.scope.label = "スコープ"
    expect(screen.getAllByText("スコープ").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Japanese Generation legend in ja locale", async () => {
    await renderAndOpen("ja");
    // ja practice.scope.generation = "世代"
    expect(screen.getByText("世代")).toBeInTheDocument();
  });

  it("renders the Japanese Groups legend in ja locale", async () => {
    await renderAndOpen("ja");
    // ja practice.scope.groups = "グループ"
    expect(screen.getByText("グループ")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Simplified Chinese
// ---------------------------------------------------------------------------

describe("ScopeControl — type pills in Simplified Chinese locale", () => {
  it("renders the Steel pill as 钢", async () => {
    await renderAndOpen("zh-Hans");
    // messages/zh-Hans.json types.steel = "钢"
    expect(screen.getByRole("button", { name: "钢" })).toBeInTheDocument();
  });
});

describe("ScopeControl — scope section legends in Simplified Chinese locale (#1393)", () => {
  it("renders the zh-Hans Generation legend", async () => {
    await renderAndOpen("zh-Hans");
    // messages/zh-Hans.json practice.scope.generation = "世代"
    expect(screen.getByText("世代")).toBeInTheDocument();
  });

  it("renders the zh-Hans Groups legend", async () => {
    await renderAndOpen("zh-Hans");
    // messages/zh-Hans.json practice.scope.groups = "分组"
    expect(screen.getByText("分组")).toBeInTheDocument();
  });

  it("renders the zh-Hans Games legend", async () => {
    await renderAndOpen("zh-Hans");
    // messages/zh-Hans.json practice.scope.games = "游戏"
    expect(screen.getByText("游戏")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Traditional Chinese
// ---------------------------------------------------------------------------

describe("ScopeControl — type pills in Traditional Chinese locale", () => {
  it("renders the Ghost pill as 幽靈", async () => {
    await renderAndOpen("zh-Hant");
    // messages/zh-Hant.json types.ghost = "幽靈"
    expect(screen.getByRole("button", { name: "幽靈" })).toBeInTheDocument();
  });
});

describe("ScopeControl — scope section legends in Traditional Chinese locale (#1393)", () => {
  it("renders the zh-Hant Generation legend", async () => {
    await renderAndOpen("zh-Hant");
    // messages/zh-Hant.json practice.scope.generation = "世代"
    expect(screen.getByText("世代")).toBeInTheDocument();
  });

  it("renders the zh-Hant Groups legend", async () => {
    await renderAndOpen("zh-Hant");
    // messages/zh-Hant.json practice.scope.groups = "分組"
    expect(screen.getByText("分組")).toBeInTheDocument();
  });

  it("renders the zh-Hant Games legend", async () => {
    await renderAndOpen("zh-Hant");
    // messages/zh-Hant.json practice.scope.games = "遊戲"
    expect(screen.getByText("遊戲")).toBeInTheDocument();
  });
});

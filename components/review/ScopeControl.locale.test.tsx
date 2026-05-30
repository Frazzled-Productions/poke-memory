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
  renderJa,
  screen,
} from "@/components/test-utils/renderWithIntl";
import { ScopeControl } from "@/components/review/ScopeControl";
import { EMPTY_SCOPE } from "@/lib/review/scope";

// ---------------------------------------------------------------------------
// Helper — render ScopeControl and open the scope panel
// ---------------------------------------------------------------------------

async function renderAndOpen(locale: "en" | "ja" | "zh-Hans" | "zh-Hant" = "en") {
  const user = userEvent.setup();
  if (locale === "ja") {
    renderJa(
      <ScopeControl scope={EMPTY_SCOPE} onChange={vi.fn()} />,
    );
  } else {
    renderWithIntl(
      <ScopeControl scope={EMPTY_SCOPE} onChange={vi.fn()} />,
      { locale },
    );
  }
  // The scope panel is initially closed. Click the "Scope" toggle to open it.
  const toggleBtn = screen.getByRole("button", { name: /scope/i });
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

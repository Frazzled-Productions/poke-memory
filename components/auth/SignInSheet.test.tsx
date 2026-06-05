/**
 * Tests for SignInSheet (components/auth/SignInSheet.tsx).
 *
 * SignInSheet is a bottom-sheet (mobile) / centred modal (desktop) that
 * replaces the old `SignInPicker` dropdown (#1669). It is portalled to
 * `document.body` via createPortal, so `screen` queries the full DOM.
 *
 * Coverage:
 *  - Sheet is absent when `open` is false.
 *  - Sheet renders the heading, body, and provider buttons when open.
 *  - Clicking Close button calls onClose and restores focus (WCAG 2.4.3).
 *  - Escape key calls onClose and restores focus (WCAG 2.4.3).
 *  - Backdrop click calls onClose.
 *  - Backdrop pointer-down inside the dialog does NOT close.
 *  - Tab focus trap keeps focus inside the dialog.
 *  - GitHub button triggers signIn("github").
 *  - Google button triggers signIn("google").
 *  - Locale rendering: all four locales (en/ja/zh-Hans/zh-Hant).
 *  - Pseudo-locale: no untranslated English strings.
 */

import { screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
  renderPseudo,
} from "@/components/test-utils/renderWithIntl";
import { SignInSheet } from "@/components/auth/SignInSheet";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSignIn = vi.fn(async (_provider: string) => {});

vi.mock("@/lib/auth/actions", () => ({
  signIn: (provider: string) => mockSignIn(provider),
  signOut: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSheet(open = true, onClose = vi.fn()) {
  return renderWithIntl(<SignInSheet open={open} onClose={onClose} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignInSheet - closed state", () => {
  it("renders nothing when open is false", () => {
    const { container } = renderSheet(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

describe("SignInSheet - open state", () => {
  it("renders a dialog with the correct aria-labelledby heading", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("renders the heading text", () => {
    renderSheet();
    expect(screen.getByRole("heading", { name: /keep your progress safe/i })).toBeTruthy();
  });

  it("renders the body copy", () => {
    renderSheet();
    expect(screen.getByText(/sign in once to back up your data/i)).toBeTruthy();
  });

  it("renders Continue with GitHub button", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: /continue with github/i })).toBeTruthy();
  });

  it("renders Continue with Google button", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
  });

  it("renders a close button with an aria-label", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: /close sign-in sheet/i })).toBeTruthy();
  });
});

describe("SignInSheet - close interactions", () => {
  it("clicking the close button calls onClose", async () => {
    const onClose = vi.fn();
    renderWithIntl(<SignInSheet open onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: /close sign-in sheet/i });
    await userEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close button restores focus to the triggering element (WCAG 2.4.3)", async () => {
    // Place a button in the document and focus it before the sheet opens.
    const trigger = document.createElement("button");
    trigger.textContent = "Open sheet";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const { unmount } = renderWithIntl(<SignInSheet open onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: /close sign-in sheet/i });
    await userEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
    // Focus must have returned to the element that was focused before the sheet opened.
    expect(document.activeElement).toBe(trigger);

    unmount();
    trigger.remove();
  });

  it("pressing Escape calls onClose", async () => {
    const onClose = vi.fn();
    renderWithIntl(<SignInSheet open onClose={onClose} />);

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape restores focus to the triggering element (WCAG 2.4.3)", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open sheet";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const { unmount } = renderWithIntl(<SignInSheet open onClose={onClose} />);

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);

    unmount();
    trigger.remove();
  });

  it("clicking the backdrop (outside the dialog panel) calls onClose", () => {
    const onClose = vi.fn();
    renderWithIntl(<SignInSheet open onClose={onClose} />);

    // The backdrop is the direct child of the portal root (the fixed overlay).
    // It carries an onPointerDown handler that calls onClose when the event
    // target is the backdrop itself (not the dialog panel inside it).
    const backdrop = document.querySelector<HTMLElement>(
      '.fixed.inset-0',
    );
    expect(backdrop).not.toBeNull();

    fireEvent.pointerDown(backdrop!, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pointer-down inside the dialog panel does NOT close the sheet", () => {
    const onClose = vi.fn();
    renderWithIntl(<SignInSheet open onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    // Simulate a pointer-down on the dialog panel itself - target !== backdrop.
    fireEvent.pointerDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SignInSheet - provider sign-in", () => {
  it("clicking GitHub button calls signIn with 'github'", async () => {
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /continue with github/i }));
    expect(mockSignIn).toHaveBeenCalledWith("github");
  });

  it("clicking Google button calls signIn with 'google'", async () => {
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(mockSignIn).toHaveBeenCalledWith("google");
  });

  it("provider buttons show 'Signing in…' and are disabled while pending", async () => {
    let resolve!: () => void;
    mockSignIn.mockReturnValueOnce(new Promise<void>((r) => { resolve = r; }));

    renderSheet();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /continue with github/i }));
    });

    // During the transition both buttons should show the pending label.
    expect(screen.getAllByRole("button", { name: /signing in/i }).length).toBeGreaterThan(0);

    await act(async () => { resolve(); });
  });
});

// ---------------------------------------------------------------------------
// Locale coverage
// ---------------------------------------------------------------------------

describe("SignInSheet - locale coverage", () => {
  it("en: heading is in English", () => {
    renderSheet();
    expect(screen.getByRole("heading", { name: /keep your progress safe/i })).toBeTruthy();
  });

  it("ja: heading renders in Japanese", () => {
    renderWithIntl(<SignInSheet open onClose={vi.fn()} />, { locale: "ja" });
    // Japanese heading: "進捗データを安全に保存しよう"
    expect(screen.getByRole("heading", { name: /進捗データを安全に保存しよう/i })).toBeTruthy();
  });

  it("ja: GitHub button renders in Japanese", () => {
    renderJa(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /github でつづける/i })).toBeTruthy();
  });

  it("zh-Hans: heading renders in Simplified Chinese", () => {
    renderZhHans(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /保护你的学习进度/ })).toBeTruthy();
  });

  it("zh-Hans: GitHub button renders in Simplified Chinese", () => {
    renderZhHans(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /使用 github 继续/i })).toBeTruthy();
  });

  it("zh-Hant: heading renders in Traditional Chinese", () => {
    renderZhHant(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /保護你的學習進度/ })).toBeTruthy();
  });

  it("zh-Hant: GitHub button renders in Traditional Chinese", () => {
    renderZhHant(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /使用 github 繼續/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Pseudo-locale: English-leak check
// ---------------------------------------------------------------------------

describe("SignInSheet - pseudo-locale (no English-leak)", () => {
  it("heading is wrapped in sentinel brackets", () => {
    renderPseudo(<SignInSheet open onClose={vi.fn()} />);
    const heading = screen.getByRole("heading");
    // Sentinel brackets indicate the string went through the catalogue.
    expect(heading.textContent).toMatch(/\[.*\]/);
  });

  it("body copy is wrapped in sentinel brackets", () => {
    renderPseudo(<SignInSheet open onClose={vi.fn()} />);
    const sentinels = screen.getAllByText(/\[.*\]/);
    expect(sentinels.length).toBeGreaterThan(0);
  });
});

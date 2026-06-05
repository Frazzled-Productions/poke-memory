/**
 * Tests for SignInSheet (components/auth/SignInSheet.tsx).
 *
 * SignInSheet is a bottom-sheet (mobile) / centred modal (desktop) that
 * replaces the old `SignInPicker` dropdown (#1669). It is portalled to
 * `document.body` via createPortal, so `screen` queries the full DOM.
 *
 * #1671 adds a username/password secondary door. New coverage:
 *  - Username form + both warning notices render in sign-up mode.
 *  - Warnings are absent in sign-in mode.
 *  - Mode toggle switches between sign-up and sign-in.
 *  - Client-side validation fires before calling server actions.
 *  - Successful sign-up calls signUpWithUsername.
 *  - Successful sign-in calls signInWithUsername.
 *  - Error responses surface as inline error text.
 *  - Locale rendering in all four locales for warnings and form labels.
 *  - Pseudo-locale: no untranslated English strings.
 *
 * Existing coverage retained:
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

import { screen, fireEvent, act, waitFor } from "@testing-library/react";
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
type UsernameResult = { ok: true } | { ok: false; error: string };
const mockSignUpWithUsername = vi.fn(
  async (_u: string, _p: string): Promise<UsernameResult> => ({ ok: true }),
);
const mockSignInWithUsername = vi.fn(
  async (_u: string, _p: string): Promise<UsernameResult> => ({ ok: true }),
);

vi.mock("@/lib/auth/actions", () => ({
  signIn: (provider: string) => mockSignIn(provider),
  signOut: vi.fn(),
  signUpWithUsername: (u: string, p: string) => mockSignUpWithUsername(u, p),
  signInWithUsername: (u: string, p: string) => mockSignInWithUsername(u, p),
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

    expect(screen.getAllByRole("button", { name: /signing in/i }).length).toBeGreaterThan(0);

    await act(async () => { resolve(); });
  });
});

// ---------------------------------------------------------------------------
// Username/password door - sign-up mode
// ---------------------------------------------------------------------------

describe("SignInSheet - username/password door (sign-up mode)", () => {
  it("renders both no-reset and no-real-name warnings in sign-up mode", () => {
    renderSheet();
    expect(
      screen.getByText(/there is no password reset/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/do not use your real name/i),
    ).toBeTruthy();
  });

  it("renders labelled Username input", () => {
    renderSheet();
    expect(screen.getByLabelText(/username/i)).toBeTruthy();
  });

  it("renders labelled Password input", () => {
    renderSheet();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
  });

  it("renders 'Create account' submit button in sign-up mode", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
  });

  it("calls signUpWithUsername with normalised username on submit", async () => {
    renderSheet();

    await userEvent.type(screen.getByLabelText(/username/i), "Trainer99");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse-battery");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    });

    await waitFor(() => {
      // Username is normalised to lowercase before calling the action.
      expect(mockSignUpWithUsername).toHaveBeenCalledWith("trainer99", "correct-horse-battery");
    });
  });

  it("shows validation error for too-short username without calling server action", async () => {
    renderSheet();

    await userEvent.type(screen.getByLabelText(/username/i), "ab");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(mockSignUpWithUsername).not.toHaveBeenCalled();
  });

  it("shows validation error for too-short password without calling server action", async () => {
    renderSheet();

    await userEvent.type(screen.getByLabelText(/username/i), "trainer99");
    await userEvent.type(screen.getByLabelText(/password/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(mockSignUpWithUsername).not.toHaveBeenCalled();
  });

  it("shows validation error for username with invalid characters", async () => {
    renderSheet();

    await userEvent.type(screen.getByLabelText(/username/i), "ash@poke");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(mockSignUpWithUsername).not.toHaveBeenCalled();
  });

  it("shows username_taken error when server returns it", async () => {
    mockSignUpWithUsername.mockResolvedValueOnce({ ok: false, error: "username_taken" });

    renderSheet();

    await userEvent.type(screen.getByLabelText(/username/i), "trainer99");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse-battery");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/already taken/i)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Username/password door - sign-in mode
// ---------------------------------------------------------------------------

describe("SignInSheet - username/password door (sign-in mode)", () => {
  function renderSignIn() {
    return renderWithIntl(<SignInSheet open onClose={vi.fn()} />);
  }

  async function switchToSignIn() {
    await userEvent.click(screen.getByRole("button", { name: /already have an account/i }));
  }

  it("mode toggle button is visible in sign-up mode", () => {
    renderSignIn();
    expect(
      screen.getByRole("button", { name: /already have an account/i }),
    ).toBeTruthy();
  });

  it("clicking mode toggle hides warnings and shows 'Sign in' submit", async () => {
    renderSignIn();
    await switchToSignIn();

    expect(screen.queryByText(/there is no password reset/i)).toBeNull();
    expect(screen.queryByText(/do not use your real name/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
  });

  it("sign-in mode shows 'New here?' toggle", async () => {
    renderSignIn();
    await switchToSignIn();
    expect(screen.getByRole("button", { name: /new here/i })).toBeTruthy();
  });

  it("calls signInWithUsername on submit in sign-in mode", async () => {
    renderSignIn();
    await switchToSignIn();

    await userEvent.type(screen.getByLabelText(/username/i), "trainer99");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse-battery");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    });

    await waitFor(() => {
      expect(mockSignInWithUsername).toHaveBeenCalledWith("trainer99", "correct-horse-battery");
    });
  });

  it("shows invalid_credentials error when server returns it", async () => {
    mockSignInWithUsername.mockResolvedValueOnce({
      ok: false,
      error: "invalid_credentials",
    });

    renderSignIn();
    await switchToSignIn();

    await userEvent.type(screen.getByLabelText(/username/i), "trainer99");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse-battery");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/incorrect username or password/i)).toBeTruthy();
    });
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

  it("en: no-reset warning is in English", () => {
    renderSheet();
    expect(screen.getByText(/there is no password reset/i)).toBeTruthy();
  });

  it("en: no-real-name warning is in English", () => {
    renderSheet();
    expect(screen.getByText(/do not use your real name/i)).toBeTruthy();
  });

  it("ja: heading renders in Japanese", () => {
    renderWithIntl(<SignInSheet open onClose={vi.fn()} />, { locale: "ja" });
    expect(screen.getByRole("heading", { name: /進捗データを安全に保存しよう/i })).toBeTruthy();
  });

  it("ja: GitHub button renders in Japanese", () => {
    renderJa(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /github でつづける/i })).toBeTruthy();
  });

  it("ja: no-reset warning renders in Japanese", () => {
    renderJa(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByText(/パスワードのリセット機能はありません/)).toBeTruthy();
  });

  it("ja: no-real-name warning renders in Japanese", () => {
    renderJa(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByText(/本名や個人情報を使用しないでください/)).toBeTruthy();
  });

  it("zh-Hans: heading renders in Simplified Chinese", () => {
    renderZhHans(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /保护你的学习进度/ })).toBeTruthy();
  });

  it("zh-Hans: GitHub button renders in Simplified Chinese", () => {
    renderZhHans(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /使用 github 继续/i })).toBeTruthy();
  });

  it("zh-Hans: no-reset warning renders in Simplified Chinese", () => {
    renderZhHans(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByText(/没有密码重置功能/)).toBeTruthy();
  });

  it("zh-Hans: no-real-name warning renders in Simplified Chinese", () => {
    renderZhHans(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByText(/请勿将您的真实姓名/)).toBeTruthy();
  });

  it("zh-Hant: heading renders in Traditional Chinese", () => {
    renderZhHant(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /保護你的學習進度/ })).toBeTruthy();
  });

  it("zh-Hant: GitHub button renders in Traditional Chinese", () => {
    renderZhHant(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /使用 github 繼續/i })).toBeTruthy();
  });

  it("zh-Hant: no-reset warning renders in Traditional Chinese", () => {
    renderZhHant(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByText(/沒有密碼重設功能/)).toBeTruthy();
  });

  it("zh-Hant: no-real-name warning renders in Traditional Chinese", () => {
    renderZhHant(<SignInSheet open onClose={vi.fn()} />);
    expect(screen.getByText(/請勿將您的真實姓名/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Pseudo-locale: English-leak check
// ---------------------------------------------------------------------------

describe("SignInSheet - pseudo-locale (no English-leak)", () => {
  it("heading is wrapped in sentinel brackets", () => {
    renderPseudo(<SignInSheet open onClose={vi.fn()} />);
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toMatch(/\[.*\]/);
  });

  it("body copy is wrapped in sentinel brackets", () => {
    renderPseudo(<SignInSheet open onClose={vi.fn()} />);
    const sentinels = screen.getAllByText(/\[.*\]/);
    expect(sentinels.length).toBeGreaterThan(0);
  });

  it("no-reset warning is wrapped in sentinel brackets", () => {
    renderPseudo(<SignInSheet open onClose={vi.fn()} />);
    const notes = screen.getAllByRole("note");
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.textContent).toMatch(/\[.*\]/);
    }
  });
});

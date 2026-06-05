/**
 * Tests for AuthButton (components/auth/AuthButton.tsx).
 *
 * All tests run in the jsdom vitest project.
 * The auth context and server actions are stubbed so no real network or
 * Next.js Server Action infrastructure is exercised.
 *
 * Coverage:
 *  - Sign-in trigger button renders in guest state
 *  - Clicking trigger opens the SignInSheet dialog (#1669 - replaced the old
 *    SignInPicker dropdown)
 *  - Escape key closes the SignInSheet
 *  - signIn pending transition renders "Signing in…" and disables the button
 *  - signOut pending transition renders "Signing out…"
 *  - Signed-in: avatar rendered when avatar_url is set
 *  - Signed-in: display-name fallback chain (user_name → full_name → name → email → "User avatar")
 *  - Both GitHub and Google provider branches invoke signIn with the right provider
 *  - Japanese locale renders auth strings correctly (サインイン for Sign in)
 */

import { screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// next/image renders a real <img> in tests - no special optimisation needed.
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// Stub the server actions - they would call `redirect()` in a real environment.
const mockSignIn = vi.fn(async (_provider: string) => {});
const mockSignOut = vi.fn(async () => {});

vi.mock("@/lib/auth/actions", () => ({
  signIn: (provider: string) => mockSignIn(provider),
  signOut: () => mockSignOut(),
}));

// Stub the auth context so tests control the signed-in state independently.
const mockUseAuth = vi.fn();
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// Import the component under test AFTER all mocks are set up.
import { AuthButton } from "@/components/auth/AuthButton";

// ---------------------------------------------------------------------------
// Fake user factory
// ---------------------------------------------------------------------------

function makeUser(meta: Record<string, string | undefined> = {}): Partial<User> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    user_metadata: meta,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthButton - guest state (not signed in)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: guest, not loading.
    mockUseAuth.mockReturnValue({ user: null, loading: false });
  });

  it("renders the Sign in trigger button when no user is present", () => {
    renderWithIntl(<AuthButton />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("renders nothing while loading", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    const { container } = renderWithIntl(<AuthButton />);
    expect(container.firstChild).toBeNull();
  });

  // ── SignInSheet open / close (#1669) ────────────────────────────────────

  it("opens the SignInSheet dialog when the trigger is clicked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    const trigger = screen.getByRole("button", { name: /sign in/i });
    await user.click(trigger);

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes the SignInSheet when Escape is pressed", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns focus to the trigger after closing the SignInSheet with Escape", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    const trigger = screen.getByRole("button", { name: /sign in/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(trigger);
  });

  // ── Provider branch: GitHub ──────────────────────────────────────────────

  it("renders 'Continue with GitHub' inside the SignInSheet", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByRole("button", { name: /continue with github/i })).toBeTruthy();
  });

  it("calls signIn with 'github' when the GitHub option is chosen", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await user.click(screen.getByRole("button", { name: /continue with github/i }));

    expect(mockSignIn).toHaveBeenCalledWith("github");
  });

  // ── Provider branch: Google ──────────────────────────────────────────────

  it("renders 'Continue with Google' inside the SignInSheet", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
  });

  it("calls signIn with 'google' when the Google option is chosen", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    expect(mockSignIn).toHaveBeenCalledWith("google");
  });

  // ── Pending transition ───────────────────────────────────────────────────
  // The trigger button in AuthButton is no longer responsible for isPending -
  // that state is now inside SignInSheet (which manages its own useTransition).
  // SignInSheet.test.tsx covers the pending / disabled state of provider buttons.
  // AuthButton is responsible only for the sign-out pending state.

  it("trigger button is not disabled before any action is triggered", () => {
    renderWithIntl(<AuthButton />);
    const trigger = screen.getByRole("button", { name: /sign in/i });
    expect(trigger).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Signed-in state
// ---------------------------------------------------------------------------

describe("AuthButton - signed-in state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Sign out button when a user is present", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ user_name: "ash" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("does not render the Sign in trigger when signed in", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ user_name: "ash" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
  });

  it("calls signOut when the Sign out button is clicked", async () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ user_name: "ash" }),
      loading: false,
    });
    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("renders 'Signing out…' and disables the button while signOut is pending", async () => {
    // Hold the signOut promise open so isPending stays true during the check.
    let resolveSignOut!: () => void;
    mockSignOut.mockReturnValue(new Promise<void>((res) => { resolveSignOut = res; }));

    mockUseAuth.mockReturnValue({
      user: makeUser({ user_name: "ash" }),
      loading: false,
    });

    const user = userEvent.setup();
    renderWithIntl(<AuthButton />);

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /sign out/i }));
    });

    expect(screen.getByRole("button", { name: /signing out/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /signing out/i })).toBeDisabled();

    await act(async () => { resolveSignOut(); });
  });

  // ── Avatar rendering ─────────────────────────────────────────────────────

  it("renders an avatar img when avatar_url is set", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ avatar_url: "https://example.com/ash.png", user_name: "ash" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);

    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("https://example.com/ash.png");
  });

  it("does not render an avatar img when avatar_url is absent", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ user_name: "ash" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);

    expect(screen.queryByRole("img")).toBeNull();
  });

  // ── Display-name fallback chain ──────────────────────────────────────────

  it("uses user_name as the avatar alt when present", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ avatar_url: "https://example.com/avatar.png", user_name: "ash" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("ash");
  });

  it("falls back to full_name when user_name is absent", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ avatar_url: "https://example.com/avatar.png", full_name: "Ash Ketchum" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Ash Ketchum");
  });

  it("falls back to name when user_name and full_name are absent", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ avatar_url: "https://example.com/avatar.png", name: "Ash" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Ash");
  });

  it("falls back to email when user_name / full_name / name are absent", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ avatar_url: "https://example.com/avatar.png", email: "ash@pallet.town" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("ash@pallet.town");
  });

  it("uses 'User avatar' as the alt when all metadata fields are absent", () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ avatar_url: "https://example.com/avatar.png" }),
      loading: false,
    });
    renderWithIntl(<AuthButton />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("User avatar");
  });
});

// ---------------------------------------------------------------------------
// Japanese locale
// ---------------------------------------------------------------------------

describe("AuthButton - Japanese locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: null, loading: false });
  });

  it("renders the Sign in button label in Japanese (サインイン)", () => {
    renderJa(<AuthButton />);
    expect(screen.getByRole("button", { name: "サインイン" })).toBeInTheDocument();
  });
});

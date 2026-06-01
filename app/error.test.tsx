/**
 * Component tests for app/error.tsx (closes #1167, updated for #1369).
 *
 * Verifies that the offline-aware variant renders when navigator.onLine is
 * false, and the generic red-box variant renders when online.
 *
 * navigator.onLine is mocked via Object.defineProperty so each branch can be
 * exercised independently without real network state.
 *
 * Tests use renderWithIntl so the component's useTranslations() calls are
 * backed by real catalogue values.
 */

import { renderWithIntl, renderJa, renderZhHans, renderZhHant, screen, act } from "@/components/test-utils/renderWithIntl";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/link — no App Router context available in jsdom.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Mock clearLocalProgress — avoid real IndexedDB/localStorage I/O in tests.
// ---------------------------------------------------------------------------

vi.mock("@/lib/storage/reset", () => ({
  clearLocalProgress: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock useAuth — default to guest (user: null) so most tests exercise the
// guest path where the reset button is visible.
// ---------------------------------------------------------------------------

const mockUseAuth = vi.fn(() => ({ user: null, loading: false, supabase: null }));
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import ErrorPage from "@/app/error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

const fakeError = Object.assign(new Error("test error"), { digest: "abc123" });
const noop = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  // Restore to online so other tests aren't affected.
  setOnline(true);
  // Restore to guest so tests that check the reset button see it.
  mockUseAuth.mockReturnValue({ user: null, loading: false, supabase: null });
});

describe("Error page — online variant", () => {
  it("renders the generic red-box heading when online", () => {
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
  });

  it("renders the Try again button when online", () => {
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("renders the Go to Practice link when online", () => {
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    const link = screen.getByRole("link", { name: /go to practice/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });

  it("calls reset when Try again is clicked (online)", async () => {
    setOnline(true);
    const reset = vi.fn();
    renderWithIntl(<ErrorPage error={fakeError} reset={reset} />);

    screen.getByRole("button", { name: /try again/i }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("does not render the offline heading when online", () => {
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.queryByRole("heading", { name: /you're offline/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Error page — offline variant", () => {
  it("renders the offline heading when navigator.onLine is false", () => {
    setOnline(false);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("heading", { name: /you're offline/i }),
    ).toBeInTheDocument();
  });

  it("renders the offline body copy", () => {
    setOnline(false);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByText(/some pages aren't available without a connection/i),
    ).toBeInTheDocument();
  });

  it("renders a Try again button when offline", () => {
    setOnline(false);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("calls reset when Try again is clicked (offline)", () => {
    setOnline(false);
    const reset = vi.fn();
    renderWithIntl(<ErrorPage error={fakeError} reset={reset} />);

    screen.getByRole("button", { name: /try again/i }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("renders a Go to Practice link pointing to /", () => {
    setOnline(false);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    const link = screen.getByRole("link", { name: /go to practice/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });

  it("does not render the generic error heading when offline", () => {
    setOnline(false);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.queryByRole("heading", { name: /something went wrong/i }),
    ).not.toBeInTheDocument();
  });

  it("switches to the online variant when an online event fires", () => {
    setOnline(false);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("heading", { name: /you're offline/i }),
    ).toBeInTheDocument();

    // Simulate connectivity restored.
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /you're offline/i }),
    ).not.toBeInTheDocument();
  });

  it("switches to the offline variant when an offline event fires", () => {
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();

    // Simulate connectivity lost.
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(
      screen.getByRole("heading", { name: /you're offline/i }),
    ).toBeInTheDocument();
  });
});

describe("Error page — Japanese locale", () => {
  it("renders the error heading in Japanese", () => {
    setOnline(true);
    renderJa(<ErrorPage error={fakeError} reset={noop} />);

    // ja: error.heading = "エラーが発生しました"
    expect(
      screen.getByRole("heading", { name: /エラーが発生しました/ }),
    ).toBeInTheDocument();
  });

  it("renders the offline heading in Japanese", () => {
    setOnline(false);
    renderJa(<ErrorPage error={fakeError} reset={noop} />);

    // ja: error.offline.heading = "オフラインです"
    expect(
      screen.getByRole("heading", { name: /オフラインです/ }),
    ).toBeInTheDocument();
  });

  it("renders the Try again button label in Japanese", () => {
    setOnline(true);
    renderJa(<ErrorPage error={fakeError} reset={noop} />);

    // ja: error.tryAgain = "もう一度試す"
    expect(
      screen.getByRole("button", { name: /もう一度試す/ }),
    ).toBeInTheDocument();
  });

  it("renders the Go to Practice link label in Japanese", () => {
    setOnline(true);
    renderJa(<ErrorPage error={fakeError} reset={noop} />);

    // ja: error.goHome = "練習に戻る"
    expect(
      screen.getByRole("link", { name: /練習に戻る/ }),
    ).toBeInTheDocument();
  });

  it("renders the Reset local practice data button in Japanese", () => {
    setOnline(true);
    renderJa(<ErrorPage error={fakeError} reset={noop} />);

    // ja: error.resetLocalData = "ローカルの練習データをリセット"
    expect(
      screen.getByRole("button", { name: /ローカルの練習データをリセット/ }),
    ).toBeInTheDocument();
  });
});

describe("Error page — Simplified Chinese locale", () => {
  it("renders the error heading in Simplified Chinese", () => {
    setOnline(true);
    renderZhHans(<ErrorPage error={fakeError} reset={noop} />);

    // zh-Hans: error.heading = "发生错误"
    expect(
      screen.getByRole("heading", { name: /发生错误/ }),
    ).toBeInTheDocument();
  });

  it("renders the Reset local practice data button in Simplified Chinese", () => {
    setOnline(true);
    renderZhHans(<ErrorPage error={fakeError} reset={noop} />);

    // zh-Hans: error.resetLocalData = "重置本地练习数据"
    expect(
      screen.getByRole("button", { name: /重置本地练习数据/ }),
    ).toBeInTheDocument();
  });
});

describe("Error page — Traditional Chinese locale", () => {
  it("renders the error heading in Traditional Chinese", () => {
    setOnline(true);
    renderZhHant(<ErrorPage error={fakeError} reset={noop} />);

    // zh-Hant: error.heading = "發生錯誤"
    expect(
      screen.getByRole("heading", { name: /發生錯誤/ }),
    ).toBeInTheDocument();
  });

  it("renders the Reset local practice data button in Traditional Chinese", () => {
    setOnline(true);
    renderZhHant(<ErrorPage error={fakeError} reset={noop} />);

    // zh-Hant: error.resetLocalData = "重置本地練習資料"
    expect(
      screen.getByRole("button", { name: /重置本地練習資料/ }),
    ).toBeInTheDocument();
  });
});

describe("Error page — Reset local practice data button (guest user)", () => {
  it("renders the Reset local practice data button when online and guest", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, supabase: null });
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("button", { name: /reset local practice data/i }),
    ).toBeInTheDocument();
  });

  it("does NOT render the Reset button in the offline variant", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, supabase: null });
    setOnline(false);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.queryByRole("button", { name: /reset local practice data/i }),
    ).not.toBeInTheDocument();
  });

  it("calls clearLocalProgress and reloads on confirm", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, supabase: null });
    const { clearLocalProgress } = await import("@/lib/storage/reset");
    const mockClear = vi.mocked(clearLocalProgress);
    mockClear.mockResolvedValue(undefined);

    const reloadMock = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });

    // Confirm dialog returns true
    window.confirm = vi.fn().mockReturnValue(true);

    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    const user = userEvent.setup();
    const resetBtn = screen.getByRole("button", { name: /reset local practice data/i });
    await user.click(resetBtn);

    expect(mockClear).toHaveBeenCalledOnce();
    expect(reloadMock).toHaveBeenCalledOnce();

    // Restore
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("does NOT call clearLocalProgress when user cancels the confirm dialog", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, supabase: null });
    const { clearLocalProgress } = await import("@/lib/storage/reset");
    const mockClear = vi.mocked(clearLocalProgress);
    mockClear.mockClear();

    window.confirm = vi.fn().mockReturnValue(false);

    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    screen.getByRole("button", { name: /reset local practice data/i }).click();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockClear).not.toHaveBeenCalled();
  });
});

describe("Error page — signed-in user (reset button hidden)", () => {
  it("does NOT render the Reset local practice data button for a signed-in user", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseAuth.mockReturnValue({ user: { id: "abc" } as any, loading: false, supabase: null });
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.queryByRole("button", { name: /reset local practice data/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the signed-in heal hint instead of the reset button", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseAuth.mockReturnValue({ user: { id: "abc" } as any, loading: false, supabase: null });
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByText(/reloading will repair it automatically/i),
    ).toBeInTheDocument();
  });
});

describe("Error page — auth loading (indeterminate state)", () => {
  it("renders NEITHER the reset button NOR the signed-in hint while auth is loading", () => {
    // While auth resolves (~100–500 ms), a signed-in user must not see the
    // destructive guest-only reset button. Neither UI branch should render
    // until auth settles (#1506 fix).
    mockUseAuth.mockReturnValue({ user: null, loading: true, supabase: null });
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.queryByRole("button", { name: /reset local practice data/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/reloading will repair it automatically/i),
    ).not.toBeInTheDocument();
  });

  it("shows the reset button once auth resolves as guest", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, supabase: null });
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("button", { name: /reset local practice data/i }),
    ).toBeInTheDocument();
  });

  it("shows the signed-in hint once auth resolves as signed-in", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseAuth.mockReturnValue({ user: { id: "abc" } as any, loading: false, supabase: null });
    setOnline(true);
    renderWithIntl(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByText(/reloading will repair it automatically/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reset local practice data/i }),
    ).not.toBeInTheDocument();
  });
});

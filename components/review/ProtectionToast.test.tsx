/**
 * ProtectionToast component tests (#1487).
 *
 * Covers:
 *  - State coverage: earned, spent, earned-and-spent variants (IN)
 *  - Accessibility: role="status", aria-live="polite", dismiss aria-label
 *  - Auto-dismiss behaviour
 *  - Locale coverage: all three variants in en / ja / zh-Hans / zh-Hant
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, act, fireEvent } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { ProtectionToast } from "./ProtectionToast";

// ---------------------------------------------------------------------------
// Timer control
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// State: earned variant
// ---------------------------------------------------------------------------

describe("ProtectionToast — earned", () => {
  it("renders the earn heading and message", () => {
    const onDismiss = vi.fn();
    renderWithIntl(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={onDismiss} />,
    );
    expect(screen.getByText("Token earned")).toBeInTheDocument();
    expect(
      screen.getByText(
        /streak protection token earned.*automatically cover one missed day/i,
      ),
    ).toBeInTheDocument();
  });

  it("has role=status and aria-live=polite on the outer wrapper", () => {
    renderWithIntl(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={vi.fn()} />,
    );
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("dismiss button carries an explicit aria-label", () => {
    renderWithIntl(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={vi.fn()} />,
    );
    expect(screen.getByLabelText("Dismiss token notice")).toBeInTheDocument();
  });

  it("calls onDismiss when the button is clicked", () => {
    const onDismiss = vi.fn();
    renderWithIntl(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByLabelText("Dismiss token notice"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("auto-dismisses after 5 seconds", () => {
    const onDismiss = vi.fn();
    renderWithIntl(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={onDismiss} />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// State: spent variant
// ---------------------------------------------------------------------------

describe("ProtectionToast — spent", () => {
  it("renders the spend heading and streak count", () => {
    renderWithIntl(
      <ProtectionToast kind="spent" streakCount={7} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("Streak protected")).toBeInTheDocument();
    expect(
      screen.getByText(/we used a protection token to save your 7-day streak/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// State: earned-and-spent variant (longest body text, critical for locale wrapping)
// ---------------------------------------------------------------------------

describe("ProtectionToast — earned-and-spent", () => {
  it("renders the combined heading and message with streak count", () => {
    renderWithIntl(
      <ProtectionToast
        kind="earned-and-spent"
        streakCount={14}
        onDismiss={vi.fn()}
      />,
    );
    // Heading reuses "Token earned".
    expect(screen.getByText("Token earned")).toBeInTheDocument();
    // Body references the streak count.
    expect(
      screen.getByText(
        /streak protection token earned and used.*14-day streak is safe/i,
      ),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Locale: earned variant
// ---------------------------------------------------------------------------

describe("ProtectionToast — locale: earned", () => {
  it("en: renders earn heading and message in English", () => {
    renderWithIntl(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("Token earned")).toBeInTheDocument();
    expect(
      screen.getByText(/streak protection token earned/i),
    ).toBeInTheDocument();
  });

  it("ja: renders earn heading and message in Japanese", () => {
    renderJa(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("トークン獲得")).toBeInTheDocument();
    expect(
      screen.getByText(/連続ストリーク保護トークンを獲得/),
    ).toBeInTheDocument();
  });

  it("zh-Hans: renders earn heading and message in Simplified Chinese", () => {
    renderZhHans(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("获得令牌")).toBeInTheDocument();
    expect(screen.getByText(/已获得连续保护令牌/)).toBeInTheDocument();
  });

  it("zh-Hant: renders earn heading and message in Traditional Chinese", () => {
    renderZhHant(
      <ProtectionToast kind="earned" streakCount={5} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("獲得令牌")).toBeInTheDocument();
    expect(screen.getByText(/已獲得連續保護令牌/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Locale: spent variant
// ---------------------------------------------------------------------------

describe("ProtectionToast — locale: spent", () => {
  it("en: renders spend heading and message in English", () => {
    renderWithIntl(
      <ProtectionToast kind="spent" streakCount={3} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("Streak protected")).toBeInTheDocument();
    expect(screen.getByText(/we used a protection token/i)).toBeInTheDocument();
  });

  it("ja: renders spend heading and message in Japanese", () => {
    renderJa(
      <ProtectionToast kind="spent" streakCount={3} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("ストリーク保護")).toBeInTheDocument();
    expect(screen.getByText(/保護トークンを使用/)).toBeInTheDocument();
  });

  it("zh-Hans: renders spend heading and message in Simplified Chinese", () => {
    renderZhHans(
      <ProtectionToast kind="spent" streakCount={3} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("连续记录已保护")).toBeInTheDocument();
    expect(screen.getByText(/已使用保护令牌/)).toBeInTheDocument();
  });

  it("zh-Hant: renders spend heading and message in Traditional Chinese", () => {
    renderZhHant(
      <ProtectionToast kind="spent" streakCount={3} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("連續記錄已保護")).toBeInTheDocument();
    expect(screen.getByText(/已使用保護令牌/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Locale: earned-and-spent variant
// ---------------------------------------------------------------------------

describe("ProtectionToast — locale: earned-and-spent", () => {
  it("en: renders combined message in English with streak count", () => {
    renderWithIntl(
      <ProtectionToast
        kind="earned-and-spent"
        streakCount={10}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Token earned")).toBeInTheDocument();
    expect(
      screen.getByText(/streak protection token earned and used/i),
    ).toBeInTheDocument();
  });

  it("ja: renders combined message in Japanese with streak count", () => {
    renderJa(
      <ProtectionToast
        kind="earned-and-spent"
        streakCount={10}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("トークン獲得")).toBeInTheDocument();
    expect(
      screen.getByText(/連続ストリーク保護トークンを獲得して使用/),
    ).toBeInTheDocument();
  });

  it("zh-Hans: renders combined message in Simplified Chinese with streak count", () => {
    renderZhHans(
      <ProtectionToast
        kind="earned-and-spent"
        streakCount={10}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("获得令牌")).toBeInTheDocument();
    expect(screen.getByText(/已获得并使用连续保护令牌/)).toBeInTheDocument();
  });

  it("zh-Hant: renders combined message in Traditional Chinese with streak count", () => {
    renderZhHant(
      <ProtectionToast
        kind="earned-and-spent"
        streakCount={10}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("獲得令牌")).toBeInTheDocument();
    expect(screen.getByText(/已獲得並使用連續保護令牌/)).toBeInTheDocument();
  });
});

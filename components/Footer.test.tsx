/**
 * Component tests for Footer (issue #1369 i18n wiring; #1565 Part A statutory disclosure).
 *
 * Covers:
 *   - The footer renders nav links with translated labels (en: What's new, Privacy, Terms).
 *   - Japanese locale renders translated labels (新機能, プライバシー, 利用規約).
 *   - The footer is hidden when mobileNav is "bottom" (after mount effect fires).
 *   - The footer is visible when mobileNav is "hamburger".
 *   - SETTINGS_SAVED_EVENT triggers re-derivation of visibility.
 *   - The statutory trading disclosure (company number + registered office) renders
 *     when the footer is visible (#1565 Part A).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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

import type { MobileNav } from "@/lib/settings/persistence";

const mockLoadSettings = vi.fn(
  (): { mobileNav: MobileNav; masteryRepetitions: number } => ({
    mobileNav: "hamburger",
    masteryRepetitions: 3,
  }),
);
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

// ---------------------------------------------------------------------------

import { Footer } from "@/components/Footer";

// ---------------------------------------------------------------------------

// jsdom does not ship localStorage by default — install an in-memory stub.
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
  // Default to hamburger mode so the footer renders (bottom mode hides it).
  mockLoadSettings.mockReturnValue({ mobileNav: "hamburger", masteryRepetitions: 3 });
});

describe("Footer - English locale", () => {
  it("renders the What's new link", async () => {
    renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "What's new" })).toBeInTheDocument();
    });
  });

  it("renders the Privacy link", async () => {
    renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Privacy" })).toBeInTheDocument();
    });
  });

  it("renders the Terms link", async () => {
    renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Terms" })).toBeInTheDocument();
    });
  });

  it("hides the footer in bottom-nav mode after the effect fires", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });

    const { container } = renderWithIntl(<Footer />);

    // Wait for the useEffect to fire and apply the "bottom" mobileNav setting.
    await waitFor(() => {
      expect(container.querySelector("footer")).toBeNull();
    });
  });

  it("shows the footer in hamburger mode", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "hamburger", masteryRepetitions: 3 });

    const { container } = renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(container.querySelector("footer")).toBeInTheDocument();
    });
  });

  it("updates visibility when SETTINGS_SAVED_EVENT fires", async () => {
    // Start in hamburger mode - footer visible.
    mockLoadSettings.mockReturnValue({ mobileNav: "hamburger", masteryRepetitions: 3 });

    const { container } = renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(container.querySelector("footer")).toBeInTheDocument();
    });

    // User switches to bottom-nav mode in Settings.
    mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });
    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      expect(container.querySelector("footer")).toBeNull();
    });
  });
});

describe("Footer - Japanese locale", () => {
  it("renders nav link labels in Japanese (新機能, プライバシー, 利用規約)", async () => {
    renderJa(<Footer />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "新機能" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "プライバシー" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "利用規約" })).toBeInTheDocument();
    });
  });
});

describe("Footer - statutory trading disclosure (#1565 Part A)", () => {
  it("renders the company number in hamburger mode", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "hamburger", masteryRepetitions: 3 });
    renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/17258540/)).toBeInTheDocument();
    });
  });

  it("renders copyright as 'Frazzled Productions Ltd' in hamburger mode", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "hamburger", masteryRepetitions: 3 });
    renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/© \d{4} Frazzled Productions Ltd/)).toBeInTheDocument();
    });
  });

  it("renders the registered office address in hamburger mode", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "hamburger", masteryRepetitions: 3 });
    renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/Shelton Street/)).toBeInTheDocument();
    });
  });

  it("does not render the disclosure when the footer is hidden (bottom-nav mode)", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });
    renderWithIntl(<Footer />);

    await waitFor(() => {
      expect(screen.queryByText(/17258540/)).toBeNull();
    });
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CollapsibleSection } from "@/components/settings/CollapsibleSection";

const STORAGE_KEY = "poke-memory:settings-section:test-section";

// jsdom on this Node version does not ship localStorage out of the box, so
// the component tests provide their own in-memory stub.
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
}

// Install a fresh stub before each test and clean up afterwards.
beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  delete (window as unknown as { localStorage?: unknown }).localStorage;
});

describe("CollapsibleSection", () => {
  it("renders collapsed by default when no localStorage entry exists", () => {
    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section">
        <p>Section content</p>
      </CollapsibleSection>,
    );

    // The disclosure button is the child of the h2 heading element.
    const button = screen.getByRole("button", { name: /test section/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Content region is hidden via the `hidden` attribute.
    const region = screen.getByRole("region", { hidden: true });
    expect(region).toHaveAttribute("hidden");
  });

  it("renders the heading at h2 level for assistive-technology navigation", () => {
    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section">
        <p>Content</p>
      </CollapsibleSection>,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: /test section/i }),
    ).toBeInTheDocument();
  });

  it("expands when the heading button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section">
        <p>Section content</p>
      </CollapsibleSection>,
    );

    const button = screen.getByRole("button", { name: /test section/i });
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region")).not.toHaveAttribute("hidden");
  });

  it("collapses when the heading button is clicked a second time", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section">
        <p>Section content</p>
      </CollapsibleSection>,
    );

    const button = screen.getByRole("button", { name: /test section/i });
    await user.click(button);
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { hidden: true })).toHaveAttribute("hidden");
  });

  it("writes open state to localStorage after expanding", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section">
        <p>Content</p>
      </CollapsibleSection>,
    );

    await user.click(screen.getByRole("button", { name: /test section/i }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("writes closed state to localStorage after collapsing", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section">
        <p>Content</p>
      </CollapsibleSection>,
    );

    const button = screen.getByRole("button", { name: /test section/i });
    await user.click(button);
    await user.click(button);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
  });

  it("restores open state from localStorage on remount", () => {
    // Seed localStorage as if the section was previously opened.
    window.localStorage.setItem(STORAGE_KEY, "1");

    const { unmount } = render(
      <CollapsibleSection sectionId="test-section" heading="Test Section">
        <p>Content</p>
      </CollapsibleSection>,
    );

    expect(
      screen.getByRole("button", { name: /test section/i }),
    ).toHaveAttribute("aria-expanded", "true");

    unmount();

    // Re-mount - state should survive across the unmount/remount cycle.
    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section">
        <p>Content</p>
      </CollapsibleSection>,
    );

    expect(
      screen.getByRole("button", { name: /test section/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("auto-expands when forceOpen is true regardless of persisted state", () => {
    // Seed localStorage as closed.
    window.localStorage.setItem(STORAGE_KEY, "0");

    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section" forceOpen>
        <p>Content</p>
      </CollapsibleSection>,
    );

    expect(
      screen.getByRole("button", { name: /test section/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("persists open=true to localStorage when forceOpen triggers expansion", () => {
    render(
      <CollapsibleSection sectionId="test-section" heading="Test Section" forceOpen>
        <p>Content</p>
      </CollapsibleSection>,
    );

    // After forceOpen, a page reload should keep the section open.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  // transientOpen - search-driven expansion that must NOT pollute localStorage
  describe("transientOpen", () => {
    it("expands the section when transientOpen is true", () => {
      render(
        <CollapsibleSection sectionId="test-section" heading="Test Section" transientOpen>
          <p>Content</p>
        </CollapsibleSection>,
      );

      expect(
        screen.getByRole("button", { name: /test section/i }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("does NOT write to localStorage when transientOpen triggers expansion", () => {
      render(
        <CollapsibleSection sectionId="test-section" heading="Test Section" transientOpen>
          <p>Content</p>
        </CollapsibleSection>,
      );

      // localStorage must remain untouched - no entry should exist.
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("does NOT overwrite a persisted closed state when transientOpen is true", () => {
      // Persist section as closed.
      window.localStorage.setItem(STORAGE_KEY, "0");

      render(
        <CollapsibleSection sectionId="test-section" heading="Test Section" transientOpen>
          <p>Content</p>
        </CollapsibleSection>,
      );

      // Section is visually expanded by transientOpen…
      expect(
        screen.getByRole("button", { name: /test section/i }),
      ).toHaveAttribute("aria-expanded", "true");

      // …but the persisted closed state is unchanged.
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
    });

    it("reverts to persisted collapsed state after transientOpen is cleared (remount)", () => {
      // Simulate: section was collapsed by the user before a search began.
      window.localStorage.setItem(STORAGE_KEY, "0");

      const { unmount } = render(
        <CollapsibleSection sectionId="test-section" heading="Test Section" transientOpen>
          <p>Content</p>
        </CollapsibleSection>,
      );

      // Confirm it is visually open while transientOpen is true.
      expect(
        screen.getByRole("button", { name: /test section/i }),
      ).toHaveAttribute("aria-expanded", "true");

      unmount();

      // Re-mount without transientOpen (query cleared). Persisted state should
      // restore the section to collapsed, as if the search never happened.
      render(
        <CollapsibleSection sectionId="test-section" heading="Test Section">
          <p>Content</p>
        </CollapsibleSection>,
      );

      expect(
        screen.getByRole("button", { name: /test section/i }),
      ).toHaveAttribute("aria-expanded", "false");
    });
  });

  // onFirstCollapse - one-shot "default open" dismissal
  describe("onFirstCollapse", () => {
    it("calls onFirstCollapse when the user manually collapses the section", async () => {
      const user = userEvent.setup();
      const onFirstCollapse = vi.fn();

      render(
        <CollapsibleSection
          sectionId="test-section"
          heading="Test Section"
          forceOpen
          onFirstCollapse={onFirstCollapse}
        >
          <p>Content</p>
        </CollapsibleSection>,
      );

      // Section is force-opened; clicking collapses it.
      const button = screen.getByRole("button", { name: /test section/i });
      await user.click(button);

      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(onFirstCollapse).toHaveBeenCalledTimes(1);
    });

    it("does NOT call onFirstCollapse when the user expands (not collapses) the section", async () => {
      const user = userEvent.setup();
      const onFirstCollapse = vi.fn();

      render(
        <CollapsibleSection
          sectionId="test-section"
          heading="Test Section"
          onFirstCollapse={onFirstCollapse}
        >
          <p>Content</p>
        </CollapsibleSection>,
      );

      // Section starts collapsed; clicking expands it.
      const button = screen.getByRole("button", { name: /test section/i });
      await user.click(button);

      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(onFirstCollapse).not.toHaveBeenCalled();
    });
  });
});

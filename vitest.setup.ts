// Polyfill IndexedDB for the jsdom environment. jsdom does not ship IDB support,
// so component tests that exercise persistence indirectly need this shim.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement window.matchMedia. Provide a stub so any component
// that feature-detects reduced-motion (e.g. GradeButtons → triggerHaptic)
// gets a predictable result without throwing. Individual tests may override
// this stub with vi.fn() if they need to control the returned `matches` value.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

afterEach(() => {
  cleanup();
});

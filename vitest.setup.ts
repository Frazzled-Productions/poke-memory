// Polyfill IndexedDB for the jsdom environment. jsdom does not ship IDB support,
// so component tests that exercise persistence indirectly need this shim.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

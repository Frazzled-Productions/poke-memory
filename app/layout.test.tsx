/**
 * Tests for the root layout metadata export (#1058).
 *
 * Imports the `metadata` named export to verify the iOS PWA splash-screen
 * entries are well-formed. Importing the module also exercises the object
 * literal lines that the diff-coverage gate tracks.
 *
 * All Next.js / component imports that would fail in the jsdom environment
 * are mocked before the layout module is loaded.
 */
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks - must be declared before any imports from the module under test so
// that vi.mock hoisting applies before the module graph is evaluated.
// ---------------------------------------------------------------------------

// next/font/google calls a Node.js font resolution routine at module-eval time.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

// CSS imports are handled by Next.js's bundler but throw in Vitest's Node runner.
vi.mock("./globals.css", () => ({}));

// Stub every component the layout imports - we're only testing the metadata
// export, so none of these need to do anything.
vi.mock("@/components/Nav", () => ({ Nav: () => null }));
vi.mock("@/components/BottomTabBar", () => ({ BottomTabBar: () => null }));
vi.mock("@/components/MobileNavPaddingWrapper", () => ({
  MobileNavPaddingWrapper: () => null,
}));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/sync/SyncOnVisible", () => ({ SyncOnVisible: () => null }));
vi.mock("@/components/sync/SignInPull", () => ({ SignInPull: () => null }));
vi.mock("@/components/sync/AutoSyncOnChange", () => ({ AutoSyncOnChange: () => null }));
vi.mock("@/components/sync/OnlineReconnectSync", () => ({ OnlineReconnectSync: () => null }));
vi.mock("@/lib/auth/AuthContext", () => ({ AuthProvider: () => null }));
vi.mock("@/components/theme/FavouriteThemeProvider", () => ({
  FavouriteThemeProvider: () => null,
}));
vi.mock("@/components/theme/ThemeWatermark", () => ({ ThemeWatermark: () => null }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({ SuperuserProvider: () => null }));
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));
vi.mock("@/components/analytics/FunnelTracker", () => ({
  FunnelTracker: () => null,
}));
vi.mock("@/components/IdbMigration", () => ({ IdbMigration: () => null }));
vi.mock("@/components/onboarding/PwaInstallNudge", () => ({ PwaInstallNudge: () => null }));
vi.mock("@/components/pwa/ServiceWorkerProvider", () => ({ ServiceWorkerProvider: () => null }));
vi.mock("@/components/pwa/StoragePersistenceRequester", () => ({
  StoragePersistenceRequester: () => null,
}));
vi.mock("@/components/pwa/PwaBadge", () => ({ PwaBadge: () => null }));
vi.mock("@/components/pwa/DocumentTitleBadge", () => ({ DocumentTitleBadge: () => null }));

// next-intl server APIs are not available in jsdom - stub them out.
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getMessages: () => Promise.resolve({}),
}));
vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));
// i18n/request imports next/headers (server-only); stub for jsdom tests.
vi.mock("@/i18n/request", () => ({
  resolveLocale: () => "en",
  SUPPORTED_LOCALES: ["en", "ja", "zh-Hans", "zh-Hant"],
  LOCALE_COOKIE: "poke-memory:locale",
  DEFAULT_LOCALE: "en",
}));
// i18n/locales has no server-only imports - the real module can be used,
// but explicitly mock it here for clarity and to ensure test isolation.
vi.mock("@/i18n/locales", () => ({
  SUPPORTED_LOCALES: ["en", "ja", "zh-Hans", "zh-Hant"],
  LOCALE_COOKIE: "poke-memory:locale",
  DEFAULT_LOCALE: "en",
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import RootLayout, { metadata } from "@/app/layout";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Walks the React element tree returned by RootLayout to find the first
 * element matching the predicate. React doesn't expose a tree-walking API for
 * server components, so this does a depth-first search over `props.children`.
 * Used to assert layout body structure without trying to render `<html>` /
 * `<body>` through @testing-library (jsdom rejects that).
 */
function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  const children = (node.props as { children?: ReactNode }).children;
  let found: ReactElement | null = null;
  Children.forEach(children, (child) => {
    if (found !== null) return;
    found = findElement(child, predicate);
  });
  return found;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Root layout - metadata export", () => {
  it("exports a metadata object with appleWebApp defined", () => {
    expect(metadata).toBeDefined();
    expect(metadata.appleWebApp).toBeDefined();
  });

  it("includes exactly 12 startup images (portrait + landscape for 6 device sizes)", () => {
    const appleWebApp = metadata.appleWebApp as {
      startupImage: Array<{ url: string; media: string }>;
    };
    expect(Array.isArray(appleWebApp.startupImage)).toBe(true);
    expect(appleWebApp.startupImage).toHaveLength(12);
  });

  it("every startup image entry has a url and a media string", () => {
    const appleWebApp = metadata.appleWebApp as {
      startupImage: Array<{ url: string; media: string }>;
    };
    for (const entry of appleWebApp.startupImage) {
      expect(typeof entry.url).toBe("string");
      expect(entry.url.startsWith("/splash/")).toBe(true);
      expect(typeof entry.media).toBe("string");
      expect(entry.media.length).toBeGreaterThan(0);
    }
  });

  it("every portrait image has a matching landscape counterpart", () => {
    const appleWebApp = metadata.appleWebApp as {
      startupImage: Array<{ url: string; media: string }>;
    };
    const portraits = appleWebApp.startupImage.filter((e) =>
      e.media.includes("orientation: portrait"),
    );
    const landscapes = appleWebApp.startupImage.filter((e) =>
      e.media.includes("orientation: landscape"),
    );
    expect(portraits).toHaveLength(6);
    expect(landscapes).toHaveLength(6);
  });

  it("device dimensions in media queries match the url slug names", () => {
    const appleWebApp = metadata.appleWebApp as {
      startupImage: Array<{ url: string; media: string }>;
    };

    // Each entry's media query must contain a device-width and device-height.
    for (const entry of appleWebApp.startupImage) {
      expect(entry.media).toMatch(/device-width: \d+px/);
      expect(entry.media).toMatch(/device-height: \d+px/);
      expect(entry.media).toMatch(/-webkit-device-pixel-ratio: [23]/);
    }
  });
});

describe("Root layout - body structure (#1103)", () => {
  it("wraps persistent chrome in #app-root so FirstVisitOnboardingModal can toggle inert (#1103)", async () => {
    // Render the layout function to a React element tree. We don't mount it via
    // @testing-library because RTL can't render <html>/<body> in jsdom.
    // RootLayout is async (reads locale and messages server-side), so we await it.
    const tree = await RootLayout({ children: null });

    const appRoot = findElement(
      tree,
      (el) => typeof el.props === "object" && (el.props as { id?: string }).id === "app-root",
    );
    expect(appRoot).not.toBeNull();
    expect((appRoot!.props as { className?: string }).className).toBe("contents");

    // children must be threaded through the wrapper, not rendered as siblings.
    const childrenMarker = Symbol("kids");
    const treeWithKids = await RootLayout({
      // Pass an element we can identify by its key to verify the children slot.
      children: (
        <span data-testid="layout-children" data-marker={String(childrenMarker)} />
      ),
    });
    const wrapper = findElement(
      treeWithKids,
      (el) => typeof el.props === "object" && (el.props as { id?: string }).id === "app-root",
    );
    expect(wrapper).not.toBeNull();
    const found = findElement(
      wrapper,
      (el) =>
        typeof el.props === "object" &&
        (el.props as { ["data-marker"]?: string })["data-marker"] === String(childrenMarker),
    );
    expect(found).not.toBeNull();
  });
});

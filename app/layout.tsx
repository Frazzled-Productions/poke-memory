import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { splashStartupImages } from "@/lib/pwa/splashDevices";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { PokemonLocaleProvider } from "@/lib/i18n/PokemonLocaleContext";
import { SeedProvider } from "@/lib/pokemon/SeedContext";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { BottomTabBar } from "@/components/BottomTabBar";
import { MobileNavPaddingWrapper } from "@/components/MobileNavPaddingWrapper";
import { Footer } from "@/components/Footer";
import { SyncOnVisible } from "@/components/sync/SyncOnVisible";
import { SignInPull } from "@/components/sync/SignInPull";
import { AutoSyncOnChange } from "@/components/sync/AutoSyncOnChange";
import { OnlineReconnectSync } from "@/components/sync/OnlineReconnectSync";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { FavouriteThemeProvider } from "@/components/theme/FavouriteThemeProvider";
import { ThemeWatermark } from "@/components/theme/ThemeWatermark";
import { SuperuserProvider } from "@/lib/superuser/SuperuserContext";
import { DashboardSnapshotProvider } from "@/components/stats/DashboardSnapshotContext";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { FunnelTracker } from "@/components/analytics/FunnelTracker";
import { IdbMigration } from "@/components/IdbMigration";
import { PwaInstallNudge } from "@/components/onboarding/PwaInstallNudge";
import { MachineTranslationBanner } from "@/components/i18n/MachineTranslationBanner";
import { ProfileStatusBar } from "@/components/profile/ProfileStatusBar";
import { ServiceWorkerProvider } from "@/components/pwa/ServiceWorkerProvider";
import { StoragePersistenceRequester } from "@/components/pwa/StoragePersistenceRequester";
import { PwaBadge } from "@/components/pwa/PwaBadge";
import { DocumentTitleBadge } from "@/components/pwa/DocumentTitleBadge";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pokememory.com"),
  title: "Poké Memory",
  description:
    "Learn every Pokémon's name and evolutions with spaced repetition. Free, no sign-up required.",
  appleWebApp: {
    title: "Poké Memory",
    statusBarStyle: "black-translucent",
    // Derived from lib/pwa/splashDevices.ts (single source of truth, #1676), so
    // a new device's PNGs and media queries can never drift apart.
    startupImage: splashStartupImages(),
  },
  openGraph: {
    title: "Poké Memory",
    description:
      "Learn every Pokémon's name and evolutions with spaced repetition. Free, no sign-up required.",
    siteName: "Poké Memory",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Poké Memory",
    description:
      "Learn every Pokémon's name and evolutions with spaced repetition. Free, no sign-up required.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
  maximumScale: 1,
  userScalable: false,
  // Required for env(safe-area-inset-*) to resolve to non-zero values on iOS.
  // Without this, safe-area insets in BottomTabBar and MobileNavPaddingWrapper
  // collapse to zero, and the status-bar overlay set by black-translucent has
  // no corresponding top inset to push content clear of the Dynamic Island.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale is resolved inside <LocaleProvider> which is wrapped in <Suspense>
  // below. This keeps RootLayout itself free of dynamic cookie reads, so
  // statically-generated routes (e.g. /pokedex/[id]) can prerender without
  // hitting "Uncached data accessed outside of <Suspense>" (#1260).
  //
  // We default lang="en" on the <html> element here. The actual locale is
  // available to Server Components via setRequestLocale() inside LocaleProvider,
  // and to Client Components via NextIntlClientProvider. The lang attribute is
  // an accessibility hint only - it does not need to be dynamic at the shell level.

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Inline script applies saved theme before first paint to avoid flash of default palette.
            Also sets html background immediately so iOS WKWebView shows the correct colour
            instead of black while the Tailwind stylesheet is being parsed. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var r=document.documentElement;var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var bg=d?'#111113':'#fafafa';r.style.background=bg;var s=JSON.parse(localStorage.getItem('poke-memory:settings:v1')||'null');if(s){var h=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;var c=s.favouriteTheme&&s.favouriteTheme.colors;if(c&&h.test(c.primary))r.style.setProperty('--theme-primary',c.primary);if(c&&h.test(c.secondary))r.style.setProperty('--theme-secondary',c.secondary);if(c&&h.test(c.accent))r.style.setProperty('--theme-accent',c.accent);if(c&&h.test(c.fgOnPrimary))r.style.setProperty('--theme-fg-on-primary',c.fgOnPrimary);var i=s.themeIntensity;if(i==='tinted'||i==='full')r.setAttribute('data-intensity',i);}}catch(e){}`,
          }}
        />
        {/* Captures beforeinstallprompt synchronously - must run before React hydrates
            so Chrome's mini-infobar is suppressed. The hook in PwaInstallNudge reads
            window.__pwaInstallPrompt after hydration. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaInstallPrompt=e;});`,
          }}
        />
      </head>
      {/*
        Mobile app-shell: h-[100lvh] pins the body to the large viewport height
        (874px on iPhone 17 Pro), which is the only viewport unit that resolves
        to the true visible bottom on a non-scrolling page like Practice. dvh and
        svh both resolve to innerHeight (853px when the URL bar is visible),
        which left a 21px gap above the visible bottom. overflow-hidden confines
        scrolling to the internal content region so the BottomTabBar is always
        in-flow at the bottom of the visible screen (#1801).

        On desktop (md+) we revert to normal document scroll: h-auto removes the
        fixed height, min-h-[100svh] preserves the #1728 cold-paint guarantee
        (body is at least the expanded-URL-bar height at first paint), and
        overflow-visible allows the page to grow beyond the viewport. The bottom
        tab bar is hidden at md+ via md:hidden so no positioning adjustment is
        needed there.
      */}
      <body className="h-[100lvh] overflow-hidden flex flex-col md:h-auto md:min-h-[100svh] md:overflow-visible">
        {/*
          LocaleProvider is wrapped in Suspense so the cookie read it performs
          (resolveLocale → cookies()) is isolated from the static shell.
          Without this boundary, routes with generateStaticParams (e.g.
          /pokedex/[id]) fail prerendering with "Uncached data accessed outside
          of <Suspense>" because the dynamic cookie read propagates up through
          the layout (#1260).
        */}
        <Suspense fallback={null}>
          <LocaleProvider>
            {/*
              PokemonLocaleProvider consolidates the pokemonNameLocale subscription
              into a single pair of event listeners for the whole tree (#1329).
              Previously, each useLocalePokemonName call site registered its own
              listeners, costing O(N) subscriptions for N cards on screen and
              pushing practice-page hydration past the WebKit CI timeout.
            */}
            <PokemonLocaleProvider>
            {/*
              SeedProvider kicks off the async fetch of generated-core.json and
              generated-chains.json from public/pokemon-data/ on mount. This
              removes both files from the synchronous boot chunk, cutting the
              first-load JS parse from ~6.7s to sub-second on iOS (#1677).
              Placed inside PokemonLocaleProvider (which needs next-intl locale
              resolution) and outside AuthProvider (so auth state is irrelevant
              to the seed fetch). ReviewSession reads from useSeed().
            */}
            <SeedProvider>
            {/*
              #app-root wraps all persistent page chrome. FirstVisitOnboardingModal
              renders via createPortal directly onto <body> and toggles `inert` +
              `aria-hidden` on this element while open, preventing the screen-reader
              virtual cursor from escaping into background content.
            */}
            <div id="app-root" className="contents">
              <AuthProvider>
                <SuperuserProvider>
                  <DashboardSnapshotProvider>
                    <FavouriteThemeProvider>
                      <ThemeWatermark />
                      <Nav />
                      {/*
                        ProfileStatusBar is a slim, read-only band showing streak,
                        token balance, and mastery at a glance. Sourced entirely
                        from useProfileStatus(). Hidden on mobile Practice (the
                        StreakBadge already carries those signals there). Desktop
                        shows it on all routes (#1490).
                      */}
                      <ProfileStatusBar />
                      {/*
                        MachineTranslationBanner is a client component that reads
                        the active locale from a cookie and shows a dismissible
                        caution when the locale is non-English (#1349).
                        Rendered below the nav so it appears above all page content.
                      */}
                      <MachineTranslationBanner />
                      <Suspense fallback={null}>
                        <SyncOnVisible />
                      </Suspense>
                      <SignInPull />
                      <AutoSyncOnChange />
                      <OnlineReconnectSync />
                      <PwaInstallNudge />
                      {/*
                        FunnelTracker fires a single `app_open` custom event after auth
                        resolves. Properties are strictly bucketed (non-PII): userType
                        and progressBucket. Provides guest-to-account funnel visibility
                        without collecting raw counts or user IDs (#1667).
                      */}
                      <FunnelTracker />
                      {/*
                        Scroll region: the single flex-1 child between the sticky header
                        chrome and the in-flow BottomTabBar. On mobile this region owns
                        the internal scroll (overflow-y-auto) so the bar remains visible
                        at all times without position:fixed. On desktop (md+) overflow
                        reverts to visible and the document scrolls normally (#1801).
                        Footer scrolls with content here (it returns null in bottom-nav
                        mode anyway, so it only appears in hamburger / desktop flows).
                      */}
                      <div
                        className="flex flex-1 flex-col min-h-0 overflow-y-auto md:overflow-visible"
                        data-scroll-region
                      >
                        <MobileNavPaddingWrapper>{children}</MobileNavPaddingWrapper>
                        <Footer />
                      </div>
                      {/*
                        BottomTabBar is always mounted but returns null internally when
                        mobileNav === 'hamburger'. The single Suspense boundary here is
                        sufficient - the component has its own inner Suspense for the
                        async mastery check.
                        In-flow (not fixed) as of #1801 - see BottomTabBar.tsx for
                        the positioning change.
                      */}
                      <BottomTabBar />
                    </FavouriteThemeProvider>
                  </DashboardSnapshotProvider>
                </SuperuserProvider>
              </AuthProvider>
            </div>
            <IdbMigration />
            {/* Requests persistent storage to protect against 7-day ITP eviction (#1057). */}
            <StoragePersistenceRequester />
            {/* Registers the offline service worker and surfaces the update prompt (#703). */}
            <ServiceWorkerProvider />
            {/* Syncs the installed-PWA app icon badge with cards due today (#916). */}
            <PwaBadge />
            {/* Prefixes the browser tab title with a due-card count for desktop users (#1062). */}
            <DocumentTitleBadge />
            <Analytics />
            <SpeedInsights />
            </SeedProvider>
            </PokemonLocaleProvider>
          </LocaleProvider>
        </Suspense>
      </body>
    </html>
  );
}

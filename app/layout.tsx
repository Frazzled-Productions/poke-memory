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
import { PwaLoadingSplash } from "@/components/pwa/PwaLoadingSplash";

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
            __html: `try{var r=document.documentElement;var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var bg=d?'#111113':'#fafafa';r.style.background=bg;var s=JSON.parse(localStorage.getItem('poke-memory:settings:v1')||'null');if(s){var h=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;var c=s.favouriteTheme&&s.favouriteTheme.colors;if(c&&h.test(c.primary))r.style.setProperty('--theme-primary',c.primary);if(c&&h.test(c.secondary))r.style.setProperty('--theme-secondary',c.secondary);if(c&&h.test(c.accent))r.style.setProperty('--theme-accent',c.accent);if(c&&h.test(c.fgOnPrimary))r.style.setProperty('--theme-fg-on-primary',c.fgOnPrimary);var i=s.themeIntensity;if(i==='tinted'||i==='full')r.setAttribute('data-intensity',i);}var ks=document.createElement('style');ks.textContent='@keyframes __pwa_b{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-18px) rotate(20deg)}}';document.head.appendChild(ks);var sk=d?'#555':'#1a1a1a';var sp=document.createElement('div');sp.id='pwa-splash';sp.setAttribute('aria-hidden','true');sp.style.cssText='position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;z-index:9999;pointer-events:none;background:'+bg+';color:'+(d?'#666':'#999')+';font-family:system-ui,-apple-system,sans-serif;font-size:13px;letter-spacing:.06em;opacity:1;transition:opacity 0.2s ease-out;';sp.innerHTML='<div style="animation:__pwa_b 0.9s ease-in-out infinite"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="56" height="56" aria-hidden="true"><path d="M2 32A30 30 0 0 0 62 32Z" fill="#E01B2E"/><path d="M2 32A30 30 0 0 1 62 32Z" fill="white"/><circle cx="32" cy="32" r="30" fill="none" stroke="'+sk+'" stroke-width="2.5"/><line x1="2" y1="32" x2="62" y2="32" stroke="'+sk+'" stroke-width="2.5"/><circle cx="32" cy="32" r="9" fill="white" stroke="'+sk+'" stroke-width="2.5"/><circle cx="32" cy="32" r="5" fill="#e0e0e0"/></svg></div><span>Loading…</span>';r.appendChild(sp);}catch(e){}`,
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
      <body className="min-h-dvh flex flex-col">
        {/* The inline <script> above creates #pwa-splash synchronously before any
            CSS or JS bundle loads, so the Pokéball appears at first paint.
            PwaLoadingSplash removes it after React hydrates. */}
        <PwaLoadingSplash />
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
                        MobileNavPaddingWrapper adds bottom padding on mobile only when
                        the bottom tab bar is active, so the fixed bar never overlaps content.
                        The padding is removed automatically when the user switches to the
                        hamburger nav style via Settings.
                      */}
                      <MobileNavPaddingWrapper>{children}</MobileNavPaddingWrapper>
                      <Footer />
                      {/*
                        BottomTabBar is always mounted but returns null internally when
                        mobileNav === 'hamburger'. The single Suspense boundary here is
                        sufficient - the component has its own inner Suspense for the
                        async mastery check.
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

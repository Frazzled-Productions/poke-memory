import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
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
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { IdbMigration } from "@/components/IdbMigration";
import { PwaInstallNudge } from "@/components/onboarding/PwaInstallNudge";
import { GuestStorageNotice } from "@/components/onboarding/GuestStorageNotice";
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
    startupImage: [
      // iPhone 16 Pro Max  (440 × 956 logical, 3×)
      {
        url: "/splash/iphone16promax-portrait.png",
        media:
          "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/iphone16promax-landscape.png",
        media:
          "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
      },
      // iPhone 16 Pro / 15 Pro / 14 Pro  (402 × 874 logical, 3×)
      {
        url: "/splash/iphone16pro-portrait.png",
        media:
          "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/iphone16pro-landscape.png",
        media:
          "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
      },
      // iPhone 16 Plus / 15 Plus / 14 Plus  (430 × 932 logical, 3×)
      {
        url: "/splash/iphone16plus-portrait.png",
        media:
          "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/iphone16plus-landscape.png",
        media:
          "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
      },
      // iPhone 16 / 15 / 14  (393 × 852 logical, 3×)
      {
        url: "/splash/iphone16-portrait.png",
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/iphone16-landscape.png",
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
      },
      // iPhone 13 mini / 12 mini  (375 × 812 logical, 3×)
      {
        url: "/splash/iphone13mini-portrait.png",
        media:
          "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/iphone13mini-landscape.png",
        media:
          "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
      },
      // iPhone SE (3rd gen) / SE (2nd gen) / iPhone 8  (375 × 667 logical, 2×)
      {
        url: "/splash/iphoneSE-portrait.png",
        media:
          "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      {
        url: "/splash/iphoneSE-landscape.png",
        media:
          "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)",
      },
    ],
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Inline script applies saved theme before first paint to avoid flash of default palette */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=JSON.parse(localStorage.getItem('poke-memory:settings:v1')||'null');if(s){var r=document.documentElement;var h=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;var c=s.favouriteTheme&&s.favouriteTheme.colors;if(c&&h.test(c.primary))r.style.setProperty('--theme-primary',c.primary);if(c&&h.test(c.secondary))r.style.setProperty('--theme-secondary',c.secondary);if(c&&h.test(c.accent))r.style.setProperty('--theme-accent',c.accent);if(c&&h.test(c.fgOnPrimary))r.style.setProperty('--theme-fg-on-primary',c.fgOnPrimary);var i=s.themeIntensity;if(i==='tinted'||i==='full')r.setAttribute('data-intensity',i);}}catch(e){}`,
          }}
        />
        {/* Captures beforeinstallprompt synchronously — must run before React hydrates
            so Chrome's mini-infobar is suppressed. The hook in PwaInstallNudge reads
            window.__pwaInstallPrompt after hydration. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaInstallPrompt=e;});`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <SuperuserProvider>
            <FavouriteThemeProvider>
              <ThemeWatermark />
              <Nav />
              <Suspense fallback={null}>
                <SyncOnVisible />
              </Suspense>
              <SignInPull />
              <AutoSyncOnChange />
              <OnlineReconnectSync />
              <PwaInstallNudge />
              {/*
                GuestStorageNotice informs signed-out users that their progress
                is device-local and how to protect it (#1057). Renders nothing
                for authenticated users.
              */}
              <GuestStorageNotice />
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
                sufficient — the component has its own inner Suspense for the
                async mastery check.
              */}
              <BottomTabBar />
            </FavouriteThemeProvider>
          </SuperuserProvider>
        </AuthProvider>
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
      </body>
    </html>
  );
}

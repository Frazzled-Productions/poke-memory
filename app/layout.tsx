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
import { AuthProvider } from "@/lib/auth/AuthContext";
import { FavouriteThemeProvider } from "@/components/theme/FavouriteThemeProvider";
import { ThemeWatermark } from "@/components/theme/ThemeWatermark";
import { SuperuserProvider } from "@/lib/superuser/SuperuserContext";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { IdbMigration } from "@/components/IdbMigration";

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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

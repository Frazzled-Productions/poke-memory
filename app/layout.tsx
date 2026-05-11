import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { SyncOnVisible } from "@/components/sync/SyncOnVisible";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { FavouriteThemeProvider } from "@/components/theme/FavouriteThemeProvider";
import { SuperuserProvider } from "@/lib/superuser/SuperuserContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Poké Memory",
  description: "Spaced-repetition Pokémon flashcards",
  appleWebApp: {
    title: "Poké Memory",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#DC0A2D" },
    { media: "(prefers-color-scheme: dark)", color: "#8b0000" },
  ],
  colorScheme: "light dark",
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
    >
      <head>
        {/* Inline script applies saved theme before first paint to avoid flash of default palette */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('poke-memory:favourite:v1');if(t){var d=JSON.parse(t),c=d&&d.colors,r=document.documentElement,h=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;if(c&&h.test(c.primary))r.style.setProperty('--theme-primary',c.primary);if(c&&h.test(c.secondary))r.style.setProperty('--theme-secondary',c.secondary);if(c&&h.test(c.accent))r.style.setProperty('--theme-accent',c.accent);if(c&&h.test(c.fgOnPrimary))r.style.setProperty('--theme-fg-on-primary',c.fgOnPrimary);}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <SuperuserProvider>
            <FavouriteThemeProvider>
              <Nav />
              <Suspense fallback={null}>
                <SyncOnVisible />
              </Suspense>
              <div className="flex flex-1 flex-col">{children}</div>
            </FavouriteThemeProvider>
          </SuperuserProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

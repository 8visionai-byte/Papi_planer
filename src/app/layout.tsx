import type { Metadata, Viewport } from "next";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
// Imported from lib, NOT from the "use client" hook: a server component cannot
// read a plain value out of a client module.
import { THEME_INIT_SCRIPT } from "@/lib/theme-config";
import "./globals.css";

export const metadata: Metadata = {
  title: "PAPI PLANER",
  description: "Osobisty system zarządzania transformacją",
  applicationName: "PAPI PLANER",
  appleWebApp: {
    capable: true,
    title: "Papi",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // NOTE (WCAG 1.4.4): zoom stays locked until every text field is >= 16px.
  // Fields are still 14px in admin/mentors/diet/discipline/WeeklyCheckinForm, and
  // iOS auto-zooms into any field below 16px the moment zooming is allowed. Flip
  // both of these together with ROADMAP P0-13, not before.
  maximumScale: 1,
  userScalable: false,
  // Wakes up the six env(safe-area-inset-*) calculations in globals.css. Without it
  // they all resolve to 0 and the shell renders inside the notch / gesture bar.
  viewportFit: "cover",
  // Android: the layout viewport shrinks when the soft keyboard opens, so a
  // `position: fixed; bottom: 0` composer stays above it. iOS ignores this hint -
  // see src/hooks/useKeyboardInset.ts for the visualViewport fallback.
  interactiveWidget: "resizes-content",
  // Matches --dark-bg. The app ships dark; see globals.css.
  themeColor: "#0B0E13",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme="dark" is the server-rendered default. The inline script below
    // replaces it with the user's stored choice before first paint, so there is
    // no flash and no hydration mismatch.
    <html lang="pl" data-theme="dark">
      <head>
        {/* Anti-flash: must run before the first paint, hence an inline script.
            Source of truth: THEME_INIT_SCRIPT in src/lib/theme-config.ts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="manifest" href="/manifest.json" />
        {/* Modern + legacy install support */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Papi" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className="min-h-screen bg-[var(--background)]">
        <ServiceWorkerRegister />
        <ThemeProvider>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

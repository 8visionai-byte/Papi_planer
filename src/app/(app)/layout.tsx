"use client";

import { useAuth } from "@/hooks/useAuth";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import { RouteTransition } from "@/components/shell/RouteTransition";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { useKeyboardInsetVar } from "@/hooks/useKeyboardInset";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const redirected = useRef(false);

  // Publishes --kb (soft keyboard height) for every fixed bottom bar in the app.
  // Mounted here so it exists exactly once; see src/hooks/useKeyboardInset.ts.
  useKeyboardInsetVar();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !redirected.current) {
      redirected.current = true;
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          minHeight: "100dvh",
          paddingTop: "var(--safe-t)",
          paddingBottom: "var(--safe-b)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            background: "var(--gradient-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            boxShadow: "var(--shadow-primary)",
            animation: "glowPulse 1.6s ease-in-out infinite",
          }}
        >
          🏋️
        </div>
        <div
          style={{
            width: 28,
            height: 28,
            border: "3px solid var(--border)",
            borderTopColor: "var(--primary)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div
      className="papi-shell"
      style={{
        maxWidth: 430,
        margin: "0 auto",
        minHeight: "100dvh",
        position: "relative",
      }}
    >
      <main
        style={{
          // viewportFit: "cover" (src/app/layout.tsx) plus the black-translucent status
          // bar means the webview really does start under the clock. Without these three
          // insets the first heading of every screen sits under the notch, and on a
          // landscape iPhone the gutter disappears into the rounded corner.
          paddingTop: "var(--safe-t)",
          paddingLeft: "var(--safe-l)",
          paddingRight: "var(--safe-r)",
          // Tab bar (64px) + gesture bar + one breathing step, so the last row of any
          // list is reachable instead of hiding behind the bar.
          paddingBottom: "var(--content-pb)",
        }}
      >
        {/* Keyed by pathname on purpose: a layout does not remount between routes, so
            this is what makes the enter animation replay on every navigation. */}
        <RouteTransition key={pathname}>{children}</RouteTransition>
      </main>

      <BottomTabBar />
      <InstallPrompt />
      <ServiceWorkerRegistrar />
    </div>
  );
}

"use client";

import { useAuth } from "@/hooks/useAuth";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const redirected = useRef(false);
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
      style={{
        maxWidth: 430,
        margin: "0 auto",
        minHeight: "100dvh",
        position: "relative",
      }}
    >
      <main
        className="page-enter"
        style={{
          paddingBottom: "calc(88px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {children}
      </main>

      <BottomTabBar />
      <InstallPrompt />
      <ServiceWorkerRegistrar />
    </div>
  );
}

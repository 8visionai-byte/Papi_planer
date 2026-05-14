"use client";

import { useAuth } from "@/hooks/useAuth";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const redirected = useRef(false);
  const [voiceActive, setVoiceActive] = useState(false);

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
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100dvh",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
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
        style={{
          paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {children}
      </main>

      <BottomTabBar
        onVoiceTap={() => setVoiceActive((v) => !v)}
      />
      <InstallPrompt />
      <ServiceWorkerRegistrar />
    </div>
  );
}

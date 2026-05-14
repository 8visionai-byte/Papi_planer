"use client";

import { useEffect, useState, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed";

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // Don't show if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setDeferredPrompt(null);
    localStorage.setItem(DISMISSED_KEY, "1");
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "calc(80px + env(safe-area-inset-bottom, 0px) + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "calc(100% - 32px)",
        maxWidth: 398,
        background: "var(--card, #ffffff)",
        border: "1px solid var(--border, #e2e8f0)",
        borderRadius: 16,
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
        zIndex: 1000,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--foreground, #0f172a)",
          }}
        >
          Zainstaluj PapiCoach
        </p>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 12,
            color: "var(--muted-foreground, #64748b)",
          }}
        >
          Dodaj do ekranu głównego
        </p>
      </div>

      <button
        onClick={handleInstall}
        style={{
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 600,
          background: "var(--primary, #1d4ed8)",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Instaluj
      </button>

      <button
        onClick={handleDismiss}
        aria-label="Zamknij"
        style={{
          padding: 4,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--muted-foreground, #64748b)",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

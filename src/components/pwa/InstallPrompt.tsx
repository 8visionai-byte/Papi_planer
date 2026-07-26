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
        // Was calc(80px + safe-area + 8px), which double-counted the inset once
        // viewportFit: "cover" woke env() up. --above-tabbar already includes --safe-b.
        bottom: "calc(var(--above-tabbar) + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "calc(100% - 32px)",
        maxWidth: 398,
        // No hex fallbacks: globals.css always defines these, and the old light
        // defaults (#ffffff / #e2e8f0 / #0f172a / #4f46e5) painted a white card
        // with indigo trim if anything hiccuped.
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "var(--elev-3)",
        // 60, not 1000: above the tab bar (50) but below every Sheet (300). At 1000
        // this banner painted over an open sheet and covered its footer button, so
        // the sheet's primary action could not be tapped while the banner was up.
        zIndex: 60,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: "var(--text)",
          }}
        >
          Zainstaluj PapiCoach
        </p>
        <p
          style={{
            margin: "3px 0 0",
            fontSize: 13,
            color: "var(--text-3)",
          }}
        >
          Dodaj do ekranu głównego
        </p>
      </div>

      <button
        onClick={handleInstall}
        style={{
          padding: "0 16px",
          minHeight: 44,
          fontSize: 15,
          fontWeight: 700,
          background: "var(--primary)",
          // white on the cyan fill is 2.14:1 — the ink token is the only label
          color: "var(--primary-text)",
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
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          flexShrink: 0,
          margin: "-8px -8px -8px 0",
          padding: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-3)",
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

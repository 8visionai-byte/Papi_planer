"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (/sw.js) on the client.
 * Required for the "Install app" / "Add to Home Screen" prompt on Android,
 * and for offline caching. Safe no-op where service workers are unsupported.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[PWA] Rejestracja service workera nie powiodla sie:", err);
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}

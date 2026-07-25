"use client";

/**
 * ThemeProvider — mounts the theme system.
 *
 * It renders nothing of its own and holds no state: `useTheme()` already keeps
 * every consumer in sync through a module-level store, so a component can call
 * it with or without this wrapper.
 *
 * What the wrapper adds:
 *   1. a defensive re-apply of `data-theme` on mount, in case the inline
 *      anti-flash script in layout.tsx was blocked (strict CSP, script error,
 *      an old service-worker HTML shell served from cache),
 *   2. live reaction to the OS switching between light and dark while the app
 *      is open in "auto" mode — the CSS handles the repaint on its own, this
 *      only re-renders consumers so a theme toggle button shows the truth.
 *
 * Wrap the app once, above everything else:
 *   <ThemeProvider><SessionProvider>{children}</SessionProvider></ThemeProvider>
 */

import { useEffect } from "react";
import { applyTheme, readStoredTheme, useTheme } from "@/hooks/useTheme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();

  // 1. Make sure <html data-theme> exists even if the inline script never ran.
  useEffect(() => {
    const root = document.documentElement;
    if (!root.getAttribute("data-theme")) {
      applyTheme(readStoredTheme());
    }
  }, []);

  // 2. In "auto", follow the OS live. CSS repaints by itself; this keeps
  //    resolvedTheme (and therefore any toggle label) honest.
  useEffect(() => {
    if (theme !== "auto" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setTheme("auto");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme, setTheme]);

  return <>{children}</>;
}

export default ThemeProvider;

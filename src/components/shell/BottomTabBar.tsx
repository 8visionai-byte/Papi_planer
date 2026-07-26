"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useKeyboardOpen } from "@/hooks/useKeyboardInset";
import { haptic } from "@/lib/haptics";
import { Sheet } from "@/components/ui";

/* ============================================================================
   ICONS
   Stroke set, 24px box, 1.75px line, rounded caps - the system-icon rule from the
   design spec. Emoji stay where a human picked them (mentor avatars, moods), never
   as interface chrome: an emoji renders differently on every phone and cannot take
   the accent colour, which is why the old bar needed `filter: brightness(0) invert(1)`.
   ============================================================================ */

function Glyph({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      /* the only change on selection: a slightly heavier line. No size change, so
         nothing around it can shift. */
      strokeWidth={active ? 2.1 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ transition: "stroke-width 200ms var(--ease-out)", display: "block" }}
    >
      {children}
    </svg>
  );
}

const ICONS = {
  home: (
    <>
      <path d="M3 10.6 12 3.2l9 7.4" />
      <path d="M5.6 9.4V19a2 2 0 0 0 2 2H10v-6h4v6h2.4a2 2 0 0 0 2-2V9.4" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="3.8" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  check: (
    <>
      <path d="M20.8 11.3V12a8.8 8.8 0 1 1-5.2-8" />
      <path d="m8.8 11.4 2.9 2.9 9.5-9.5" />
    </>
  ),
  meal: (
    <>
      <path d="M7 3v6.2a2.2 2.2 0 0 0 4.4 0V3" />
      <path d="M9.2 9.4V21" />
      <path d="M17.2 3c1.5 1.6 2.1 3.6 2.1 5.6 0 1.7-.9 3-2.1 3.6V21" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.6A2.6 2.6 0 0 1 6.6 2H20v20H6.6A2.6 2.6 0 0 1 4 19.4z" />
      <path d="M8.2 2v20" />
    </>
  ),
  chat: <path d="M21 14.6a2.4 2.4 0 0 1-2.4 2.4H7.8L3 21.6V5.4A2.4 2.4 0 0 1 5.4 3h13.2A2.4 2.4 0 0 1 21 5.4z" />,
  people: (
    <>
      <path d="M15.4 21v-1.9a3.8 3.8 0 0 0-3.8-3.8H6.4a3.8 3.8 0 0 0-3.8 3.8V21" />
      <circle cx="9" cy="7.2" r="3.8" />
      <path d="M21.4 21v-1.9a3.8 3.8 0 0 0-2.9-3.7" />
      <path d="M15.6 3.4a3.8 3.8 0 0 1 0 7.4" />
    </>
  ),
  chart: (
    <>
      <path d="M6 20.5v-6" />
      <path d="M12 20.5V4" />
      <path d="M18 20.5v-9.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M3.5 8h16" />
      <circle cx="9" cy="8" r="2.6" />
      <path d="M3.5 16h16" />
      <circle cx="15" cy="16" r="2.6" />
    </>
  ),
  /* Energia. A bolt drawn as a stroked outline, not a filled polygon, so it carries
     the same 1.75px line weight as every other glyph and takes the accent colour on
     selection like the rest. Corners are plain joins - Glyph already rounds them. */
  bolt: <path d="M13 2.5 4.5 13.8h6.9l-1.4 7.7L19.5 10.2h-6.9z" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  bulb: (
    <>
      <path d="M9.2 18h5.6" />
      <path d="M10 21.2h4" />
      <path d="M12 2.8a6.2 6.2 0 0 0-3.6 11.25c.5.36.8.94.8 1.55V18h5.6v-2.4c0-.61.3-1.19.8-1.55A6.2 6.2 0 0 0 12 2.8z" />
    </>
  ),
} as const;

/* ============================================================================
   TABS
   ============================================================================ */

interface TabDef {
  label: string;
  path: string;
  icon: React.ReactNode;
  /** Extra route prefixes that should light this tab up. */
  also?: string[];
  adminOnly?: boolean;
}

/**
 * FIVE primary destinations. The old bar had eight (seven for a non-admin):
 * 7 x minWidth 64 + 6 x gap 4 = 472px inside a 414px container, so the last tabs lived
 * off-screen behind a scrollbar that was explicitly hidden. Nobody could find them.
 * Five tabs at flex:1 fit a 320px phone with room to spare.
 *
 * "Pulpit" is the label for /dashboard: "Dashboard" is 9 characters and overflows a
 * 62px cell on a 320px screen. Change this one string if you want it back.
 */
const PRIMARY: TabDef[] = [
  { label: "Pulpit", path: "/dashboard", icon: ICONS.home },
  /* "Energia" replaced "Cele" here: the energy score is the daily habit loop of
     this app, so it has to be one thumb-tap away. "Cele" is a weekly screen and
     moved to the top of "Więcej". Longest label in the bar at 7 characters -
     42.2px of text in a 57.6px cell on a 320px phone, see the width note on the
     bar container below. */
  { label: "Energia", path: "/energy", icon: ICONS.bolt },
  { label: "Nawyki", path: "/habits", icon: ICONS.check },
  { label: "Dieta", path: "/diet", icon: ICONS.meal },
];

/** Everything the bar no longer shows. Reachable in one tap through "Więcej". */
const SECONDARY: TabDef[] = [
  /* First in the list on purpose: it lost its permanent cell, so it gets the
     shortest path back - the row your thumb lands on when the sheet opens. */
  { label: "Cele", path: "/goals", icon: ICONS.target, also: ["/discipline"] },
  { label: "Dziennik", path: "/journal", icon: ICONS.book },
  { label: "Debata", path: "/roundtable", icon: ICONS.chat },
  { label: "Mentorzy", path: "/mentors", icon: ICONS.people },
  { label: "Wnioski", path: "/insights", icon: ICONS.bulb },
  { label: "Postępy", path: "/tracking", icon: ICONS.chart },
  { label: "Ustawienia", path: "/admin", icon: ICONS.sliders, adminOnly: true },
];

function matches(pathname: string, tab: TabDef): boolean {
  if (pathname.startsWith(tab.path)) return true;
  return (tab.also ?? []).some((p) => pathname.startsWith(p));
}

/* ============================================================================
   BAR
   ============================================================================ */

export function BottomTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const keyboardOpen = useKeyboardOpen();

  const secondary = useMemo(
    () => SECONDARY.filter((t) => !t.adminOnly || user?.role === "ADMIN"),
    [user?.role],
  );

  const activeIndex = useMemo(() => {
    const i = PRIMARY.findIndex((t) => matches(pathname, t));
    // not a primary route -> the pill sits under "Więcej" (index 4)
    return i === -1 ? PRIMARY.length : i;
  }, [pathname]);

  const onMoreScreen = activeIndex === PRIMARY.length;

  /* Warm the route bundles. router.push on a plain <button> gives Next no chance to
     prefetch, so every tab used to download 50-100 KB before it could paint. Idle
     prefetch of the four primary routes, then the exact route on finger-down. */
  useEffect(() => {
    const id = setTimeout(() => {
      PRIMARY.forEach((t) => {
        if (t.path !== pathname) router.prefetch(t.path);
      });
    }, 1200);
    return () => clearTimeout(id);
  }, [router, pathname]);

  const go = useCallback(
    (path: string, isActive: boolean) => {
      // Silence when re-tapping the tab we are already on: a buzz with no screen
      // change reads as a bug.
      if (!isActive) haptic.selection();
      router.push(path);
    },
    [router],
  );

  return (
    <>
      <nav
        className="glass"
        aria-label="Nawigacja główna"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          borderTop: "1px solid var(--border)",
          // The gesture bar / home indicator lives here. env() only returns a real
          // value because layout.tsx now sets viewportFit: "cover".
          paddingBottom: "var(--safe-b)",
          paddingLeft: "var(--safe-l)",
          paddingRight: "var(--safe-r)",
          // Slides away while the soft keyboard is up, so a bottom composer is never
          // covered and the shrunken screen is not eaten by chrome.
          transform: keyboardOpen ? "translateY(110%)" : "translateY(0)",
          pointerEvents: keyboardOpen ? "none" : undefined,
          transition: "transform 240ms var(--ease-ios)",
          willChange: "transform",
        }}
      >
        {/* Cell width is (viewport - 12px of padding) / 5, because all five cells are
            flex:1 and the row never scrolls:
              360px phone -> (360 - 12) / 5 = 69.6px per cell, 65.6px of text room
              320px phone -> (320 - 12) / 5 = 61.6px per cell, 57.6px of text room
            Both clear the 44px floor. "Energia" is the longest label and measures
            42.2px at 12px/700 (advance widths read out of the shipped UI font), i.e.
            15.4px of slack in the tightest cell - a hair wider than "Nawyki" (42.1px),
            which has fitted since the bar was built. It never reaches the edge, and
            tabLabelStyle keeps `nowrap` + ellipsis as the hard stop anyway, so a
            label can neither wrap to a second line nor spill out of its cell. */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "stretch",
            height: "var(--tabbar-h)",
            maxWidth: 430,
            margin: "0 auto",
            padding: "0 6px",
          }}
        >
          {/* Sliding selection pill. One element that travels, instead of five
              backgrounds switching on and off - that is what "bez przeskoków" means.
              5 equal cells, so translateX is a clean multiple of its own width. */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 6,
              bottom: 6,
              left: 6,
              width: "calc((100% - 12px) / 5)",
              transform: `translateX(${activeIndex * 100}%)`,
              transition: "transform 340ms var(--ease-ios)",
              background: "var(--primary-soft)",
              borderRadius: "var(--r-md)",
              boxShadow:
                "inset 0 0 0 1px var(--border-accent), var(--glow-accent-soft)",
              pointerEvents: "none",
            }}
          />

          {PRIMARY.map((tab) => {
            const isActive = matches(pathname, tab);
            return (
              <button
                key={tab.path}
                type="button"
                onPointerDown={() => router.prefetch(tab.path)}
                onClick={() => go(tab.path, isActive)}
                aria-current={isActive ? "page" : undefined}
                style={tabButtonStyle(isActive)}
              >
                <Glyph active={isActive}>{tab.icon}</Glyph>
                <span style={tabLabelStyle(isActive)}>{tab.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              haptic.tap();
              setMoreOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={onMoreScreen ? "page" : undefined}
            style={tabButtonStyle(onMoreScreen)}
          >
            <Glyph active={onMoreScreen}>{ICONS.more}</Glyph>
            <span style={tabLabelStyle(onMoreScreen)}>Więcej</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Więcej">
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 4 }}>
          {secondary.map((item) => {
            const isActive = matches(pathname, item);
            return (
              <button
                key={item.path}
                type="button"
                onPointerDown={() => router.prefetch(item.path)}
                onClick={() => {
                  if (!isActive) haptic.selection();
                  setMoreOpen(false);
                  router.push(item.path);
                }}
                aria-current={isActive ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  width: "100%",
                  /* full-width 56px row: the whole strip is the target, not the icon */
                  minHeight: 56,
                  padding: "0 12px",
                  border: "none",
                  borderRadius: "var(--r-md)",
                  background: isActive ? "var(--primary-soft)" : "transparent",
                  color: isActive ? "var(--primary-on-surface)" : "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                    height: 40,
                    flexShrink: 0,
                    borderRadius: "var(--r-sm)",
                    background: isActive ? "transparent" : "var(--surface-2)",
                    color: isActive ? "var(--primary-on-surface)" : "var(--text-2)",
                  }}
                >
                  <Glyph active={isActive}>{item.icon}</Glyph>
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "var(--fs-title3, 17px)",
                    fontWeight: isActive ? 700 : 500,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {item.label}
                </span>
                <span style={{ color: "var(--text-4)", display: "flex" }}>
                  <Glyph>{ICONS.chevron}</Glyph>
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Shared cell styles. Kept out of the JSX so the five primary cells and the
   "Więcej" cell can never drift apart by a pixel.
   --------------------------------------------------------------------------- */

function tabButtonStyle(isActive: boolean): React.CSSProperties {
  return {
    position: "relative",
    flex: 1,
    minWidth: 0,
    /* 44px is the hard floor from --tap-min; the cell is taller than that anyway,
       and the whole cell is the target, not just the glyph. */
    minHeight: "var(--tap-min)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    padding: "6px 2px",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: isActive ? "var(--primary-on-surface)" : "var(--text-3)",
    // `transform` is deliberately absent: the global :active rule in globals.css owns
    // the press (60ms in, 260ms out). An inline transition here would slow it down.
    transition: "color 200ms var(--ease-out)",
  };
}

function tabLabelStyle(isActive: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: isActive ? 700 : 500,
    lineHeight: 1.1,
    letterSpacing: isActive ? 0 : 0.1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  };
}

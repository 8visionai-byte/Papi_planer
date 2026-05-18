"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

interface Tab {
  label: string;
  icon: string;
  path: string;
  adminOnly?: boolean;
  isVoice?: boolean;
}

const tabs: Tab[] = [
  { label: "Dashboard", icon: "🏠", path: "/dashboard" },
  { label: "Cele", icon: "🎯", path: "/goals" },
  { label: "Nawyki", icon: "✅", path: "/habits" },
  { label: "Dziennik", icon: "📔", path: "/journal" },
  { label: "Dieta", icon: "🍽️", path: "/diet" },
  { label: "Debata", icon: "💬", path: "/roundtable" },
  { label: "Mentorzy", icon: "🧑‍🏫", path: "/mentors" },
  { label: "Admin", icon: "⚙️", path: "/admin", adminOnly: true },
];

interface BottomTabBarProps {
  onVoiceTap?: () => void;
}

export function BottomTabBar({ onVoiceTap }: BottomTabBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visibleTabs = tabs.filter(
    (tab) => !tab.adminOnly || user?.role === "ADMIN"
  );

  // Convert vertical mouse wheel to horizontal scroll on desktop
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Only redirect when scroll would actually move horizontally
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const canScrollH = el.scrollWidth > el.clientWidth;
        if (canScrollH) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Mouse drag-to-scroll on desktop (touch already works natively)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let isDown = false;
    let startX = 0;
    let scrollStart = 0;
    const onDown = (e: MouseEvent) => {
      // Only left button, and not if user is clicking a button (let click pass through)
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      isDown = true;
      startX = e.pageX;
      scrollStart = el.scrollLeft;
    };
    const onMove = (e: MouseEvent) => {
      if (!isDown) return;
      el.scrollLeft = scrollStart - (e.pageX - startX);
    };
    const onUp = () => {
      isDown = false;
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: "var(--card)",
        borderTop: "1px solid var(--border)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div
        ref={scrollRef}
        className="papicoach-bottom-nav-scroll"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: 64,
          maxWidth: 430,
          margin: "0 auto",
          padding: "0 8px",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
          cursor: "grab",
        }}
      >
        {visibleTabs.map((tab) => {
          const isActive = !tab.isVoice && pathname.startsWith(tab.path);

          if (tab.isVoice) {
            return (
              <button
                key={tab.path}
                onClick={() => {
                  if (onVoiceTap) onVoiceTap();
                  else router.push(tab.path);
                }}
                aria-label="Voice input"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "var(--primary)",
                  border: "none",
                  cursor: "pointer",
                  marginTop: -20,
                  boxShadow: "0 4px 12px rgba(29, 78, 216, 0.35)",
                  transition: "transform 150ms ease, box-shadow 150ms ease",
                  fontSize: 24,
                }}
                onMouseDown={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.transform =
                    "scale(0.92)")
                }
                onMouseUp={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.transform =
                    "scale(1)")
                }
              >
                <span style={{ filter: "brightness(0) invert(1)" }}>
                  {tab.icon}
                </span>
              </button>
            );
          }

          return (
            <button
              key={tab.path}
              onClick={() => router.push(tab.path)}
              aria-label={tab.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "6px 12px",
                minWidth: 64,
                flexShrink: 0,
                transition: "color 150ms ease",
                color: isActive ? "var(--primary)" : "var(--muted)",
              }}
            >
              <span style={{ fontSize: 24, lineHeight: 1 }}>{tab.icon}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
      <style>{`
        .papicoach-bottom-nav-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </nav>
  );
}

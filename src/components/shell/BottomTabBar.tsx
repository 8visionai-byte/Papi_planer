"use client";

import { usePathname, useRouter } from "next/navigation";
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
  { label: "Tracking", icon: "📊", path: "/tracking" },
  { label: "Debata", icon: "🏛️", path: "/roundtable", isVoice: true },
  { label: "Mentors", icon: "🧑‍🏫", path: "/mentors" },
  { label: "Admin", icon: "⚙️", path: "/admin", adminOnly: true },
];

interface BottomTabBarProps {
  onVoiceTap?: () => void;
}

export function BottomTabBar({ onVoiceTap }: BottomTabBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  const visibleTabs = tabs.filter(
    (tab) => !tab.adminOnly || user?.role === "ADMIN"
  );

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
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          height: 64,
          maxWidth: 430,
          margin: "0 auto",
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
                transition: "color 150ms ease",
                color: isActive ? "var(--primary)" : "var(--muted)",
              }}
            >
              <span style={{ fontSize: 24, lineHeight: 1 }}>{tab.icon}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

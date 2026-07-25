"use client";

import React from "react";
import { haptic } from "@/lib/haptics";

export interface BigTab<T extends string = string> {
  key: T;
  label: string;
}

interface BigTabsProps<T extends string = string> {
  tabs: ReadonlyArray<BigTab<T>>;
  active: T;
  onChange: (key: T) => void;
  style?: React.CSSProperties;
}

export default function BigTabs<T extends string = string>({
  tabs,
  active,
  onChange,
  style,
}: BigTabsProps<T>) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        marginBottom: 16,
        padding: 4,
        borderRadius: 14,
        background: "rgba(17, 19, 39, 0.05)",
        border: "1px solid rgba(17, 19, 39, 0.04)",
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              // Buzz only on a real tab change, not when re-tapping the active one.
              if (!isActive) haptic.selection();
              onChange(tab.key);
            }}
            style={{
              flex: 1,
              padding: "11px 12px",
              borderRadius: 11,
              border: "none",
              background: isActive ? "var(--card)" : "transparent",
              color: isActive ? "var(--primary)" : "var(--muted)",
              fontSize: 14,
              fontWeight: isActive ? 700 : 600,
              letterSpacing: -0.1,
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: isActive
                ? "0 1px 2px rgba(17,19,39,0.08), 0 4px 12px -4px rgba(17,19,39,0.12)"
                : "none",
              transition:
                "background 220ms var(--ease-out), color 220ms ease, box-shadow 220ms ease, font-weight 120ms ease",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

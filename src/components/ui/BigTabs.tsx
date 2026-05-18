"use client";

import React from "react";

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
    <div style={{ display: "flex", gap: 8, marginBottom: 16, ...style }}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: 10,
              border: "none",
              background: isActive ? "var(--primary)" : "var(--card)",
              color: isActive ? "#fff" : "var(--foreground)",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.1)" : "var(--card-shadow)",
              transition: "background 150ms ease, color 150ms ease, box-shadow 150ms ease",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

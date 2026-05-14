"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60dvh",
        padding: "32px 24px",
        textAlign: "center",
        gap: 16,
      }}
    >
      <span style={{ fontSize: 48 }}>😔</span>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "var(--foreground)",
          margin: 0,
        }}
      >
        Cos poszlo nie tak
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "var(--muted)",
          margin: 0,
          maxWidth: 280,
          lineHeight: 1.5,
        }}
      >
        Wystapil nieoczekiwany blad. Sprobuj ponownie lub wrocdo ekranu glownego.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button
          onClick={reset}
          style={{
            padding: "10px 24px",
            borderRadius: 9999,
            background: "var(--primary)",
            color: "#fff",
            border: "none",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sprobuj ponownie
        </button>
        <button
          onClick={() => (window.location.href = "/dashboard")}
          style={{
            padding: "10px 24px",
            borderRadius: 9999,
            background: "var(--background)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Dashboard
        </button>
      </div>
    </div>
  );
}

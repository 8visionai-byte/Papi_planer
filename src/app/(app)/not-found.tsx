import Link from "next/link";

export default function AppNotFound() {
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
      <span style={{ fontSize: 48 }}>🔍</span>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "var(--foreground)",
          margin: 0,
        }}
      >
        Nie znaleziono strony
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
        Strona, ktorej szukasz, nie istnieje lub zostala przeniesiona.
      </p>
      <Link
        href="/dashboard"
        style={{
          marginTop: 8,
          padding: "10px 24px",
          borderRadius: 9999,
          background: "var(--primary)",
          color: "#fff",
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Wroc do Dashboard
      </Link>
    </div>
  );
}

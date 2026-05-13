export default function DashboardPage() {
  return (
    <div style={{ padding: "24px 16px" }}>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "var(--foreground)",
          marginBottom: 8,
        }}
      >
        Dashboard
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 15 }}>
        Briefing will go here
      </p>
    </div>
  );
}

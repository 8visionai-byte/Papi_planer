"use client";

import { useCallback, useEffect, useState } from "react";

interface WeightEntry {
  id: string;
  date: string;
  weightKg: number;
  note: string | null;
}

interface WeightApiResponse {
  entries: WeightEntry[];
  avg7d: number | null;
  trend7d: number;
  message: string;
}

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 16,
  boxShadow: "var(--card-shadow)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

function formatKg(value: number | null | undefined, fallback = "--"): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return `${value.toFixed(1)} kg`;
}

function todayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
}

function TrendChart({
  entries,
  trend,
}: {
  entries: WeightEntry[];
  trend: number;
}) {
  if (entries.length < 2) {
    return (
      <div
        style={{
          fontSize: 12,
          color: "var(--muted)",
          textAlign: "center",
          padding: "16px 0",
        }}
      >
        Dodaj wpisy z kilku dni, aby zobaczyć wykres.
      </div>
    );
  }

  const width = 320;
  const height = 110;
  const padX = 6;
  const padY = 10;

  const values = entries.map((e) => e.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min < 0.5 ? 0.5 : max - min;

  const xStep =
    entries.length === 1 ? 0 : (width - padX * 2) / (entries.length - 1);
  const points = entries.map((e, i) => {
    const x = padX + i * xStep;
    const y =
      padY + ((max - e.weightKg) / span) * (height - padY * 2);
    return { x, y, value: e.weightKg };
  });

  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const color =
    trend < -0.3
      ? "var(--success)"
      : trend > 0.3
        ? "var(--danger)"
        : "var(--primary)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      style={{ display: "block" }}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={polyline}
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2.5}
          fill={color}
        />
      ))}
      <text
        x={padX}
        y={height - 2}
        fontSize={10}
        fill="var(--muted)"
      >
        {min.toFixed(1)} kg
      </text>
      <text
        x={width - padX}
        y={10}
        fontSize={10}
        textAnchor="end"
        fill="var(--muted)"
      >
        {max.toFixed(1)} kg
      </text>
    </svg>
  );
}

export default function WeightTracker() {
  const [data, setData] = useState<WeightApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/weight", { cache: "no-store" });
      if (!res.ok) throw new Error("fetch failed");
      const json: WeightApiResponse = await res.json();
      setData(json);
    } catch {
      setData({ entries: [], avg7d: null, trend7d: 0, message: "Nie udało się pobrać danych." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (msg: string, ms = 2500) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(input.replace(",", "."));
    if (!Number.isFinite(value) || value < 30 || value > 250) {
      showToast("Podaj wagę 30-250 kg");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightKg: value, date: todayIso() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Błąd zapisu" }));
        throw new Error(err.error || "Błąd zapisu");
      }
      setInput("");
      showToast("Zapisano!");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Błąd zapisu", 3500);
    } finally {
      setSubmitting(false);
    }
  };

  const latest = data?.entries.length ? data.entries[data.entries.length - 1] : null;
  const trend = data?.trend7d ?? 0;
  const trendColor =
    trend < -0.3
      ? "var(--success)"
      : trend > 0.3
        ? "var(--danger)"
        : "var(--muted)";

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>⚖️ Waga</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {data?.entries.length ?? 0} wpisów / 30 dni
        </span>
      </div>

      {loading ? (
        <div
          style={{
            height: 14,
            borderRadius: 7,
            background: "var(--border)",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Aktualnie
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--foreground)", marginTop: 2 }}>
                {latest ? formatKg(latest.weightKg) : "--"}
              </div>
            </div>
            <div style={{ width: 1, background: "var(--border)" }} />
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Średnia 7 dni
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--foreground)", marginTop: 2 }}>
                {formatKg(data?.avg7d ?? null)}
              </div>
            </div>
            <div style={{ width: 1, background: "var(--border)" }} />
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Trend / tydz.
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: trendColor, marginTop: 2 }}>
                {trend === 0
                  ? "0 kg"
                  : `${trend > 0 ? "+" : ""}${trend.toFixed(1)} kg`}
              </div>
            </div>
          </div>

          <TrendChart entries={data?.entries ?? []} trend={trend} />

          <div
            style={{
              fontSize: 13,
              color: "var(--foreground)",
              background: "rgba(0,0,0,0.04)",
              borderRadius: 10,
              padding: "8px 12px",
              lineHeight: 1.45,
            }}
          >
            {data?.message ?? ""}
          </div>

          <form onSubmit={handleSave} style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={30}
              max={250}
              placeholder="np. 82.4"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={submitting}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--background)",
                color: "var(--foreground)",
                fontSize: 14,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={submitting || input.trim().length === 0}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background:
                  submitting || input.trim().length === 0
                    ? "var(--border)"
                    : "var(--primary)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor:
                  submitting || input.trim().length === 0 ? "not-allowed" : "pointer",
                transition: "all 200ms ease",
              }}
            >
              {submitting ? "Zapisuję..." : "Zapisz"}
            </button>
          </form>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: -4 }}>
            Waż się rano, na czczo, po toalecie — średnia 7-dniowa wygładza wahania.
          </div>
        </>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            background: toast.toLowerCase().includes("błąd")
              ? "var(--danger)"
              : "var(--success)",
            color: "#fff",
            padding: "8px 20px",
            borderRadius: 9999,
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 100,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

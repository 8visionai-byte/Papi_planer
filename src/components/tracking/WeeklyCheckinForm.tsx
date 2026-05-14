"use client";

import { useState, useEffect, useCallback } from "react";

interface CheckinData {
  id: string;
  weekNumber: number;
  weight: number | null;
  wins: string | null;
  fails: string | null;
  energyAvg: number | null;
  areaStats: Array<{ areaId: string; total: number; completed: number; rate: number }> | null;
}

export function WeeklyCheckinForm() {
  const [checkin, setCheckin] = useState<CheckinData | null>(null);
  const [weight, setWeight] = useState("");
  const [wins, setWins] = useState("");
  const [fails, setFails] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchCheckin = useCallback(async () => {
    try {
      const res = await fetch("/api/tracking/checkin");
      if (!res.ok) return;
      const { checkin: data } = await res.json();
      if (data) {
        setCheckin(data);
        setWeight(data.weight?.toString() ?? "");
        setWins(data.wins ?? "");
        setFails(data.fails ?? "");
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCheckin();
  }, [fetchCheckin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch("/api/tracking/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight: weight ? parseFloat(weight) : undefined,
          wins: wins || undefined,
          fails: fails || undefined,
        }),
      });

      if (res.ok) {
        const { checkin: data } = await res.json();
        setCheckin(data);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ height: 20, width: "50%", borderRadius: 10, background: "#e2e8f0" }} />
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "#0f172a" }}>
          Tygodniowy check-in
        </h3>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms ease",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {checkin?.energyAvg != null && (
        <p style={{ fontSize: 13, color: "#94a3b8", margin: "6px 0 0" }}>
          Srednia energia: {checkin.energyAvg}/10
        </p>
      )}

      {expanded && (
        <form
          onSubmit={handleSubmit}
          style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}
        >
          {/* Weight */}
          <div>
            <label style={labelStyle}>Waga (kg)</label>
            <input
              type="number"
              step="0.1"
              min="30"
              max="300"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="np. 82.5"
              style={inputStyle}
            />
          </div>

          {/* Wins */}
          <div>
            <label style={labelStyle}>Co poszlo dobrze?</label>
            <textarea
              value={wins}
              onChange={(e) => setWins(e.target.value)}
              placeholder="Twoje sukcesy tego tygodnia..."
              rows={3}
              style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
            />
          </div>

          {/* Fails */}
          <div>
            <label style={labelStyle}>Co bylo trudne?</label>
            <textarea
              value={fails}
              onChange={(e) => setFails(e.target.value)}
              placeholder="Wyzwania i trudnosci..."
              rows={3}
              style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "10px 20px",
              borderRadius: 12,
              border: "none",
              background: "#1d4ed8",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.7 : 1,
              transition: "opacity 150ms",
              fontFamily: "inherit",
            }}
          >
            {saving ? "Zapisuję..." : saved ? "Zapisano!" : "Zapisz check-in"}
          </button>
        </form>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#64748b",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  fontSize: 14,
  fontFamily: "inherit",
  color: "#0f172a",
  background: "#f8fafc",
  outline: "none",
  boxSizing: "border-box",
};

"use client";

import { useState, useEffect, useCallback } from "react";
import { EnergyChart } from "@/components/tracking/EnergyChart";
import { SleepChart } from "@/components/tracking/SleepChart";
import { CompletionChart } from "@/components/tracking/CompletionChart";
import { MoodChart } from "@/components/tracking/MoodChart";
import { WeeklyCheckinForm } from "@/components/tracking/WeeklyCheckinForm";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DayStat {
  date: string;
  energy: number | null;
  sleepHours: number | null;
  sleepQuality: number | null;
  mood: string | null;
  completionRate: number | null;
}

interface Summary {
  avgEnergy: number | null;
  avgSleep: number | null;
  avgCompletion: number | null;
  totalActivities: number;
  completedActivities: number;
  moodDistribution: Record<string, number>;
}

interface TrackingData {
  dailyStats: DayStat[];
  summary: Summary;
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div style={chartCardStyle}>
      <div style={{ height: 16, width: "40%", borderRadius: 8, background: "#e2e8f0" }} />
      <div
        style={{
          height: 200,
          marginTop: 12,
          borderRadius: 12,
          background: "#f1f5f9",
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function TrackingPage() {
  const [range, setRange] = useState<7 | 14 | 30>(7);
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async (r: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracking/stats?range=${r}`);
      if (!res.ok) throw new Error();
      const json: TrackingData = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats(range);
  }, [range, fetchStats]);

  const hasData = data && data.dailyStats.length > 0;

  return (
    <div style={{ padding: "20px 16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "#0f172a", margin: 0 }}>
          Tracking
        </h1>
        <p style={{ fontSize: 14, color: "#94a3b8", margin: "4px 0 0" }}>
          Twoje postepy i statystyki
        </p>
      </div>

      {/* Range Selector */}
      <div style={rangeSelectorStyle}>
        {([7, 14, 30] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              ...pillStyle,
              background: range === r ? "#1d4ed8" : "transparent",
              color: range === r ? "#fff" : "#64748b",
            }}
          >
            {r} dni
          </button>
        ))}
      </div>

      {/* Summary Stats */}
      {loading ? (
        <div style={{ ...summaryRowStyle, gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ ...statCardStyle, height: 72 }}>
              <div style={{ height: 14, width: "60%", borderRadius: 7, background: "#e2e8f0" }} />
            </div>
          ))}
        </div>
      ) : hasData ? (
        <div style={summaryRowStyle}>
          <div style={statCardStyle}>
            <span style={statValueStyle}>
              {data.summary.avgEnergy != null ? data.summary.avgEnergy.toFixed(1) : "--"}
            </span>
            <span style={statLabelStyle}>Avg energia</span>
          </div>
          <div style={statCardStyle}>
            <span style={statValueStyle}>
              {data.summary.avgSleep != null ? `${data.summary.avgSleep.toFixed(1)}h` : "--"}
            </span>
            <span style={statLabelStyle}>Avg sen</span>
          </div>
          <div style={statCardStyle}>
            <span style={statValueStyle}>
              {data.summary.avgCompletion != null
                ? `${Math.round(data.summary.avgCompletion * 100)}%`
                : "--"}
            </span>
            <span style={statLabelStyle}>Realizacja</span>
          </div>
        </div>
      ) : null}

      {/* Charts */}
      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : !hasData ? (
        <div style={emptyStateStyle}>
          <span style={{ fontSize: 48 }}>&#128202;</span>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "#0f172a", margin: 0 }}>
            Brak danych
          </h2>
          <p style={{ fontSize: 14, color: "#94a3b8", margin: 0, textAlign: "center" }}>
            Zacznij logowac dane dzienne, aby zobaczyc wykresy i statystyki
          </p>
        </div>
      ) : (
        <div style={chartsGridStyle}>
          {/* Energy */}
          <div style={chartCardStyle}>
            <h3 style={chartTitleStyle}>Energia</h3>
            <EnergyChart data={data.dailyStats} avgEnergy={data.summary.avgEnergy} />
          </div>

          {/* Sleep */}
          <div style={chartCardStyle}>
            <h3 style={chartTitleStyle}>Sen</h3>
            <SleepChart data={data.dailyStats} />
          </div>

          {/* Completion */}
          <div style={chartCardStyle}>
            <h3 style={chartTitleStyle}>Realizacja celow</h3>
            <CompletionChart data={data.dailyStats} />
          </div>

          {/* Mood */}
          <div style={chartCardStyle}>
            <h3 style={chartTitleStyle}>Nastroj</h3>
            <MoodChart moodDistribution={data.summary.moodDistribution} />
          </div>
        </div>
      )}

      {/* Weekly Check-in */}
      <WeeklyCheckinForm />

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const rangeSelectorStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  background: "#f1f5f9",
  borderRadius: 12,
  padding: 4,
};

const pillStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  borderRadius: 10,
  border: "none",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 200ms ease",
};

const summaryRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  scrollbarWidth: "none",
};

const statCardStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#fff",
  borderRadius: 14,
  padding: "12px 14px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: "#0f172a",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  fontWeight: 500,
};

const chartsGridStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const chartCardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const chartTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#0f172a",
  margin: "0 0 8px",
};

const emptyStateStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "48px 24px",
  background: "#fff",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

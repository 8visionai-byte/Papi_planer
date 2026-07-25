"use client";

import { useState, useEffect, useCallback } from "react";
import { EnergyChart } from "@/components/tracking/EnergyChart";
import { SleepChart } from "@/components/tracking/SleepChart";
import { CompletionChart } from "@/components/tracking/CompletionChart";
import { MoodChart } from "@/components/tracking/MoodChart";
import { WeeklyCheckinForm } from "@/components/tracking/WeeklyCheckinForm";
import { Card, EmptyState, Skeleton, T, TYPO } from "@/components/ui";
import { AnimatedNumber, SegmentedTabs } from "@/components/motion";
import { haptic } from "@/lib/haptics";

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

type Range = 7 | 14 | 30;
const RANGES: Range[] = [7, 14, 30];

/* ------------------------------------------------------------------ */
/*  Small building blocks                                              */
/* ------------------------------------------------------------------ */

/** Section label above a chart card: 12px/700 uppercase, third text tier. */
function ChartTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ ...TYPO.label, color: T.text3, margin: `0 0 ${T.sp3}` }}>{children}</h3>
  );
}

/** Metric tile (2 in a row), per PREMIUM-DIRECTION 5.2 B. */
function Tile({
  label,
  value,
  unit,
  decimals = 0,
}: {
  label: string;
  value: number | null;
  unit?: string;
  decimals?: number;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.rLg,
        boxShadow: T.elev1,
        padding: T.sp4,
        minHeight: 92,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 10,
      }}
    >
      <span style={{ ...TYPO.label, color: T.text3 }}>{label}</span>
      {value == null ? (
        <span className="tile-num" style={{ color: T.text3 }}>
          &mdash;
        </span>
      ) : (
        <span style={{ display: "inline-flex", alignItems: "baseline" }}>
          <AnimatedNumber value={value} decimals={decimals} className="tile-num" />
          {unit ? <span className="tile-unit">{unit}</span> : null}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function TrackingPage() {
  const [range, setRange] = useState<Range>(7);
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

  const hasData = Boolean(data && data.dailyStats.length > 0);
  const completionPct =
    data?.summary.avgCompletion != null ? Math.round(data.summary.avgCompletion * 100) : null;

  return (
    <div
      style={{
        padding: `${T.sp6} ${T.gutter} ${T.sp6}`,
        display: "flex",
        flexDirection: "column",
        gap: T.sp5,
      }}
    >
      {/* ---- Header (PREMIUM-DIRECTION 5.1) ---- */}
      <header className="anim-in">
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Twoje postępy</div>
        <h1 style={{ ...TYPO.title1, color: T.text, margin: 0 }}>Tracking</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
          Energia, sen i realizacja z ostatnich {range} dni
        </p>
      </header>

      {/* ---- Range: swipeable segmented control ---- */}
      <SegmentedTabs
        tabs={RANGES.map((r) => ({ key: String(r), label: `${r} dni` }))}
        active={String(range)}
        onChange={(k) => {
          haptic.selection();
          setRange(Number(k) as Range);
        }}
        ariaLabel="Zakres dni"
      />

      {/* ---- Hero + tiles ---- */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
          <Skeleton variant="block" height={168} radius={28} />
          <div style={{ display: "flex", gap: T.sp3 }}>
            <Skeleton variant="block" height={92} radius={20} style={{ flex: 1, minWidth: 0 }} />
            <Skeleton variant="block" height={92} radius={20} style={{ flex: 1, minWidth: 0 }} />
          </div>
        </div>
      ) : hasData ? (
        <div className="anim-stagger" style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
          {/* the one hero of this screen */}
          <div className="card-hero">
            <div style={{ ...TYPO.label, color: T.text3 }}>Realizacja planu</div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                marginTop: T.sp3,
                minHeight: 48,
              }}
            >
              {completionPct == null ? (
                <span className="hero-num" style={{ color: T.text3 }}>
                  &mdash;
                </span>
              ) : (
                <>
                  <AnimatedNumber value={completionPct} className="hero-num" duration={800} />
                  <span className="hero-unit">%</span>
                </>
              )}
            </div>
            <div style={{ ...TYPO.callout, color: T.text2, marginTop: T.sp2 }}>
              {data!.summary.completedActivities} z {data!.summary.totalActivities} aktywności
              zrobionych
            </div>

            {/* progress bar: scaleX, never width */}
            <div
              style={{
                marginTop: T.sp4,
                height: 8,
                borderRadius: T.rFull,
                background: T.surface2,
                overflow: "hidden",
              }}
            >
              <div
                className="anim-bar"
                style={{
                  height: "100%",
                  width: `${completionPct ?? 0}%`,
                  borderRadius: T.rFull,
                  background: "var(--grad-accent)",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: T.sp3 }}>
            <Tile label="Śr. energia" value={data!.summary.avgEnergy} unit="/10" decimals={1} />
            <Tile label="Śr. sen" value={data!.summary.avgSleep} unit="h" decimals={1} />
          </div>
        </div>
      ) : null}

      {/* ---- Charts ---- */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
          <Skeleton variant="block" height={248} radius={20} />
          <Skeleton variant="block" height={248} radius={20} />
        </div>
      ) : !hasData ? (
        <Card>
          <EmptyState
            icon="📊"
            title="Brak danych"
            body="Zaloguj energię, sen i nastrój w dzienniku, a tutaj pojawią się wykresy."
            action={{ label: "Odśwież", onPress: () => fetchStats(range) }}
          />
        </Card>
      ) : (
        <div className="anim-stagger" style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
          <Card>
            <ChartTitle>Energia</ChartTitle>
            <EnergyChart data={data!.dailyStats} avgEnergy={data!.summary.avgEnergy} />
          </Card>

          <Card>
            <ChartTitle>Sen</ChartTitle>
            <SleepChart data={data!.dailyStats} />
          </Card>

          <Card>
            <ChartTitle>Realizacja celów</ChartTitle>
            <CompletionChart data={data!.dailyStats} />
          </Card>

          <Card>
            <ChartTitle>Nastrój</ChartTitle>
            <MoodChart moodDistribution={data!.summary.moodDistribution} />
          </Card>
        </div>
      )}

      {/* ---- Weekly check-in ---- */}
      <WeeklyCheckinForm />
    </div>
  );
}

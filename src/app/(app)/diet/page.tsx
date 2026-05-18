"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { useBroadcastChannel } from "@/hooks/useBroadcastChannel";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Meal {
  id: string;
  time: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  description: string | null;
}

interface Totals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface TodayData {
  date: string;
  meals: Meal[];
  totals: Totals;
  caloriesBurned: number; // legacy: activity-only
  activityCalories: number;
  activityCount: number;
  bmrSoFarToday: number;
  totalBurned: number;
  balance: number;
  targetCalories: number;
  bmr: number;
  tdee: number;
}

interface CalendarDay {
  date: string;
  meals: Meal[];
  totals: Totals;
  activityCalories: number;
  bmrForDay: number;
  caloriesBurned: number; // total burned for the day
  balance: number;
  mealCount: number;
  hasData: boolean;
  isFuture: boolean;
}

interface MonthResponse {
  month: string;
  days: CalendarDay[];
  targetCalories: number;
  bmr: number;
  tdee: number;
}

interface Estimate {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foods: string[];
}

interface VisionResult {
  name: string;
  foods: string[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: "low" | "medium" | "high";
  notes: string;
}

type Tab = "today" | "calendar";

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 16,
  boxShadow: "var(--card-shadow)",
};

const buttonPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "var(--primary)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const buttonGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--foreground)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--muted)",
  marginBottom: 4,
  display: "block",
};

const SUCCESS = "var(--success, #16a34a)";
const DANGER = "var(--danger, #ef4444)";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return "Dzisiaj";
  if (diffDays === 1) return "Wczoraj";
  return date.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" });
}

function fmtFullDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function nowHHMM(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ymKey(year: number, monthIdx: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
}

const MONTHS_PL = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];

const WEEKDAYS_PL = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];

/* ------------------------------------------------------------------ */
/*  Circular progress — new design                                     */
/* ------------------------------------------------------------------ */

function CircularProgress({
  eaten,
  burned,
  size = 200,
}: {
  eaten: number;
  burned: number;
  size?: number;
}) {
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = burned > 0 ? Math.min(1, eaten / burned) : 0;
  const offset = circumference * (1 - pct);
  const over = eaten > burned;
  const color = over ? DANGER : SUCCESS;
  const remaining = burned - eaten; // positive => budget left, negative => went over

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        margin: "0 auto",
      }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--border)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 400ms ease, stroke 300ms ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 12px",
        }}
      >
        <div style={{ fontSize: 36, fontWeight: 700, color: "var(--foreground)", lineHeight: 1 }}>
          {Math.round(eaten)}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          z {Math.round(burned)} kcal spalonych
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            marginTop: 8,
            color,
          }}
        >
          {over
            ? `+${Math.round(-remaining)} kcal nadwyżki`
            : `Pozostało: +${Math.round(remaining)} kcal`}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Breakdown stats row                                                */
/* ------------------------------------------------------------------ */

function BreakdownRow({
  icon,
  label,
  value,
  hint,
  color,
  bold,
}: {
  icon: string;
  label: string;
  value: string;
  hint?: string;
  color?: string;
  bold?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: 10,
        background: "var(--background)",
        border: "1px solid var(--border)",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          style={{
            fontWeight: bold ? 800 : 600,
            color: color ?? "var(--foreground)",
            fontSize: bold ? 16 : 13,
          }}
        >
          {value}
        </div>
        {hint && <div style={{ fontSize: 11, color: "var(--muted)" }}>{hint}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Macros Bar                                                         */
/* ------------------------------------------------------------------ */

function MacroBar({
  label,
  grams,
  kcalPerGram,
  totalKcal,
  color,
}: {
  label: string;
  grams: number;
  kcalPerGram: number;
  totalKcal: number;
  color: string;
}) {
  const kcal = grams * kcalPerGram;
  const pct = totalKcal > 0 ? Math.min(1, kcal / totalKcal) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: "var(--muted)" }}>
          {Math.round(grams)}g · {Math.round(pct * 100)}%
        </span>
      </div>
      <div
        style={{
          height: 8,
          background: "var(--border)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct * 100}%`,
            height: "100%",
            background: color,
            transition: "width 300ms ease",
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Calendar grid                                                      */
/* ------------------------------------------------------------------ */

function CalendarView({
  year,
  monthIdx,
  daysByDate,
  onPrev,
  onNext,
  onPick,
  selectedDate,
}: {
  year: number;
  monthIdx: number;
  daysByDate: Map<string, CalendarDay>;
  onPrev: () => void;
  onNext: () => void;
  onPick: (iso: string) => void;
  selectedDate: string | null;
}) {
  // Build a Mon-first grid for the month.
  const firstOfMonth = new Date(year, monthIdx, 1);
  // JS getDay(): 0=Sun..6=Sat; we want Mon=0..Sun=6
  const startDow = (firstOfMonth.getDay() + 6) % 7;
  const lastOfMonth = new Date(year, monthIdx + 1, 0);
  const totalDays = lastOfMonth.getDate();
  const totalCells = Math.ceil((startDow + totalDays) / 7) * 7;

  const today = todayIso();

  const cells: Array<{ iso: string | null; dayNum: number | null }> = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startDow + 1;
    if (dayNum < 1 || dayNum > totalDays) {
      cells.push({ iso: null, dayNum: null });
    } else {
      const iso = ymKey(year, monthIdx) + "-" + String(dayNum).padStart(2, "0");
      cells.push({ iso, dayNum });
    }
  }

  return (
    <section style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <button
          onClick={onPrev}
          aria-label="Poprzedni miesiąc"
          style={{ ...buttonGhost, padding: "6px 10px", fontSize: 16 }}
        >
          ←
        </button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {MONTHS_PL[monthIdx]} {year}
        </div>
        <button
          onClick={onNext}
          aria-label="Następny miesiąc"
          style={{ ...buttonGhost, padding: "6px 10px", fontSize: 16 }}
        >
          →
        </button>
      </div>

      {/* Weekday header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          marginBottom: 4,
        }}
      >
        {WEEKDAYS_PL.map((w) => (
          <div
            key={w}
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--muted)",
              textAlign: "center",
              padding: "2px 0",
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
        }}
      >
        {cells.map((cell, idx) => {
          if (!cell.iso) {
            return <div key={`empty-${idx}`} style={{ aspectRatio: "1 / 1" }} />;
          }
          const dayData = daysByDate.get(cell.iso);
          const isToday = cell.iso === today;
          const isSelected = cell.iso === selectedDate;
          const isFuture = dayData?.isFuture ?? false;
          const hasData = dayData?.hasData ?? false;
          const balance = dayData?.balance ?? 0;
          // balance > 0 -> ate more than burned -> surplus -> red
          // balance < 0 -> burned more -> deficit -> green
          let dotColor: string | null = null;
          if (hasData && !isFuture) {
            dotColor = balance > 0 ? DANGER : balance < 0 ? SUCCESS : "var(--muted)";
          }

          return (
            <button
              key={cell.iso}
              onClick={() => onPick(cell.iso!)}
              disabled={isFuture}
              style={{
                aspectRatio: "1 / 1",
                border: isSelected
                  ? `2px solid var(--primary)`
                  : isToday
                  ? `2px solid var(--foreground)`
                  : `1px solid var(--border)`,
                borderRadius: 8,
                background: isSelected ? "var(--background)" : "transparent",
                cursor: isFuture ? "default" : "pointer",
                opacity: isFuture ? 0.35 : 1,
                color: "var(--foreground)",
                padding: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                fontSize: 13,
                fontWeight: isToday ? 700 : 500,
                fontFamily: "inherit",
                position: "relative",
              }}
            >
              <span>{cell.dayNum}</span>
              {dotColor && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: dotColor,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 12,
          fontSize: 11,
          color: "var(--muted)",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: SUCCESS }} /> deficyt (chudnięcie)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: DANGER }} /> nadwyżka (tycie)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "transparent",
              border: "1px solid var(--border)",
            }}
          />{" "}
          brak danych
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Selected day detail                                                */
/* ------------------------------------------------------------------ */

function DayDetail({ day }: { day: CalendarDay }) {
  const totals = day.totals;
  const balance = day.balance;
  const balanceColor = balance > 0 ? DANGER : SUCCESS;

  return (
    <section style={cardStyle}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>
        {fmtFullDate(day.date)}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid var(--border)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--muted)" }}>🍽️ Zjedzone</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
            {Math.round(totals.calories)}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>kcal</div>
        </div>
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid var(--border)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--muted)" }}>🔥 Spalone</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
            {Math.round(day.caloriesBurned)}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>kcal</div>
        </div>
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            border: `1px solid ${balanceColor}`,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--muted)" }}>💰 Bilans</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, color: balanceColor }}>
            {balance >= 0 ? "+" : ""}
            {Math.round(balance)}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>kcal</div>
        </div>
      </div>

      {totals.calories > 0 && (
        <div style={{ marginBottom: 12 }}>
          <MacroBar
            label="Białko"
            grams={totals.protein}
            kcalPerGram={4}
            totalKcal={totals.calories || 1}
            color="#3b82f6"
          />
          <MacroBar
            label="Węglowodany"
            grams={totals.carbs}
            kcalPerGram={4}
            totalKcal={totals.calories || 1}
            color="#f59e0b"
          />
          <MacroBar
            label="Tłuszcze"
            grams={totals.fat}
            kcalPerGram={9}
            totalKcal={totals.calories || 1}
            color="#ef4444"
          />
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
        Posiłki ({day.mealCount})
      </div>
      {day.meals.length === 0 ? (
        <div
          style={{
            padding: "16px 0",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 12,
          }}
        >
          Brak posiłków
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {day.meals.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                gap: 10,
                padding: 8,
                borderRadius: 8,
                border: "1px solid var(--border)",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  minWidth: 42,
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--muted)",
                }}
              >
                {m.time}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.name}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                  {m.calories ?? 0} kcal · B {m.protein ?? 0}g · W {m.carbs ?? 0}g · T {m.fat ?? 0}g
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Trend line chart (SVG, no deps)                                    */
/* ------------------------------------------------------------------ */

interface SeriesPoint {
  date: string;
  value: number;
}

function TrendLineChart({
  title,
  series,
  height = 140,
  showZero = false,
  signedFill = false,
}: {
  title: string;
  series: Array<{ label: string; color: string; points: SeriesPoint[] }>;
  height?: number;
  showZero?: boolean;
  signedFill?: boolean;
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.value));
  if (all.length === 0) {
    return (
      <section style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>{title}</h3>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>
          Brak danych
        </div>
      </section>
    );
  }
  const dataMin = Math.min(...all);
  const dataMax = Math.max(...all);
  // Add zero line into the range if requested or if signed
  const minRaw = showZero || signedFill ? Math.min(0, dataMin) : dataMin;
  const maxRaw = showZero || signedFill ? Math.max(0, dataMax) : dataMax;
  const pad = (maxRaw - minRaw) * 0.1 || 1;
  const min = minRaw - pad;
  const max = maxRaw + pad;

  // Use the first series length as the X axis cardinality.
  const xCount = Math.max(1, series[0]?.points.length ?? 1);
  const viewW = 600;
  const viewH = height;
  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 24;
  const plotW = viewW - padL - padR;
  const plotH = viewH - padT - padB;

  const xFor = (i: number) =>
    xCount === 1 ? padL + plotW / 2 : padL + (i / (xCount - 1)) * plotW;
  const yFor = (v: number) =>
    padT + plotH - ((v - min) / (max - min || 1)) * plotH;

  const zeroY = yFor(0);

  return (
    <section style={cardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{title}</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {series.map((s) => (
            <span
              key={s.label}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 3,
                  background: s.color,
                  borderRadius: 2,
                  display: "inline-block",
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block" }}
      >
        {/* Y axis labels */}
        {[0, 0.5, 1].map((t) => {
          const v = min + (max - min) * (1 - t);
          const y = padT + plotH * t;
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={viewW - padR}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text
                x={padL - 4}
                y={y + 3}
                fontSize={9}
                textAnchor="end"
                fill="var(--muted)"
              >
                {Math.round(v)}
              </text>
            </g>
          );
        })}

        {/* Zero line emphasis when signed */}
        {(signedFill || showZero) && zeroY > padT && zeroY < padT + plotH && (
          <line
            x1={padL}
            x2={viewW - padR}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--muted)"
            strokeWidth={1}
          />
        )}

        {/* Series */}
        {series.map((s) => {
          const pts = s.points;
          if (pts.length === 0) return null;
          const path = pts
            .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.value)}`)
            .join(" ");
          // Signed fill: green above zero, red below — split per-segment.
          if (signedFill) {
            // Build two area paths (pos & neg) clipped to zero line
            const segments: Array<{ x: number; y: number; v: number }> = pts.map(
              (p, i) => ({ x: xFor(i), y: yFor(p.value), v: p.value })
            );
            // We'll just shade between line and zero per point using per-segment polygons.
            const posPolys: string[] = [];
            const negPolys: string[] = [];
            for (let i = 0; i < segments.length - 1; i++) {
              const a = segments[i];
              const b = segments[i + 1];
              // If both same sign, simple trapezoid
              if (a.v >= 0 && b.v >= 0) {
                posPolys.push(
                  `M ${a.x} ${zeroY} L ${a.x} ${a.y} L ${b.x} ${b.y} L ${b.x} ${zeroY} Z`
                );
              } else if (a.v <= 0 && b.v <= 0) {
                negPolys.push(
                  `M ${a.x} ${zeroY} L ${a.x} ${a.y} L ${b.x} ${b.y} L ${b.x} ${zeroY} Z`
                );
              } else {
                // sign change — interpolate crossing
                const t = a.v / (a.v - b.v); // fraction along segment where v=0
                const cx = a.x + (b.x - a.x) * t;
                if (a.v >= 0) {
                  posPolys.push(`M ${a.x} ${zeroY} L ${a.x} ${a.y} L ${cx} ${zeroY} Z`);
                  negPolys.push(`M ${cx} ${zeroY} L ${b.x} ${b.y} L ${b.x} ${zeroY} Z`);
                } else {
                  negPolys.push(`M ${a.x} ${zeroY} L ${a.x} ${a.y} L ${cx} ${zeroY} Z`);
                  posPolys.push(`M ${cx} ${zeroY} L ${b.x} ${b.y} L ${b.x} ${zeroY} Z`);
                }
              }
            }
            return (
              <g key={s.label}>
                {posPolys.map((p, i) => (
                  <path key={`p${i}`} d={p} fill={SUCCESS} fillOpacity={0.18} />
                ))}
                {negPolys.map((p, i) => (
                  <path key={`n${i}`} d={p} fill={DANGER} fillOpacity={0.18} />
                ))}
                <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              </g>
            );
          }
          return (
            <path
              key={s.label}
              d={path}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DietPage() {
  const [tab, setTab] = useState<Tab>("today");
  const [today, setToday] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Calendar state
  const now = useMemo(() => new Date(), []);
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [monthData, setMonthData] = useState<MonthResponse | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [time, setTime] = useState(nowHHMM());
  const [description, setDescription] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [estimateInfo, setEstimateInfo] = useState<Estimate | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [visionInfo, setVisionInfo] = useState<VisionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchToday = useCallback(async () => {
    try {
      const res = await fetch("/api/meals");
      if (res.ok) {
        setToday(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMonth = useCallback(async (year: number, monthIdx: number) => {
    setMonthLoading(true);
    try {
      const key = ymKey(year, monthIdx);
      const res = await fetch(`/api/meals?month=${key}`);
      if (res.ok) {
        const data: MonthResponse = await res.json();
        setMonthData(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setMonthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  useEffect(() => {
    if (tab === "calendar") {
      fetchMonth(calYear, calMonth);
    }
  }, [tab, calYear, calMonth, fetchMonth]);

  // Listen for invalidation events from dashboard (activity toggle, input submit, ...)
  useBroadcastChannel("papicoach:diet", () => {
    fetchToday();
    if (tab === "calendar") {
      fetchMonth(calYear, calMonth);
    }
  });

  // Refetch when the page becomes visible again
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        fetchToday();
        if (tab === "calendar") {
          fetchMonth(calYear, calMonth);
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("focus", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("focus", handler);
    };
  }, [fetchToday, fetchMonth, tab, calYear, calMonth]);

  const resetForm = useCallback(() => {
    setName("");
    setTime(nowHHMM());
    setDescription("");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setEstimateInfo(null);
    setVisionInfo(null);
  }, []);

  const handleEstimate = useCallback(async () => {
    const src = description.trim() || name.trim();
    if (!src) {
      showToast("Wpisz opis posiłku");
      return;
    }
    setEstimating(true);
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: src, description: src, autoEstimate: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Oszacowanie nie powiodło się");
      }
      const data = await res.json();
      const est: Estimate = data.estimate;
      setCalories(String(est.calories));
      setProtein(String(est.protein));
      setCarbs(String(est.carbs));
      setFat(String(est.fat));
      setEstimateInfo(est);
      if (!name.trim() && est.foods.length > 0) {
        setName(est.foods.join(", "));
      }
      showToast("Oszacowano przez AI");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bład AI";
      showToast(msg);
    } finally {
      setEstimating(false);
    }
  }, [description, name, showToast]);

  const handlePhotoClick = useCallback(() => {
    if (recognizing) return;
    fileInputRef.current?.click();
  }, [recognizing]);

  const handlePhotoChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        showToast("Plik za duży (max 5MB)");
        return;
      }

      setRecognizing(true);
      setVisionInfo(null);
      try {
        const formData = new FormData();
        formData.append("image", file);
        const res = await fetch("/api/meals/recognize-image", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Rozpoznawanie nie powiodło się");
        }
        const data = (await res.json()) as VisionResult;
        setName(data.name || "Posiłek");
        setCalories(String(data.calories));
        setProtein(String(data.protein));
        setCarbs(String(data.carbs));
        setFat(String(data.fat));
        setVisionInfo(data);
        setEstimateInfo(null);
        showToast("Rozpoznano ze zdjęcia");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Błąd rozpoznawania";
        showToast(msg);
      } finally {
        setRecognizing(false);
      }
    },
    [showToast]
  );

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      showToast("Podaj nazwę posiłku");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          time,
          description: description.trim() || undefined,
          calories: calories ? parseFloat(calories) : undefined,
          protein: protein ? parseFloat(protein) : undefined,
          carbs: carbs ? parseFloat(carbs) : undefined,
          fat: fat ? parseFloat(fat) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Zapis nie powiódł się");
      }
      showToast("Dodano posiłek");
      resetForm();
      setShowAdd(false);
      fetchToday();
      if (tab === "calendar") {
        fetchMonth(calYear, calMonth);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bład zapisu";
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }, [
    name,
    time,
    description,
    calories,
    protein,
    carbs,
    fat,
    showToast,
    resetForm,
    fetchToday,
    fetchMonth,
    tab,
    calYear,
    calMonth,
  ]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Usunąć ten posiłek?")) return;
      try {
        const res = await fetch("/api/meals", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error("Nie udało się usunąć");
        showToast("Usunięto");
        fetchToday();
        if (tab === "calendar") {
          fetchMonth(calYear, calMonth);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Bład usuwania";
        showToast(msg);
      }
    },
    [showToast, fetchToday, fetchMonth, tab, calYear, calMonth]
  );

  const handlePrevMonth = useCallback(() => {
    setSelectedDate(null);
    if (calMonth === 0) {
      setCalYear((y) => y - 1);
      setCalMonth(11);
    } else {
      setCalMonth((m) => m - 1);
    }
  }, [calMonth]);

  const handleNextMonth = useCallback(() => {
    setSelectedDate(null);
    // Don't navigate past the current month
    const nowY = now.getFullYear();
    const nowM = now.getMonth();
    if (calYear > nowY || (calYear === nowY && calMonth >= nowM)) return;
    if (calMonth === 11) {
      setCalYear((y) => y + 1);
      setCalMonth(0);
    } else {
      setCalMonth((m) => m + 1);
    }
  }, [calMonth, calYear, now]);

  /* ------------------------------------------------------------------ */
  /*  Derived                                                            */
  /* ------------------------------------------------------------------ */

  const daysByDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    if (monthData) {
      for (const d of monthData.days) {
        map.set(d.date, d);
      }
    }
    return map;
  }, [monthData]);

  const selectedDay = useMemo(() => {
    if (!selectedDate) return null;
    return daysByDate.get(selectedDate) ?? null;
  }, [selectedDate, daysByDate]);

  // Build 30-day series (from monthData, padded with prior history if month is short)
  const chartSeries = useMemo(() => {
    if (!monthData) return null;
    const pastDays = monthData.days.filter((d) => !d.isFuture);
    return pastDays;
  }, [monthData]);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: "3px solid var(--border)",
            borderTopColor: "var(--primary)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      </div>
    );
  }

  const totals = today?.totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const eaten = totals.calories;
  const burnedToday = today?.totalBurned ?? 0;
  const bmrSoFar = today?.bmrSoFarToday ?? 0;
  const bmrDaily = today?.bmr ?? 0;
  const activityCalories = today?.activityCalories ?? 0;
  const activityCount = today?.activityCount ?? 0;
  const remaining = burnedToday - eaten; // positive => budget; negative => overage
  const remainingColor = remaining >= 0 ? SUCCESS : DANGER;
  const targetCalories = today?.targetCalories ?? 2500;

  return (
    <div style={{ padding: "16px 12px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ padding: "4px 4px 0" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>🍽️ Dieta</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
          Śledź posiłki i bilans kaloryczny
        </p>
      </header>

      {/* Tabs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          background: "var(--card)",
          borderRadius: 12,
          padding: 4,
          boxShadow: "var(--card-shadow)",
        }}
      >
        {(
          [
            { id: "today", label: "Dzisiaj" },
            { id: "calendar", label: "Kalendarz" },
          ] as Array<{ id: Tab; label: string }>
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "none",
                background: active ? "var(--primary)" : "transparent",
                color: active ? "#fff" : "var(--foreground)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 200ms ease, color 200ms ease",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "today" ? (
        <>
          {/* DZISIAJ */}
          <section style={cardStyle}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Dzisiaj</h2>

            <CircularProgress eaten={eaten} burned={burnedToday} />

            {/* Breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
              <BreakdownRow
                icon="🌡️"
                label="BMR (spalanie spoczynkowe)"
                value={`${bmrDaily} kcal/dzień`}
              />
              <BreakdownRow
                icon="🔥"
                label="Aktywności dziś"
                value={`+${Math.round(activityCalories)} kcal`}
                hint={activityCount > 0 ? `${activityCount} ukończonych` : "brak aktywności"}
              />
              <BreakdownRow
                icon="📊"
                label="Spalanie do tej godziny"
                value={`${Math.round(burnedToday)} kcal`}
                hint={`BMR ${Math.round(bmrSoFar)} + aktywności ${Math.round(activityCalories)}`}
              />
              <BreakdownRow
                icon="🍽️"
                label="Zjedzone"
                value={`${Math.round(eaten)} kcal`}
              />
              <BreakdownRow
                icon="💰"
                label="Pozostało"
                value={`${remaining >= 0 ? "+" : ""}${Math.round(remaining)} kcal`}
                hint={remaining >= 0 ? "deficyt (chudnięcie)" : "nadwyżka (tycie)"}
                color={remainingColor}
                bold
              />
            </div>

            {/* Macros */}
            <div style={{ marginTop: 16 }}>
              <MacroBar
                label="Białko"
                grams={totals.protein}
                kcalPerGram={4}
                totalKcal={totals.calories || 1}
                color="#3b82f6"
              />
              <MacroBar
                label="Węglowodany"
                grams={totals.carbs}
                kcalPerGram={4}
                totalKcal={totals.calories || 1}
                color="#f59e0b"
              />
              <MacroBar
                label="Tłuszcze"
                grams={totals.fat}
                kcalPerGram={9}
                totalKcal={totals.calories || 1}
                color="#ef4444"
              />
            </div>

            {/* Target reference */}
            <div
              style={{
                marginTop: 14,
                padding: "8px 12px",
                borderRadius: 10,
                background: "var(--background)",
                border: "1px dashed var(--border)",
                fontSize: 11,
                color: "var(--muted)",
                textAlign: "center",
              }}
            >
              Cel dzienny:{" "}
              <strong style={{ color: "var(--foreground)" }}>{targetCalories} kcal</strong>{" "}
              (zgodnie z Twoim celem)
            </div>
          </section>

          {/* DODAJ POSIŁEK */}
          {!showAdd ? (
            <button
              onClick={() => {
                setShowAdd(true);
                setTime(nowHHMM());
              }}
              style={{ ...buttonPrimary, width: "100%", padding: "12px" }}
            >
              + Dodaj posiłek
            </button>
          ) : (
            <section style={cardStyle}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Nowy posiłek</h2>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Nazwa</label>
                  <input
                    style={inputStyle}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="np. Obiad: kurczak z ryżem"
                  />
                </div>
                <div style={{ width: 90 }}>
                  <label style={labelStyle}>Godzina</label>
                  <input
                    style={inputStyle}
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Opis (dla AI)</label>
                <VoiceTextarea
                  value={description}
                  onChange={setDescription}
                  placeholder="np. 100g kurczaka i 200g ryżu"
                  minHeight={70}
                />
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                style={{ display: "none" }}
              />

              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button
                  onClick={handleEstimate}
                  disabled={
                    estimating ||
                    recognizing ||
                    (!description.trim() && !name.trim())
                  }
                  style={{
                    ...buttonGhost,
                    flex: 1,
                    opacity:
                      estimating ||
                      recognizing ||
                      (!description.trim() && !name.trim())
                        ? 0.5
                        : 1,
                  }}
                >
                  {estimating ? "⏳ Szacuję..." : "🤖 Oszacuj z AI"}
                </button>
                <button
                  onClick={handlePhotoClick}
                  disabled={recognizing || estimating}
                  style={{
                    ...buttonGhost,
                    flex: 1,
                    opacity: recognizing || estimating ? 0.5 : 1,
                  }}
                >
                  {recognizing ? "⏳ Rozpoznaję zdjęcie..." : "📸 Zdjęcie posiłku"}
                </button>
              </div>

              {recognizing && (
                <div
                  style={{
                    padding: 10,
                    marginBottom: 12,
                    borderRadius: 8,
                    background: "var(--background)",
                    border: "1px solid var(--primary)",
                    fontSize: 12,
                    color: "var(--foreground)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      border: "2px solid var(--border)",
                      borderTopColor: "var(--primary)",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                      display: "inline-block",
                    }}
                  />
                  <span>Analizuję zdjęcie posiłku (może potrwać 5–10 s)...</span>
                </div>
              )}

              {visionInfo && !recognizing && (
                <div
                  style={{
                    padding: 10,
                    marginBottom: 12,
                    borderRadius: 8,
                    background: "var(--background)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--muted)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div>📸 Rozpoznano: {visionInfo.foods.join(", ") || "—"}</div>
                  <div>
                    Pewność:{" "}
                    <strong
                      style={{
                        color:
                          visionInfo.confidence === "high"
                            ? SUCCESS
                            : visionInfo.confidence === "medium"
                            ? "var(--primary)"
                            : DANGER,
                      }}
                    >
                      {visionInfo.confidence === "high"
                        ? "wysoka"
                        : visionInfo.confidence === "medium"
                        ? "średnia"
                        : "niska"}
                    </strong>
                  </div>
                  {visionInfo.notes && (
                    <div style={{ fontStyle: "italic" }}>{visionInfo.notes}</div>
                  )}
                </div>
              )}

              {estimateInfo && !visionInfo && (
                <div
                  style={{
                    padding: 10,
                    marginBottom: 12,
                    borderRadius: 8,
                    background: "var(--background)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  AI rozpoznało: {estimateInfo.foods.join(", ") || "—"}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={labelStyle}>Kalorie (kcal)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={calories}
                    onChange={(e) => setCalories(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Białko (g)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={protein}
                    onChange={(e) => setProtein(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Węgle (g)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={carbs}
                    onChange={(e) => setCarbs(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Tłuszcz (g)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={fat}
                    onChange={(e) => setFat(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button
                  onClick={() => {
                    resetForm();
                    setShowAdd(false);
                  }}
                  style={{ ...buttonGhost, flex: 1 }}
                  disabled={saving}
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSave}
                  style={{ ...buttonPrimary, flex: 2, opacity: saving ? 0.6 : 1 }}
                  disabled={saving}
                >
                  {saving ? "Zapisuję..." : "Zapisz posiłek"}
                </button>
              </div>
            </section>
          )}

          {/* LISTA POSIŁKÓW DZISIAJ */}
          <section style={cardStyle}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>
              Posiłki dziś ({today?.meals.length ?? 0})
            </h2>
            {today?.meals.length === 0 ? (
              <div
                style={{
                  padding: "20px 0",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                Brak posiłków na dziś
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {today?.meals.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        minWidth: 48,
                        textAlign: "center",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--muted)",
                      }}
                    >
                      {m.time}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {m.calories ?? 0} kcal · B {m.protein ?? 0}g · W {m.carbs ?? 0}g · T{" "}
                        {m.fat ?? 0}g
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(m.id)}
                      aria-label="Usuń posiłek"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 16,
                        padding: 6,
                        color: "var(--muted)",
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          {/* KALENDARZ TAB */}
          {monthLoading && !monthData ? (
            <section style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "40px 0",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    border: "3px solid var(--border)",
                    borderTopColor: "var(--primary)",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
              </div>
            </section>
          ) : (
            <CalendarView
              year={calYear}
              monthIdx={calMonth}
              daysByDate={daysByDate}
              onPrev={handlePrevMonth}
              onNext={handleNextMonth}
              onPick={(iso) => setSelectedDate(iso === selectedDate ? null : iso)}
              selectedDate={selectedDate}
            />
          )}

          {selectedDay && <DayDetail day={selectedDay} />}

          {/* CHARTS */}
          {chartSeries && chartSeries.length > 0 && (
            <>
              <TrendLineChart
                title="Spalanie vs jedzenie"
                series={[
                  {
                    label: "Spalone",
                    color: DANGER,
                    points: chartSeries.map((d) => ({
                      date: d.date,
                      value: d.caloriesBurned,
                    })),
                  },
                  {
                    label: "Zjedzone",
                    color: "#3b82f6",
                    points: chartSeries.map((d) => ({
                      date: d.date,
                      value: d.totals.calories,
                    })),
                  },
                ]}
              />
              <TrendLineChart
                title="Bilans dzienny"
                series={[
                  {
                    label: "Bilans (zjedzone − spalone)",
                    color: "var(--foreground)",
                    points: chartSeries.map((d) => ({
                      date: d.date,
                      value: d.balance,
                    })),
                  },
                ]}
                signedFill
              />
            </>
          )}
        </>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--foreground)",
            color: "var(--background)",
            padding: "10px 18px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 100,
            maxWidth: "92vw",
            textAlign: "center",
            boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { useBroadcastChannel } from "@/hooks/useBroadcastChannel";
import {
  Button,
  Card,
  EmptyState,
  Field,
  ListRow,
  Pressable,
  Sheet,
  Skeleton,
  fieldControlStyle,
  T,
  TYPO,
} from "@/components/ui";
import { AnimatedNumber, Reveal, SegmentedTabs, SwipeDeck } from "@/components/motion";
import { haptic } from "@/lib/haptics";

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

const TAB_KEYS: readonly Tab[] = ["today", "calendar"] as const;
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "today", label: "Dzisiaj" },
  { key: "calendar", label: "Kalendarz" },
];

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/*  Fills (bars, dots, chart strokes) vs text: the *_TEXT variants are  */
/*  the contrast-corrected tokens, safe on every surface.               */
/* ------------------------------------------------------------------ */

const SUCCESS = "var(--success)";
const DANGER = "var(--danger)";
const SUCCESS_TEXT = "var(--success-on-surface)";
const DANGER_TEXT = "var(--danger-on-surface)";

/* Three data hues for macros and charts. Never the brand cyan - the accent is
   reserved for actions and the active tab (max two accent items per screen). */
const HUE_PROTEIN = "var(--accent)";
const HUE_CARBS = "var(--highlight)";
const HUE_FAT = "var(--danger)";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtFullDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtHeaderDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
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
/*  Icons - interface glyphs are SVG (stroke 1.75, round caps).        */
/*  Emoji stay only where they are content, never as a system icon.    */
/* ------------------------------------------------------------------ */

function Icon({
  children,
  size = 22,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

const PlusIcon = ({ size = 26 }: { size?: number }) => (
  <Icon size={size}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Icon>
);

const TrashIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Icon>
);

const ChevronLeftIcon = ({ size = 22 }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="15 18 9 12 15 6" />
  </Icon>
);

const ChevronRightIcon = ({ size = 22 }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="9 18 15 12 9 6" />
  </Icon>
);

const PlateIcon = ({ size = 26 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
  </Icon>
);

const CalendarIcon = ({ size = 26 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
  </Icon>
);

/**
 * Anything `position: fixed` has to leave the page tree: the app shell keeps
 * `transform: translateY(0)` on <main> after `.page-enter` (animation-fill-mode:
 * both), and a transformed ancestor turns `fixed` into `absolute`. The floating
 * button would then sit at the bottom of the document instead of the screen.
 */
function BodyPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/* ------------------------------------------------------------------ */
/*  Hero ring - the one big number of the screen                       */
/* ------------------------------------------------------------------ */

const RING_SIZE = 208;
const RING_STROKE = 14;

function CalorieRing({ eaten, burned }: { eaten: number; burned: number }) {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = burned > 0 ? Math.min(1, eaten / burned) : 0;
  const offset = circumference * (1 - pct);
  const over = eaten > burned;
  const remaining = Math.round(burned - eaten);

  return (
    <div
      style={{
        position: "relative",
        width: "min(208px, 58vw)",
        aspectRatio: "1 / 1",
        margin: "0 auto",
      }}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        width="100%"
        height="100%"
        style={{ display: "block", transform: "rotate(-90deg)" }}
      >
        <defs>
          <linearGradient id="dietRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--grad-ring-from)" />
            <stop offset="100%" stopColor="var(--grad-ring-to)" />
          </linearGradient>
        </defs>
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={RING_STROKE}
        />
        <circle
          className="anim-ring"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          fill="none"
          stroke={over ? DANGER : "url(#dietRingGrad)"}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={
            {
              "--ring-len": `${circumference}`,
              transition: "stroke-dashoffset 600ms var(--ease-out), stroke 200ms linear",
            } as React.CSSProperties
          }
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
          gap: 4,
          padding: "0 18px",
          textAlign: "center",
        }}
      >
        <span style={{ ...TYPO.label, color: T.text3 }}>
          {over ? "Ponad limit" : "Pozostało"}
        </span>
        <AnimatedNumber
          value={Math.abs(remaining)}
          unit="kcal"
          className="hero-num"
          style={{
            color: over ? DANGER_TEXT : T.text,
            fontSize: "clamp(32px, 11vw, 44px)",
            lineHeight: 1,
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small pieces                                                       */
/* ------------------------------------------------------------------ */

/** Label + number pair used under the ring and in the day detail. */
function MiniStat({
  label,
  value,
  unit = "kcal",
  color,
  signed = false,
}: {
  label: string;
  value: number;
  unit?: string;
  color?: string;
  /** Prefixes a positive number with "+" (balance). */
  signed?: boolean;
}) {
  const rounded = Math.round(value);
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
      <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>{label}</div>
      <div>
        <span className="tile-num" style={{ color: color ?? T.text }}>
          {signed && rounded > 0 ? "+" : ""}
          {rounded}
        </span>
        <span className="tile-unit">{unit}</span>
      </div>
    </div>
  );
}

/** Micro badge for a macro gram value. 12 px is allowed here (micro badge). */
function Chip({
  children,
  strong = false,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 9px",
        borderRadius: T.rFull,
        background: T.surface2,
        color: strong ? T.text2 : T.text3,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.01em",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Macro bar. The fill is scaled with `transform: scaleX` (never `width`), and the
 * rounded ends come from the track clipping it - so the radius never distorts.
 */
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
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ ...TYPO.footnote, fontWeight: 600, color: T.text2 }}>{label}</span>
        <span style={{ ...TYPO.footnote, color: T.text3, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: T.text, fontWeight: 700 }}>{Math.round(grams)} g</span>
          {"  ·  "}
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div
        style={{
          height: 10,
          borderRadius: T.rFull,
          background: T.surface3,
          overflow: "hidden",
        }}
      >
        <div
          className="anim-bar"
          style={{
            width: "100%",
            height: "100%",
            background: color,
            transformOrigin: "left center",
            transform: `scaleX(${pct})`,
            transition: "transform 720ms var(--ease-out)",
          }}
        />
      </div>
    </div>
  );
}

/** Quiet detail row: label left, number right. 44 px tall. */
function DetailRow({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        minHeight: 44,
        padding: "6px 0",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ ...TYPO.footnote, color: T.text2 }}>{label}</div>
        {hint ? (
          <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{hint}</div>
        ) : null}
      </div>
      <div
        style={{
          ...TYPO.callout,
          fontWeight: 700,
          color: color ?? T.text,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {value}
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
    <Card padding="sm">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Pressable
          onPress={onPrev}
          haptic="selection"
          ariaLabel="Poprzedni miesiąc"
          style={{ width: 44, height: 44, borderRadius: T.rMd, color: T.text2 }}
        >
          <ChevronLeftIcon />
        </Pressable>
        <div style={{ ...TYPO.title3, color: T.text }}>
          {MONTHS_PL[monthIdx]} {year}
        </div>
        <Pressable
          onPress={onNext}
          haptic="selection"
          ariaLabel="Następny miesiąc"
          style={{ width: 44, height: 44, borderRadius: T.rMd, color: T.text2 }}
        >
          <ChevronRightIcon />
        </Pressable>
      </div>

      {/* Weekday header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          marginBottom: 6,
        }}
      >
        {WEEKDAYS_PL.map((w) => (
          <div
            key={w}
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: T.text3,
              textAlign: "center",
              padding: "2px 0",
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day cells.
          Touch height is 48 px. The WIDTH cannot reach 44 px: seven columns plus
          gaps do not fit on a 320 px screen, so the cell is tall instead of square. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
        }}
      >
        {cells.map((cell, idx) => {
          if (!cell.iso) {
            return <div key={`empty-${idx}`} style={{ minHeight: 48 }} />;
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
            dotColor = balance > 0 ? DANGER : balance < 0 ? SUCCESS : T.text4;
          }

          return (
            <button
              key={cell.iso}
              className="pressable"
              onClick={() => {
                if (isFuture) return;
                haptic.selection();
                onPick(cell.iso!);
              }}
              disabled={isFuture}
              aria-pressed={isSelected}
              style={{
                minHeight: 48,
                border: isToday
                  ? "1px solid var(--border-accent)"
                  : "1px solid transparent",
                borderRadius: T.rSm,
                background: isSelected
                  ? T.surface3
                  : hasData && !isFuture
                    ? T.surface2
                    : "transparent",
                boxShadow: isSelected ? "var(--glow-accent-soft)" : "none",
                cursor: isFuture ? "default" : "pointer",
                opacity: isFuture ? 0.4 : 1,
                color: isSelected
                  ? "var(--accent-text)"
                  : isToday
                    ? T.text
                    : T.text2,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                fontSize: 15,
                fontWeight: isToday || isSelected ? 700 : 500,
                fontVariantNumeric: "tabular-nums",
                fontFamily: "inherit",
              }}
            >
              <span>{cell.dayNum}</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: dotColor ?? "transparent",
                }}
              />
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 12,
          ...TYPO.footnote,
          color: T.text3,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: SUCCESS }} />
          deficyt
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: DANGER }} />
          nadwyżka
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "transparent",
              border: `1px solid ${T.borderStrong}`,
            }}
          />
          brak danych
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Selected day detail                                                */
/* ------------------------------------------------------------------ */

function DayDetail({ day }: { day: CalendarDay }) {
  const totals = day.totals;
  const balance = day.balance;
  const balanceColor = balance > 0 ? DANGER_TEXT : SUCCESS_TEXT;

  return (
    <Card>
      <h3 style={{ ...TYPO.title3, color: T.text, margin: "0 0 4px" }}>
        {fmtFullDate(day.date)}
      </h3>
      <div style={{ ...TYPO.footnote, color: T.text3, marginBottom: 16 }}>
        {day.mealCount === 0
          ? "Brak posiłków tego dnia"
          : `${day.mealCount} ${day.mealCount === 1 ? "posiłek" : "posiłki/-ów"}`}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          padding: `${T.sp3} 0`,
          borderTop: `1px solid ${T.border}`,
          borderBottom: `1px solid ${T.border}`,
          marginBottom: 16,
        }}
      >
        <MiniStat label="Zjedzone" value={totals.calories} />
        <MiniStat label="Spalone" value={day.caloriesBurned} />
        <MiniStat label="Bilans" value={balance} color={balanceColor} signed />
      </div>

      {totals.calories > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
          <MacroBar
            label="Białko"
            grams={totals.protein}
            kcalPerGram={4}
            totalKcal={totals.calories || 1}
            color={HUE_PROTEIN}
          />
          <MacroBar
            label="Węglowodany"
            grams={totals.carbs}
            kcalPerGram={4}
            totalKcal={totals.calories || 1}
            color={HUE_CARBS}
          />
          <MacroBar
            label="Tłuszcze"
            grams={totals.fat}
            kcalPerGram={9}
            totalKcal={totals.calories || 1}
            color={HUE_FAT}
          />
        </div>
      )}

      {day.meals.length > 0 && (
        <div className="anim-stagger" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {day.meals.map((m) => (
            <ListRow
              key={m.id}
              minHeight={48}
              leading={
                <span
                  style={{
                    width: 44,
                    textAlign: "center",
                    ...TYPO.footnote,
                    fontWeight: 600,
                    color: T.text3,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {m.time}
                </span>
              }
              title={m.name}
              trailing={
                <span
                  style={{
                    ...TYPO.footnote,
                    fontWeight: 700,
                    color: T.text2,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round(m.calories ?? 0)} kcal
                </span>
              }
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Chart helpers                                                      */
/* ------------------------------------------------------------------ */

const WEEKDAY_SHORT_PL = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "Sb"];

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_SHORT_PL[date.getDay()]} ${d}`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}.${String(m).padStart(2, "0")}`;
}

/* Catmull-Rom -> SVG path (smooth curve through points) */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Card header shared by both charts. */
function ChartHeader({
  title,
  subtitle,
  legend,
}: {
  title: string;
  subtitle: React.ReactNode;
  legend?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ ...TYPO.title3, color: T.text, margin: 0 }}>{title}</h3>
      <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{subtitle}</div>
      {legend ? (
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 10,
          }}
        >
          {legend}
        </div>
      ) : null}
    </div>
  );
}

function LegendDot({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...TYPO.footnote,
        fontWeight: 600,
        color: T.text2,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Balance bars chart - last 14 days, horizontal bars                 */
/*  The viewBox is deliberately narrow (320): the SVG is drawn at      */
/*  roughly its real width, so 12 px inside it stays 11 px on screen.  */
/* ------------------------------------------------------------------ */

function BalanceBarsChart({
  days,
  targetDeficit = 500,
}: {
  days: CalendarDay[];
  targetDeficit?: number;
}) {
  // Last 14 past days
  const last14 = days.slice(-14);
  if (last14.length === 0) {
    return (
      <Card>
        <ChartHeader title="Bilans tygodnia" subtitle="ostatnie 14 dni" />
        <div style={{ ...TYPO.callout, color: T.text3, textAlign: "center", padding: "20px 0" }}>
          Brak danych
        </div>
      </Card>
    );
  }

  // balance > 0 = surplus (ate more than burned) -> red, bad for cut
  // balance < 0 = deficit (burned more) -> green, good for cut
  const maxAbs = Math.max(targetDeficit, ...last14.map((d) => Math.abs(d.balance)), 100);

  // Sum stats
  const totalBalance = last14.reduce((acc, d) => acc + d.balance, 0);
  const avgBalance = totalBalance / last14.length;
  const deficitDays = last14.filter((d) => d.balance < 0).length;

  // Layout (vertical list - one row per day)
  const rowH = 20;
  const gap = 6;
  const labelW = 42; // left day label
  const valueW = 46; // right kcal value
  const padX = 4;
  const padTop = 36; // space for top scale + target marker
  const padBottom = 8;

  const viewW = 320;
  const plotX = padX + labelW + 6;
  const plotW = viewW - plotX - valueW - padX - 4;
  const centerX = plotX + plotW / 2;

  const viewH = padTop + last14.length * (rowH + gap) - gap + padBottom;

  const xForBar = (kcal: number) => {
    // kcal positive (surplus) -> bar to the LEFT (red)
    // kcal negative (deficit) -> bar to the RIGHT (green)
    const clamped = Math.max(-maxAbs, Math.min(maxAbs, kcal));
    return centerX - (clamped / maxAbs) * (plotW / 2);
  };

  const targetMarkerX = xForBar(-targetDeficit); // target: -500 kcal -> right side

  return (
    <Card>
      <ChartHeader
        title="Bilans tygodnia"
        subtitle={
          <>
            ostatnie {last14.length} dni · cel:{" "}
            <strong style={{ color: SUCCESS_TEXT }}>−{targetDeficit} kcal/dzień</strong>
          </>
        }
      />

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: `${T.sp3} 0`,
          borderTop: `1px solid ${T.border}`,
          borderBottom: `1px solid ${T.border}`,
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Średnia</div>
          <span className="tile-num" style={{ color: avgBalance <= 0 ? SUCCESS_TEXT : DANGER_TEXT }}>
            {avgBalance >= 0 ? "+" : ""}
            {Math.round(avgBalance)}
          </span>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Dni deficytu</div>
          <span className="tile-num" style={{ color: T.text }}>
            {deficitDays}
            <span style={{ color: T.text3 }}>/{last14.length}</span>
          </span>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Suma</div>
          <span
            className="tile-num"
            style={{ color: totalBalance <= 0 ? SUCCESS_TEXT : DANGER_TEXT }}
          >
            {totalBalance >= 0 ? "+" : ""}
            {Math.round(totalBalance)}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Top labels: left = nadwyżka (red), right = deficyt (green) */}
        <text x={plotX} y={12} fontSize={12} fontWeight={700} fill={DANGER_TEXT} textAnchor="start">
          ◄ nadwyżka
        </text>
        <text
          x={plotX + plotW}
          y={12}
          fontSize={12}
          fontWeight={700}
          fill={SUCCESS_TEXT}
          textAnchor="end"
        >
          deficyt ►
        </text>

        {/* Top scale ticks */}
        {[-maxAbs, 0, maxAbs].map((v, i) => {
          const x = xForBar(v);
          return (
            <g key={i}>
              <line
                x1={x}
                x2={x}
                y1={padTop - 8}
                y2={padTop - 4}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text x={x} y={padTop - 12} fontSize={12} fill={T.text3} textAnchor="middle">
                {v === 0 ? "0" : v > 0 ? `−${Math.round(v)}` : `+${Math.round(-v)}`}
              </text>
            </g>
          );
        })}

        {/* Center axis line */}
        <line
          x1={centerX}
          x2={centerX}
          y1={padTop - 4}
          y2={viewH - padBottom}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />

        {/* Target marker line (cel: -500 kcal deficyt) */}
        {targetMarkerX > plotX && targetMarkerX < plotX + plotW && (
          <g>
            <line
              x1={targetMarkerX}
              x2={targetMarkerX}
              y1={padTop - 4}
              y2={viewH - padBottom}
              stroke={SUCCESS}
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.6}
            />
            <text
              x={targetMarkerX}
              y={padTop - 24}
              fontSize={12}
              fill={SUCCESS_TEXT}
              fontWeight={700}
              textAnchor="middle"
            >
              cel
            </text>
          </g>
        )}

        {/* Day rows */}
        {last14.map((d, i) => {
          const y = padTop + i * (rowH + gap);
          const cy = y + rowH / 2;
          const noData = !d.hasData || (d.balance === 0 && d.totals.calories === 0);

          // Bar geometry
          const barX = xForBar(d.balance);
          const isDeficit = d.balance < 0;
          const isSurplus = d.balance > 0;
          const x1 = Math.min(centerX, barX);
          const x2 = Math.max(centerX, barX);
          const barColor = isDeficit ? SUCCESS : isSurplus ? DANGER : T.text4;

          return (
            <g key={d.date}>
              {/* Day label */}
              <text
                x={padX + labelW}
                y={cy + 4}
                fontSize={12}
                fill={T.text2}
                fontWeight={600}
                textAnchor="end"
              >
                {dayLabel(d.date)}
              </text>

              {/* Row background */}
              <rect
                x={plotX}
                y={y + 1}
                width={plotW}
                height={rowH - 2}
                fill="var(--surface-2)"
                rx={4}
              />

              {/* Bar */}
              {!noData && (
                <rect
                  x={x1}
                  y={y + 3}
                  width={Math.max(2, x2 - x1)}
                  height={rowH - 6}
                  fill={barColor}
                  fillOpacity={0.92}
                  rx={3}
                />
              )}

              {noData && (
                <text x={centerX + 6} y={cy + 4} fontSize={12} fill={T.text3}>
                  brak danych
                </text>
              )}

              {/* Right-side value label */}
              {!noData && (
                <text
                  x={viewW - padX}
                  y={cy + 4}
                  fontSize={12}
                  fill={isDeficit ? SUCCESS_TEXT : DANGER_TEXT}
                  fontWeight={700}
                  textAnchor="end"
                >
                  {d.balance > 0 ? "+" : ""}
                  {Math.round(d.balance)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Burn vs Eat line chart - last 30 days, smooth curves + BMR ref     */
/* ------------------------------------------------------------------ */

function BurnEatLineChart({ days, bmr }: { days: CalendarDay[]; bmr: number }) {
  const data = days.slice(-30);
  if (data.length === 0) {
    return (
      <Card>
        <ChartHeader title="Spalanie vs jedzenie" subtitle="ostatnie 30 dni" />
        <div style={{ ...TYPO.callout, color: T.text3, textAlign: "center", padding: "20px 0" }}>
          Brak danych
        </div>
      </Card>
    );
  }

  const eaten = data.map((d) => d.totals.calories);
  const burned = data.map((d) => d.caloriesBurned);
  const rawMax = Math.max(...eaten, ...burned, bmr || 0);
  const yMaxBase = rawMax + 200;
  // Round up to nearest 500 for nicer ticks
  const yMax = Math.ceil(yMaxBase / 500) * 500;
  const yMin = 0;

  const viewW = 320;
  const viewH = 210;
  const padL = 38;
  const padR = 8;
  const padT = 16;
  const padB = 26;
  const plotW = viewW - padL - padR;
  const plotH = viewH - padT - padB;

  const xFor = (i: number) =>
    data.length === 1 ? padL + plotW / 2 : padL + (i / (data.length - 1)) * plotW;
  const yFor = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const eatenPts = data.map((d, i) => ({ x: xFor(i), y: yFor(d.totals.calories) }));
  const burnedPts = data.map((d, i) => ({ x: xFor(i), y: yFor(d.caloriesBurned) }));

  const eatenPath = smoothPath(eatenPts);
  const burnedPath = smoothPath(burnedPts);

  // Area between curves (filled green where eaten < burned, red where eaten > burned)
  type Seg = { x: number; ey: number; by: number; e: number; b: number };
  const segs: Seg[] = data.map((d, i) => ({
    x: xFor(i),
    ey: yFor(d.totals.calories),
    by: yFor(d.caloriesBurned),
    e: d.totals.calories,
    b: d.caloriesBurned,
  }));

  const greenAreas: string[] = [];
  const redAreas: string[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i];
    const c = segs[i + 1];
    const aDiff = a.e - a.b; // >0 surplus (red), <0 deficit (green)
    const cDiff = c.e - c.b;

    if (aDiff <= 0 && cDiff <= 0) {
      greenAreas.push(`M ${a.x} ${a.by} L ${c.x} ${c.by} L ${c.x} ${c.ey} L ${a.x} ${a.ey} Z`);
    } else if (aDiff >= 0 && cDiff >= 0) {
      redAreas.push(`M ${a.x} ${a.by} L ${c.x} ${c.by} L ${c.x} ${c.ey} L ${a.x} ${a.ey} Z`);
    } else {
      // crossing - interpolate
      const t = aDiff / (aDiff - cDiff);
      const cx = a.x + (c.x - a.x) * t;
      const cy = a.ey + (c.ey - a.ey) * t; // same as a.by + (c.by-a.by)*t - they meet here
      if (aDiff < 0) {
        greenAreas.push(`M ${a.x} ${a.by} L ${cx} ${cy} L ${a.x} ${a.ey} Z`);
        redAreas.push(`M ${cx} ${cy} L ${c.x} ${c.by} L ${c.x} ${c.ey} Z`);
      } else {
        redAreas.push(`M ${a.x} ${a.by} L ${cx} ${cy} L ${a.x} ${a.ey} Z`);
        greenAreas.push(`M ${cx} ${cy} L ${c.x} ${c.by} L ${c.x} ${c.ey} Z`);
      }
    }
  }

  // Y axis tick marks every 500 kcal
  const ticks: number[] = [];
  for (let v = 0; v <= yMax; v += 500) ticks.push(v);

  // X axis labels every 7th day
  const xLabels: Array<{ i: number; label: string }> = [];
  for (let i = 0; i < data.length; i += 7) {
    xLabels.push({ i, label: shortDate(data[i].date) });
  }
  if (xLabels[xLabels.length - 1]?.i !== data.length - 1) {
    xLabels.push({ i: data.length - 1, label: shortDate(data[data.length - 1].date) });
  }

  // BMR reference line position
  const bmrY = bmr > 0 && bmr <= yMax ? yFor(bmr) : null;

  return (
    <Card>
      <ChartHeader
        title="Spalanie vs jedzenie"
        subtitle={`ostatnie ${data.length} dni`}
        legend={
          <>
            <LegendDot color={HUE_CARBS}>Spalanie</LegendDot>
            <LegendDot color={HUE_PROTEIN}>Zjedzone</LegendDot>
          </>
        }
      />

      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <defs>
          <linearGradient id="dietGreenArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SUCCESS} stopOpacity={0.3} />
            <stop offset="100%" stopColor={SUCCESS} stopOpacity={0.06} />
          </linearGradient>
          <linearGradient id="dietRedArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={DANGER} stopOpacity={0.3} />
            <stop offset="100%" stopColor={DANGER} stopOpacity={0.06} />
          </linearGradient>
        </defs>

        {/* Y grid + labels */}
        {ticks.map((v) => {
          const y = yFor(v);
          return (
            <g key={v}>
              <line
                x1={padL}
                x2={padL + plotW}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray={v === 0 ? "0" : "2 4"}
              />
              <text x={padL - 6} y={y + 4} fontSize={12} fill={T.text3} textAnchor="end">
                {v}
              </text>
            </g>
          );
        })}

        {/* X axis labels */}
        {xLabels.map((l, idx) => (
          <text
            key={`xl-${idx}`}
            x={xFor(l.i)}
            y={viewH - padB + 16}
            fontSize={12}
            fill={T.text3}
            textAnchor="middle"
          >
            {l.label}
          </text>
        ))}

        {/* Area between curves */}
        {greenAreas.map((p, i) => (
          <path key={`ga-${i}`} d={p} fill="url(#dietGreenArea)" />
        ))}
        {redAreas.map((p, i) => (
          <path key={`ra-${i}`} d={p} fill="url(#dietRedArea)" />
        ))}

        {/* BMR reference line */}
        {bmrY !== null && (
          <g>
            <line
              x1={padL}
              x2={padL + plotW}
              y1={bmrY}
              y2={bmrY}
              stroke="var(--text-4)"
              strokeWidth={1.2}
              strokeDasharray="5 4"
            />
            <rect
              x={padL + plotW - 86}
              y={bmrY - 15}
              width={86}
              height={16}
              rx={4}
              fill="var(--surface-2)"
            />
            <text
              x={padL + plotW - 43}
              y={bmrY - 3}
              fontSize={12}
              fill={T.text3}
              textAnchor="middle"
              fontWeight={600}
            >
              BMR {bmr} kcal
            </text>
          </g>
        )}

        {/* Burned curve */}
        <path
          d={burnedPath}
          fill="none"
          stroke={HUE_CARBS}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Eaten curve */}
        <path
          d={eatenPath}
          fill="none"
          stroke={HUE_PROTEIN}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data point dots (every 7th day + last) */}
        {data.map((d, i) => {
          if (i % 7 !== 0 && i !== data.length - 1) return null;
          return (
            <g key={`pt-${i}`}>
              <circle cx={xFor(i)} cy={yFor(d.caloriesBurned)} r={3} fill={HUE_CARBS} />
              <circle cx={xFor(i)} cy={yFor(d.totals.calories)} r={3} fill={HUE_PROTEIN} />
            </g>
          );
        })}
      </svg>

      {/* Legend hint for the shaded area */}
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 12,
          ...TYPO.footnote,
          color: T.text3,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              background: SUCCESS,
              opacity: 0.3,
              borderRadius: 3,
            }}
          />
          zielony = deficyt
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              background: DANGER,
              opacity: 0.3,
              borderRadius: 3,
            }}
          />
          czerwony = nadwyżka
        </span>
      </div>
    </Card>
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

  const openAdd = useCallback(() => {
    haptic.impact();
    setTime(nowHHMM());
    setShowAdd(true);
  }, []);

  const closeAdd = useCallback(() => {
    resetForm();
    setShowAdd(false);
  }, [resetForm]);

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
      haptic.success();
      showToast("Oszacowano przez AI");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bład AI";
      haptic.error();
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
        haptic.success();
        showToast("Rozpoznano ze zdjęcia");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Błąd rozpoznawania";
        haptic.error();
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
      haptic.success();
      showToast("Dodano posiłek");
      resetForm();
      setShowAdd(false);
      fetchToday();
      if (tab === "calendar") {
        fetchMonth(calYear, calMonth);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bład zapisu";
      haptic.error();
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

  // Build the chart series (past days of the loaded month)
  const chartSeries = useMemo(() => {
    if (!monthData) return null;
    return monthData.days.filter((d) => !d.isFuture);
  }, [monthData]);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  const PAGE_STYLE: React.CSSProperties = {
    padding: `20px var(--gutter) 24px`,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  };

  if (loading) {
    // Skeleton in the shape of the real screen, never a spinner.
    return (
      <div style={PAGE_STYLE}>
        <div>
          <Skeleton variant="line" width="45%" height={12} />
          <Skeleton variant="line" width="60%" height={28} style={{ marginTop: 10 }} />
        </div>
        <Skeleton variant="block" height={48} radius={T.rLg} />
        <Card variant="hero" padding="lg">
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Skeleton variant="circle" height={190} />
          </div>
        </Card>
        <Skeleton variant="card" count={3} />
        <Skeleton variant="card" count={2} />
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
  const over = remaining < 0;
  const targetCalories = today?.targetCalories ?? 2500;
  const meals = today?.meals ?? [];
  const tabIndex = Math.max(0, TAB_KEYS.indexOf(tab));

  const todayPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 1. HERO - one big number per screen */}
      <Reveal index={0}>
        <Card variant="hero" padding="lg">
          <CalorieRing eaten={eaten} burned={burnedToday} />

          <p
            style={{
              ...TYPO.callout,
              color: T.text2,
              textAlign: "center",
              margin: "16px auto 0",
              maxWidth: 280,
            }}
          >
            {over
              ? "Zjadłeś więcej, niż dziś spaliłeś."
              : eaten === 0
                ? "Jeszcze nic dziś nie zapisałeś."
                : "Tyle możesz jeszcze zjeść do końca dnia."}
          </p>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 20,
              paddingTop: 16,
              borderTop: `1px solid ${T.border}`,
            }}
          >
            <MiniStat label="Zjedzone" value={eaten} />
            <MiniStat label="Spalone" value={burnedToday} />
          </div>
        </Card>
      </Reveal>

      {/* 2. MACROS */}
      <Reveal index={1}>
        <Card>
          <h2 style={{ ...TYPO.title3, color: T.text, margin: "0 0 16px" }}>Makroskładniki</h2>
          {eaten > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <MacroBar
                label="Białko"
                grams={totals.protein}
                kcalPerGram={4}
                totalKcal={totals.calories || 1}
                color={HUE_PROTEIN}
              />
              <MacroBar
                label="Węglowodany"
                grams={totals.carbs}
                kcalPerGram={4}
                totalKcal={totals.calories || 1}
                color={HUE_CARBS}
              />
              <MacroBar
                label="Tłuszcze"
                grams={totals.fat}
                kcalPerGram={9}
                totalKcal={totals.calories || 1}
                color={HUE_FAT}
              />
            </div>
          ) : (
            <p style={{ ...TYPO.callout, color: T.text3, margin: 0 }}>
              Dodaj pierwszy posiłek, a zobaczysz tu rozbicie na białko, węgle i tłuszcze.
            </p>
          )}
        </Card>
      </Reveal>

      {/* 3. MEALS */}
      <Reveal index={2}>
        <Card>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: meals.length > 0 ? 8 : 0,
            }}
          >
            <h2 style={{ ...TYPO.title3, color: T.text, margin: 0 }}>Posiłki dziś</h2>
            {meals.length > 0 && (
              <span style={{ ...TYPO.footnote, color: T.text3 }}>{meals.length}</span>
            )}
          </div>

          {meals.length === 0 ? (
            <EmptyState
              compact
              icon={<PlateIcon />}
              title="Brak posiłków na dziś"
              body="Zapisz, co zjadłeś. AI oszacuje kalorie z opisu albo ze zdjęcia."
              action={{ label: "Dodaj posiłek", onPress: openAdd }}
            />
          ) : (
            <div
              className="anim-stagger"
              style={{ display: "flex", flexDirection: "column", gap: 2 }}
            >
              {meals.map((m) => (
                <ListRow
                  key={m.id}
                  leading={
                    <span
                      style={{
                        width: 44,
                        textAlign: "center",
                        ...TYPO.footnote,
                        fontWeight: 600,
                        color: T.text3,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {m.time}
                    </span>
                  }
                  title={m.name}
                  subtitle={
                    <span
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginTop: 4,
                      }}
                    >
                      <Chip strong>{Math.round(m.calories ?? 0)} kcal</Chip>
                      <Chip>B {Math.round(m.protein ?? 0)}g</Chip>
                      <Chip>W {Math.round(m.carbs ?? 0)}g</Chip>
                      <Chip>T {Math.round(m.fat ?? 0)}g</Chip>
                    </span>
                  }
                  trailing={
                    <Pressable
                      stopPropagation
                      haptic="warning"
                      onPress={() => handleDelete(m.id)}
                      ariaLabel={`Usuń posiłek ${m.name}`}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: T.rFull,
                        color: T.text3,
                      }}
                    >
                      <TrashIcon />
                    </Pressable>
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </Reveal>

      {/* 4. BURN BREAKDOWN - the quiet detail card, not a hero */}
      <Reveal index={3}>
        <Card>
          <h2 style={{ ...TYPO.title3, color: T.text, margin: "0 0 4px" }}>Skąd to spalanie</h2>
          <div style={{ ...TYPO.footnote, color: T.text3, marginBottom: 4 }}>
            BMR liczony do tej godziny plus ukończone aktywności
          </div>

          <DetailRow
            label="BMR (spoczynkowe)"
            hint="pełna doba"
            value={`${Math.round(bmrDaily)} kcal`}
          />
          <DetailRow
            label="BMR do tej godziny"
            value={`${Math.round(bmrSoFar)} kcal`}
          />
          <DetailRow
            label="Aktywności dziś"
            hint={activityCount > 0 ? `${activityCount} ukończonych` : "brak aktywności"}
            value={`+${Math.round(activityCalories)} kcal`}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minHeight: 44,
              marginTop: 8,
              padding: `${T.sp3} 14px`,
              borderRadius: T.rMd,
              background: T.surface2,
            }}
          >
            <span style={{ ...TYPO.footnote, color: T.text2 }}>Razem spalone</span>
            <span
              style={{
                ...TYPO.body,
                fontWeight: 700,
                color: T.text,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(burnedToday)} kcal
            </span>
          </div>

          <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 12, textAlign: "center" }}>
            Cel dzienny:{" "}
            <span style={{ color: T.text2, fontWeight: 700 }}>{targetCalories} kcal</span>
          </div>
        </Card>
      </Reveal>
    </div>
  );

  const calendarPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {monthLoading && !monthData ? (
        <>
          <Skeleton variant="block" height={320} radius={T.rLg} />
          <Skeleton variant="card" count={3} />
        </>
      ) : (
        <>
          <Reveal index={0}>
            <CalendarView
              year={calYear}
              monthIdx={calMonth}
              daysByDate={daysByDate}
              onPrev={handlePrevMonth}
              onNext={handleNextMonth}
              onPick={(iso) => setSelectedDate(iso === selectedDate ? null : iso)}
              selectedDate={selectedDate}
            />
          </Reveal>

          {selectedDay ? (
            <Reveal index={1}>
              <DayDetail day={selectedDay} />
            </Reveal>
          ) : (
            <Reveal index={1}>
              <Card>
                <EmptyState
                  compact
                  icon={<CalendarIcon />}
                  title="Wybierz dzień"
                  body="Dotknij kafelka w kalendarzu, żeby zobaczyć posiłki i bilans tego dnia."
                />
              </Card>
            </Reveal>
          )}

          {chartSeries && chartSeries.length > 0 && (
            <>
              <Reveal index={2}>
                <BalanceBarsChart days={chartSeries} />
              </Reveal>
              <Reveal index={3}>
                <BurnEatLineChart days={chartSeries} bmr={monthData?.bmr ?? 0} />
              </Reveal>
            </>
          )}
        </>
      )}
    </div>
  );

  return (
    <div style={PAGE_STYLE}>
      {/* HEADER - overline, one big title, one quiet sentence */}
      <header className="anim-in">
        <div style={{ ...TYPO.label, color: T.text3 }}>
          {fmtHeaderDate(today?.date ?? todayIso())}
        </div>
        <h1 style={{ ...TYPO.title1, color: T.text, margin: "6px 0 0" }}>Dieta</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: "4px 0 0" }}>
          Posiłki i bilans kaloryczny dnia
        </p>
      </header>

      <SegmentedTabs<Tab>
        tabs={TABS}
        active={tab}
        onChange={setTab}
        ariaLabel="Widok diety"
      />

      <SwipeDeck
        index={tabIndex}
        onChange={(i) => setTab(TAB_KEYS[i] ?? "today")}
        labels={TABS.map((t) => t.label)}
        enabled={!showAdd}
      >
        {todayPanel}
        {calendarPanel}
      </SwipeDeck>

      {/* Floating "add meal" - always within thumb reach, never 700 px down the page */}
      {tab === "today" && !showAdd && (
        <BodyPortal>
          <Pressable
            onPress={openAdd}
            haptic="impact"
            ariaLabel="Dodaj posiłek"
            style={{
              position: "fixed",
              right: "max(16px, calc(50vw - 199px))",
              bottom: "calc(var(--above-tabbar) + 8px)",
              width: 56,
              height: 56,
              borderRadius: T.rFull,
              background: "var(--grad-accent)",
              color: "var(--accent-ink)",
              boxShadow: "var(--glow-accent-cta)",
              zIndex: 60,
            }}
          >
            <PlusIcon />
          </Pressable>
        </BodyPortal>
      )}

      {/* NEW MEAL - bottom sheet (portal, so the deck cannot clip it) */}
      <Sheet
        open={showAdd}
        onClose={closeAdd}
        title="Nowy posiłek"
        footer={
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 12 }}>
            <Button variant="secondary" size="lg" fullWidth disabled={saving} onPress={closeAdd}>
              Anuluj
            </Button>
            <Button size="lg" fullWidth loading={saving} onPress={handleSave}>
              Zapisz posiłek
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 104px", gap: 12 }}>
            <Field label="Nazwa">
              {(p) => (
                <input
                  {...p}
                  style={fieldControlStyle}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Obiad: kurczak z ryżem"
                />
              )}
            </Field>
            <Field label="Godzina">
              {(p) => (
                <input
                  {...p}
                  style={fieldControlStyle}
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="Opis (dla AI)">
            <VoiceTextarea
              value={description}
              onChange={setDescription}
              placeholder="np. 100g kurczaka i 200g ryżu"
              minHeight={96}
              style={{ fontSize: 17 }}
            />
          </Field>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            style={{ display: "none" }}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              loading={estimating}
              disabled={recognizing || (!description.trim() && !name.trim())}
              onPress={handleEstimate}
            >
              Oszacuj kalorie z AI
            </Button>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              loading={recognizing}
              disabled={estimating}
              onPress={handlePhotoClick}
            >
              Zrób zdjęcie posiłku
            </Button>
          </div>

          {recognizing && (
            <Card variant="inset" padding="sm">
              <div style={{ ...TYPO.footnote, color: T.text2 }}>
                Analizuję zdjęcie posiłku (może potrwać 5–10 s)...
              </div>
              <Skeleton variant="line" count={2} style={{ marginTop: 8 }} />
            </Card>
          )}

          {visionInfo && !recognizing && (
            <Card variant="inset" padding="sm">
              <div style={{ ...TYPO.footnote, color: T.text2 }}>
                Rozpoznano: {visionInfo.foods.join(", ") || "—"}
              </div>
              <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 4 }}>
                Pewność:{" "}
                <strong
                  style={{
                    color:
                      visionInfo.confidence === "high"
                        ? SUCCESS_TEXT
                        : visionInfo.confidence === "medium"
                          ? "var(--accent-text)"
                          : DANGER_TEXT,
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
                <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 4 }}>
                  {visionInfo.notes}
                </div>
              )}
            </Card>
          )}

          {estimateInfo && !visionInfo && (
            <Card variant="inset" padding="sm">
              <div style={{ ...TYPO.footnote, color: T.text2 }}>
                AI rozpoznało: {estimateInfo.foods.join(", ") || "—"}
              </div>
            </Card>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Kalorie (kcal)">
              {(p) => (
                <input
                  {...p}
                  style={fieldControlStyle}
                  type="number"
                  inputMode="numeric"
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  placeholder="0"
                />
              )}
            </Field>
            <Field label="Białko (g)">
              {(p) => (
                <input
                  {...p}
                  style={fieldControlStyle}
                  type="number"
                  inputMode="numeric"
                  value={protein}
                  onChange={(e) => setProtein(e.target.value)}
                  placeholder="0"
                />
              )}
            </Field>
            <Field label="Węgle (g)">
              {(p) => (
                <input
                  {...p}
                  style={fieldControlStyle}
                  type="number"
                  inputMode="numeric"
                  value={carbs}
                  onChange={(e) => setCarbs(e.target.value)}
                  placeholder="0"
                />
              )}
            </Field>
            <Field label="Tłuszcz (g)">
              {(p) => (
                <input
                  {...p}
                  style={fieldControlStyle}
                  type="number"
                  inputMode="numeric"
                  value={fat}
                  onChange={(e) => setFat(e.target.value)}
                  placeholder="0"
                />
              )}
            </Field>
          </div>
        </div>
      </Sheet>

      {/* Toast */}
      {toast && (
        <BodyPortal>
          <div
            className="fade-scale"
            role="status"
            style={{
              position: "fixed",
              bottom: "calc(var(--above-tabbar) + 16px)",
              left: "50%",
              transform: "translateX(-50%)",
              background: T.text,
              color: T.bg,
              padding: "12px 20px",
              borderRadius: T.rFull,
              ...TYPO.footnote,
              fontWeight: 700,
              zIndex: 100,
              maxWidth: "92vw",
              textAlign: "center",
              boxShadow: T.elev3,
            }}
          >
            {toast}
          </div>
        </BodyPortal>
      )}
    </div>
  );
}

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

/**
 * One meal proposal, or one dish already saved in the library.
 *
 * `id` is the tell: a fresh proposal from the dietitian has none, because
 * nothing is written to the database until the user rates or saves the card.
 * Every action therefore has two paths: PATCH when the row exists, POST (upsert
 * on title) when it does not.
 */
interface MealIdeaItem {
  id?: string;
  title: string;
  description: string | null;
  ingredients: string[];
  steps: string[];
  prepMinutes: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  tags: string[];
  source: string;
  sourceUrl: string | null;
  /** -1 = nie dla mnie, 0 = bez zdania, 1 = lubię to */
  rating: number;
  favorite: boolean;
  timesCooked: number;
}

type Tab = "today" | "ideas" | "calendar";

const TAB_KEYS: readonly Tab[] = ["today", "ideas", "calendar"] as const;
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "today", label: "Dzisiaj" },
  { key: "ideas", label: "Pomysły" },
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

const CheckIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="4 12 9 17 20 6" />
  </Icon>
);

const ThumbUpIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3z" />
    <path d="M7 10l4-7a2 2 0 0 1 3 2l-1 5h5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 16.6 21H7" />
  </Icon>
);

const ThumbDownIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3z" />
    <path d="M17 14l-4 7a2 2 0 0 1-3-2l1-5H6a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 7.4 3H17" />
  </Icon>
);

const StarIcon = ({ size = 20, filled = false }: { size?: number; filled?: boolean }) => (
  <svg
    aria-hidden="true"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: "block", flexShrink: 0 }}
  >
    <polygon points="12 3 14.9 9.2 21.5 10 16.7 14.6 17.9 21.2 12 18 6.1 21.2 7.3 14.6 2.5 10 9.1 9.2" />
  </svg>
);

const PotIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 9h16v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z" />
    <path d="M2 9h20" />
    <path d="M8 5c0-1 1-1.5 1-2.5M12 5c0-1 1-1.5 1-2.5M16 5c0-1 1-1.5 1-2.5" />
  </Icon>
);

const CartIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="18" cy="20" r="1.4" />
    <path d="M2 3h2.5l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" />
  </Icon>
);

const SparkIcon = ({ size = 26 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 3l1.8 4.9L18.7 9.7 13.8 11.5 12 16.4 10.2 11.5 5.3 9.7 10.2 7.9z" />
    <path d="M18.5 15.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" />
  </Icon>
);

const LinkIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" />
    <path d="M14 11a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7" />
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
/*  Meal ideas                                                         */
/* ------------------------------------------------------------------ */

/** `ingredients` and `steps` arrive as Prisma Json, so they can be anything. */
function jsonStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Normalises both API shapes (fresh suggestion and saved row) into one type. */
function toIdeaItem(raw: unknown): MealIdeaItem {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof o.id === "string" ? o.id : undefined,
    title: typeof o.title === "string" ? o.title : "",
    description: typeof o.description === "string" ? o.description : null,
    ingredients: jsonStrings(o.ingredients),
    steps: jsonStrings(o.steps),
    prepMinutes: numOrNull(o.prepMinutes),
    calories: numOrNull(o.calories),
    protein: numOrNull(o.protein),
    carbs: numOrNull(o.carbs),
    fat: numOrNull(o.fat),
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [],
    source: typeof o.source === "string" ? o.source : "ai",
    sourceUrl: typeof o.sourceUrl === "string" && o.sourceUrl ? o.sourceUrl : null,
    rating: typeof o.rating === "number" ? o.rating : 0,
    favorite: o.favorite === true,
    timesCooked: typeof o.timesCooked === "number" ? o.timesCooked : 0,
  };
}

/**
 * Shopping-list grouping.
 *
 * Deliberately a plain keyword table and not another AI call: the list is built
 * while the user is standing in the shop, it has to appear instantly and give
 * the same answer every time. An unknown ingredient falls into "Reszta" rather
 * than being dropped.
 */
const SHOP_GROUPS: ReadonlyArray<{ label: string; keywords: readonly string[] }> = [
  {
    label: "Mięso i ryby",
    keywords: [
      // Substrings have to be long enough to be unambiguous: "mielon" would
      // also swallow "papryka mielona", so only the meat forms are listed.
      "kurczak", "pierś", "piers", "indyk", "wołowin", "wolowin", "wieprz", "schab",
      "mielone", "mielony", "szynka", "boczek", "łosoś", "losos", "tuńczyk", "tunczyk",
      "ryba", "dorsz", "krewetk", "kiełbas", "kielbas",
    ],
  },
  {
    label: "Nabiał i jajka",
    keywords: [
      // "ser" alone would also catch "seler", hence the longer forms.
      "jajk", "jaja", "twaróg", "twarog", "ser ", "sera ", "serek", "sery",
      "mozzarell", "feta", "jogurt", "kefir", "mleko", "śmietan", "smietan",
      "masło", "maslo", "skyr",
    ],
  },
  {
    label: "Warzywa i owoce",
    keywords: [
      "pomidor", "ogórek", "ogorek", "papryk", "cebul", "czosnek", "marchew", "brokuł",
      "brokul", "kalafior", "szpinak", "sałat", "salat", "rukol", "cukini", "bakłażan",
      "baklazan", "fasolk", "groszek", "kapust", "por ", "seler", "pieczark", "grzyb",
      "ziemniak", "batat", "banan", "jabłk", "jablk", "truskaw", "malin", "borówk",
      "borowk", "cytryn", "limonk", "awokado", "warzyw", "owoc",
    ],
  },
  {
    label: "Produkty suche i pieczywo",
    keywords: [
      // NOT bare "mak": "sól, pieprz do smaku" contains it and would land here.
      "ryż", "ryz", "makaron", "kasz", "płatk", "platk", "owsian", "chleb", "bułk",
      "bulk", "tortill", "mąk", "maka ", "maki ", "soczewic", "ciecierzyc", "quinoa",
      "komosa", "orzech", "migdał", "migdal", "nasion", "pestk", "puszk", "passat",
      "konserw",
    ],
  },
  {
    label: "Przyprawy i dodatki",
    keywords: [
      "przypraw", "sól", "sol ", "pieprz", "papryka słodka", "curry", "oliw", "olej",
      "ocet", "sos", "musztard", "miód", "miod", "zioł", "ziol", "bazyli", "oregano",
      "koperek", "natka", "szczypior", "czubryc",
    ],
  },
];

const SHOP_FALLBACK = "Reszta";

function shopGroupFor(ingredient: string): string {
  const s = ingredient.toLowerCase();
  for (const group of SHOP_GROUPS) {
    if (group.keywords.some((k) => s.includes(k))) return group.label;
  }
  return SHOP_FALLBACK;
}

interface ShoppingGroup {
  label: string;
  items: Array<{ key: string; text: string; count: number }>;
}

/**
 * Merges the ingredient lines of the picked dishes into one grouped list.
 * Identical lines collapse into a single row with a "x2" counter instead of
 * being repeated, so the same 200 g of chicken is not bought twice.
 */
function buildShoppingList(ideas: MealIdeaItem[]): ShoppingGroup[] {
  const byGroup = new Map<string, Map<string, { text: string; count: number }>>();

  for (const idea of ideas) {
    for (const line of idea.ingredients) {
      const text = line.trim();
      if (!text) continue;
      const group = shopGroupFor(text);
      const key = text.toLowerCase();
      if (!byGroup.has(group)) byGroup.set(group, new Map());
      const bucket = byGroup.get(group)!;
      const found = bucket.get(key);
      if (found) {
        found.count += 1;
      } else {
        bucket.set(key, { text, count: 1 });
      }
    }
  }

  const order = [...SHOP_GROUPS.map((g) => g.label), SHOP_FALLBACK];
  const out: ShoppingGroup[] = [];
  for (const label of order) {
    const bucket = byGroup.get(label);
    if (!bucket || bucket.size === 0) continue;
    out.push({
      label,
      items: [...bucket.entries()].map(([key, v]) => ({ key, text: v.text, count: v.count })),
    });
  }
  return out;
}

function shoppingListToText(groups: ShoppingGroup[]): string {
  return groups
    .map((g) => [g.label, ...g.items.map((i) => `- ${i.text}${i.count > 1 ? ` x${i.count}` : ""}`)].join("\n"))
    .join("\n\n");
}

/** Clipboard with a fallback: iOS Safari blocks the async API outside HTTPS. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Big, unmissable prep-time badge. This is the number that decides everything. */
function MinutesBadge({ minutes }: { minutes: number | null }) {
  if (minutes === null) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 11px",
        borderRadius: T.rFull,
        background: T.accentSoft,
        color: T.accentOnSurface,
        ...TYPO.footnote,
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {Math.round(minutes)} min
    </span>
  );
}

/** Square 44 px checkbox that pulls a dish into the shopping list. */
function PickBox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      haptic="tap"
      ariaLabel={label}
      ariaChecked={checked}
      role="checkbox"
      style={{ width: 44, height: 44, borderRadius: T.rMd, flexShrink: 0 }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: T.rXs,
          border: `2px solid ${checked ? T.accent : T.borderStrong}`,
          background: checked ? T.accent : "transparent",
          color: checked ? "var(--accent-ink, #fff)" : "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background 140ms var(--ease-out), border-color 140ms var(--ease-out)",
        }}
      >
        <CheckIcon size={16} />
      </span>
    </Pressable>
  );
}

/**
 * One dish card.
 *
 * After a verdict the card STAYS on screen and changes state instead of
 * disappearing: the user has to be able to see what he already decided, and a
 * card that vanishes on "nie dla mnie" feels like the app lost his answer.
 */
function IdeaCard({
  idea,
  expanded,
  onToggleExpand,
  picked,
  onTogglePick,
  busy,
  onRate,
  onToggleFavorite,
  onCooked,
}: {
  idea: MealIdeaItem;
  expanded: boolean;
  onToggleExpand: () => void;
  picked: boolean;
  onTogglePick: () => void;
  busy: boolean;
  onRate: (rating: number) => void;
  onToggleFavorite: () => void;
  onCooked: () => void;
}) {
  const liked = idea.rating === 1;
  const disliked = idea.rating === -1;

  return (
    <Card
      style={{
        opacity: disliked ? 0.62 : 1,
        borderColor: liked ? T.borderAccent : undefined,
        transition: "opacity 220ms var(--ease-out)",
      }}
    >
      {/* Head: pick box, title, minutes */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <PickBox
          checked={picked}
          onToggle={onTogglePick}
          label={`Dodaj ${idea.title} do listy zakupów`}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 10,
            }}
          >
            <h3 style={{ ...TYPO.title3, color: T.text, margin: 0, flex: 1, minWidth: 120 }}>
              {idea.title}
            </h3>
            <MinutesBadge minutes={idea.prepMinutes} />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {idea.calories !== null && <Chip strong>{Math.round(idea.calories)} kcal</Chip>}
            {idea.protein !== null && <Chip>B {Math.round(idea.protein)}g</Chip>}
            {idea.timesCooked > 0 && <Chip>gotowane {idea.timesCooked}x</Chip>}
          </div>
        </div>
      </div>

      {idea.description && (
        <p style={{ ...TYPO.callout, color: T.text2, margin: "12px 0 0" }}>{idea.description}</p>
      )}

      {idea.sourceUrl && (
        <a
          href={idea.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginTop: 8,
            minHeight: 44,
            ...TYPO.footnote,
            fontWeight: 700,
            color: T.accentOnSurface,
            textDecoration: "none",
          }}
        >
          <LinkIcon />
          źródło
        </a>
      )}

      {/* Details */}
      <Pressable
        onPress={onToggleExpand}
        haptic="tap"
        ariaExpanded={expanded}
        ariaLabel={expanded ? "Zwiń szczegóły" : "Pokaż składniki i kroki"}
        style={{
          marginTop: 10,
          minHeight: 44,
          width: "100%",
          justifyContent: "flex-start",
          borderRadius: T.rMd,
          ...TYPO.footnote,
          fontWeight: 700,
          color: T.text2,
        }}
      >
        {expanded ? "Zwiń" : "Składniki i kroki"}
      </Pressable>

      {expanded && (
        <div className="anim-in" style={{ marginTop: 4 }}>
          {idea.ingredients.length > 0 && (
            <>
              <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Składniki</div>
              <ul style={{ margin: "0 0 14px", paddingLeft: 18 }}>
                {idea.ingredients.map((ing, i) => (
                  <li key={i} style={{ ...TYPO.callout, color: T.text2, marginBottom: 3 }}>
                    {ing}
                  </li>
                ))}
              </ul>
            </>
          )}
          {idea.steps.length > 0 && (
            <>
              <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Jak zrobić</div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {idea.steps.map((step, i) => (
                  <li key={i} style={{ ...TYPO.callout, color: T.text2, marginBottom: 5 }}>
                    {step}
                  </li>
                ))}
              </ol>
            </>
          )}
          {idea.ingredients.length === 0 && idea.steps.length === 0 && (
            <p style={{ ...TYPO.callout, color: T.text3, margin: 0 }}>
              Ten pomysł nie ma zapisanych szczegółów.
            </p>
          )}
        </div>
      )}

      {/* Verdict - two big targets, always 48 px */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
        <Button
          variant={liked ? "primary" : "secondary"}
          size="md"
          fullWidth
          disabled={busy}
          haptic="success"
          iconLeft={<ThumbUpIcon />}
          onPress={() => onRate(liked ? 0 : 1)}
        >
          {liked ? "Lubię to" : "Lubię to"}
        </Button>
        <Button
          variant="secondary"
          size="md"
          fullWidth
          disabled={busy}
          haptic="warning"
          iconLeft={<ThumbDownIcon />}
          onPress={() => onRate(disliked ? 0 : -1)}
          style={disliked ? { color: DANGER_TEXT, borderColor: DANGER_TEXT } : undefined}
        >
          Nie dla mnie
        </Button>
      </div>

      {/* Secondary row: favourite + cooked */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <Pressable
          onPress={onToggleFavorite}
          haptic="tap"
          disabled={busy}
          ariaLabel={idea.favorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
          ariaPressed={idea.favorite}
          style={{
            minHeight: 44,
            padding: `0 ${T.sp3}`,
            borderRadius: T.rMd,
            color: idea.favorite ? T.highlightOnSurface : T.text3,
            gap: 6,
            ...TYPO.footnote,
            fontWeight: 700,
          }}
        >
          <StarIcon filled={idea.favorite} />
          {idea.favorite ? "Ulubione" : "Do ulubionych"}
        </Pressable>

        <Pressable
          onPress={onCooked}
          haptic="success"
          disabled={busy}
          ariaLabel={`Zaznacz, że gotowałeś ${idea.title}`}
          style={{
            minHeight: 44,
            marginLeft: "auto",
            padding: `0 ${T.sp3}`,
            borderRadius: T.rMd,
            color: T.text2,
            gap: 6,
            ...TYPO.footnote,
            fontWeight: 700,
          }}
        >
          <PotIcon />
          Gotowałem to
        </Pressable>
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

  // Meal ideas
  const [ideas, setIdeas] = useState<MealIdeaItem[]>([]);
  const [savedIdeas, setSavedIdeas] = useState<MealIdeaItem[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedLoaded, setSavedLoaded] = useState(false);
  /** Expanded / picked cards are keyed by title: a fresh proposal has no id yet. */
  const [expandedIdeas, setExpandedIdeas] = useState<ReadonlySet<string>>(new Set());
  const [pickedIdeas, setPickedIdeas] = useState<ReadonlySet<string>>(new Set());
  const [busyIdea, setBusyIdea] = useState<string | null>(null);
  const [showShopping, setShowShopping] = useState(false);
  const [boughtItems, setBoughtItems] = useState<ReadonlySet<string>>(new Set());

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  /* ---------------- meal ideas ---------------- */

  /**
   * One saved row lands in both places at once: the proposal card the user just
   * tapped, and the "Twoje ulubione" list underneath. Keyed by title, because a
   * fresh proposal has no id until the first write.
   */
  const applyIdeaUpdate = useCallback((saved: MealIdeaItem) => {
    const key = saved.title.toLowerCase();
    setIdeas((prev) => prev.map((i) => (i.title.toLowerCase() === key ? saved : i)));
    setSavedIdeas((prev) => {
      const without = prev.filter((i) => i.title.toLowerCase() !== key);
      // The library only holds what he actually wants to see again.
      return saved.rating === 1 || saved.favorite ? [saved, ...without] : without;
    });
  }, []);

  const loadSavedIdeas = useCallback(async () => {
    setSavedLoading(true);
    try {
      const res = await fetch("/api/meal-ideas?filter=liked");
      if (res.ok) {
        const data = await res.json();
        setSavedIdeas(Array.isArray(data.ideas) ? data.ideas.map(toIdeaItem) : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavedLoading(false);
      setSavedLoaded(true);
    }
  }, []);

  const handleSuggest = useCallback(async () => {
    haptic.impact();
    setSuggesting(true);
    try {
      const res = await fetch("/api/meal-ideas/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 3 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Nie udało się pobrać pomysłów");
      }
      const fresh: MealIdeaItem[] = Array.isArray(data.ideas) ? data.ideas.map(toIdeaItem) : [];
      if (fresh.length === 0) {
        showToast("Dietetyk nic nie wymyślił. Spróbuj jeszcze raz.");
        return;
      }
      setIdeas(fresh);
      setExpandedIdeas(new Set());
      setPickedIdeas(new Set());
      haptic.success();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Coś poszło nie tak");
    } finally {
      setSuggesting(false);
    }
  }, [showToast]);

  /** Writes the whole card to the database (upsert on the title). */
  const persistIdea = useCallback(
    async (idea: MealIdeaItem, overrides: { rating?: number; favorite?: boolean }) => {
      const res = await fetch("/api/meal-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: idea.title,
          description: idea.description,
          ingredients: idea.ingredients,
          steps: idea.steps,
          prepMinutes: idea.prepMinutes,
          calories: idea.calories,
          protein: idea.protein,
          carbs: idea.carbs,
          fat: idea.fat,
          tags: idea.tags,
          source: idea.source,
          sourceUrl: idea.sourceUrl,
          rating: overrides.rating ?? idea.rating,
          favorite: overrides.favorite ?? idea.favorite,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Nie udało się zapisać");
      return toIdeaItem(data.idea);
    },
    []
  );

  const patchIdea = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/meal-ideas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Nie udało się zapisać");
      return toIdeaItem(data.idea);
    },
    []
  );

  const handleRateIdea = useCallback(
    async (idea: MealIdeaItem, rating: number) => {
      setBusyIdea(idea.title);
      try {
        const saved = idea.id
          ? await patchIdea(idea.id, { rating })
          : await persistIdea(idea, { rating });
        applyIdeaUpdate(saved);
        showToast(rating === 1 ? "Zapamiętane: lubisz to" : rating === -1 ? "Więcej tego nie zaproponuję" : "Ocena cofnięta");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Nie udało się zapisać");
      } finally {
        setBusyIdea(null);
      }
    },
    [applyIdeaUpdate, patchIdea, persistIdea, showToast]
  );

  const handleToggleFavoriteIdea = useCallback(
    async (idea: MealIdeaItem) => {
      const next = !idea.favorite;
      setBusyIdea(idea.title);
      try {
        const saved = idea.id
          ? await patchIdea(idea.id, { favorite: next })
          : await persistIdea(idea, { favorite: next });
        applyIdeaUpdate(saved);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Nie udało się zapisać");
      } finally {
        setBusyIdea(null);
      }
    },
    [applyIdeaUpdate, patchIdea, persistIdea, showToast]
  );

  const handleCookedIdea = useCallback(
    async (idea: MealIdeaItem) => {
      setBusyIdea(idea.title);
      try {
        // A dish can only be counted once it exists as a row, so an unsaved
        // proposal is written first and only then gets its counter bumped.
        const id = idea.id ?? (await persistIdea(idea, {})).id;
        if (!id) throw new Error("Nie udało się zapisać pomysłu");
        const saved = await patchIdea(id, { cooked: true });
        applyIdeaUpdate(saved);
        showToast(`Zapisane: gotowane ${saved.timesCooked}x`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Nie udało się zapisać");
      } finally {
        setBusyIdea(null);
      }
    },
    [applyIdeaUpdate, patchIdea, persistIdea, showToast]
  );

  const toggleExpandIdea = useCallback((title: string) => {
    setExpandedIdeas((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  const togglePickIdea = useCallback((title: string) => {
    setPickedIdeas((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  const toggleBoughtItem = useCallback((key: string) => {
    haptic.tap();
    setBoughtItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  /**
   * The library loads the first time the user opens the tab, then stays in
   * memory (every write updates it in place). Fetched from the tab handler and
   * NOT from an effect on `tab`: an effect would fire a cascading render on
   * every tab switch, and this only ever needs to run once.
   */
  const handleTabChange = useCallback(
    (next: Tab) => {
      setTab(next);
      if (next === "ideas" && !savedLoaded && !savedLoading) {
        loadSavedIdeas();
      }
    },
    [savedLoaded, savedLoading, loadSavedIdeas]
  );

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

  /**
   * Everything the user ticked, across fresh proposals AND the library. Ticking
   * the same dish in both places must not duplicate it, so titles are deduped.
   */
  const pickedIdeaList = useMemo(() => {
    const seen = new Set<string>();
    const out: MealIdeaItem[] = [];
    for (const idea of [...ideas, ...savedIdeas]) {
      const key = idea.title.toLowerCase();
      if (!pickedIdeas.has(idea.title) || seen.has(key)) continue;
      seen.add(key);
      out.push(idea);
    }
    return out;
  }, [ideas, savedIdeas, pickedIdeas]);

  const shoppingGroups = useMemo(() => buildShoppingList(pickedIdeaList), [pickedIdeaList]);
  const shoppingCount = useMemo(
    () => shoppingGroups.reduce((sum, g) => sum + g.items.length, 0),
    [shoppingGroups]
  );

  const handleCopyShoppingList = useCallback(async () => {
    haptic.tap();
    const ok = await copyText(shoppingListToText(shoppingGroups));
    showToast(ok ? "Lista skopiowana" : "Nie udało się skopiować");
  }, [shoppingGroups, showToast]);

  const openShopping = useCallback(() => {
    haptic.impact();
    setShowShopping(true);
  }, []);

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
  // No local fallback number. The calorie target has exactly one owner
  // (`getCurrentBodyMetrics`), and inventing 2500 here when the API says nothing meant
  // this screen could print a goal the rest of the app had never heard of. Null renders
  // as "brak danych" below, which is the truth.
  const targetCalories = today?.targetCalories ?? null;
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
            <span style={{ color: T.text2, fontWeight: 700 }}>
              {targetCalories !== null ? `${targetCalories} kcal` : "brak danych"}
            </span>
          </div>
        </Card>
      </Reveal>
    </div>
  );

  const ideasPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 1. THE ONE ACTION */}
      <Reveal index={0}>
        <Card>
          <h2 style={{ ...TYPO.title3, color: T.text, margin: "0 0 4px" }}>Co dziś zjeść</h2>
          <p style={{ ...TYPO.callout, color: T.text2, margin: "0 0 14px" }}>
            Dietetyk szuka szybkich, prostych dań: 15 do 20 minut, kilka składników, nic
            przekombinowanego. Im więcej ocenisz, tym lepiej trafia.
          </p>
          <Button
            size="lg"
            fullWidth
            loading={suggesting}
            haptic="impact"
            iconLeft={<SparkIcon size={20} />}
            onPress={handleSuggest}
          >
            {ideas.length > 0 ? "Podrzuć inne pomysły" : "Podrzuć pomysły na dziś"}
          </Button>

          {pickedIdeaList.length > 0 && (
            <Button
              variant="secondary"
              size="md"
              fullWidth
              haptic="impact"
              iconLeft={<CartIcon />}
              onPress={openShopping}
              style={{ marginTop: 10 }}
            >
              Lista zakupów ({pickedIdeaList.length})
            </Button>
          )}
        </Card>
      </Reveal>

      {/* 2. PROPOSALS */}
      {suggesting && ideas.length === 0 ? (
        <Skeleton variant="card" count={3} />
      ) : ideas.length > 0 ? (
        <>
          <div style={{ ...TYPO.label, color: T.text3, padding: `0 ${T.sp1}` }}>
            Propozycje na teraz
          </div>
          {ideas.map((idea, i) => (
            <Reveal key={idea.title} index={i + 1}>
              <IdeaCard
                idea={idea}
                expanded={expandedIdeas.has(idea.title)}
                onToggleExpand={() => toggleExpandIdea(idea.title)}
                picked={pickedIdeas.has(idea.title)}
                onTogglePick={() => togglePickIdea(idea.title)}
                busy={busyIdea === idea.title}
                onRate={(rating) => handleRateIdea(idea, rating)}
                onToggleFavorite={() => handleToggleFavoriteIdea(idea)}
                onCooked={() => handleCookedIdea(idea)}
              />
            </Reveal>
          ))}
        </>
      ) : (
        <Reveal index={1}>
          <Card>
            <EmptyState
              compact
              icon={<SparkIcon />}
              title="Brak propozycji"
              body="Naciśnij przycisk wyżej, a dietetyk podrzuci kilka szybkich dań pod Twój cel kaloryczny."
            />
          </Card>
        </Reveal>
      )}

      {/* 3. THE LIBRARY THAT GROWS */}
      <Reveal index={2}>
        <Card padding="sm">
          <div style={{ padding: `${T.sp2} ${T.sp2} 0` }}>
            <h2 style={{ ...TYPO.title3, color: T.text, margin: "0 0 2px" }}>Twoje ulubione</h2>
            <p style={{ ...TYPO.footnote, color: T.text3, margin: 0 }}>
              Dania, które oceniłeś na plus. Z tej listy dietetyk układa kolejne propozycje.
            </p>
          </div>
        </Card>
      </Reveal>

      {savedLoading && savedIdeas.length === 0 ? (
        <Skeleton variant="card" count={2} />
      ) : savedIdeas.length === 0 ? (
        <Reveal index={3}>
          <Card>
            <EmptyState
              compact
              icon={<StarIcon size={26} />}
              title="Jeszcze nic tu nie ma"
              body="Oceń propozycję na „Lubię to”, a wyląduje tutaj i będzie wracać."
            />
          </Card>
        </Reveal>
      ) : (
        savedIdeas.map((idea, i) => (
          <Reveal key={idea.id ?? idea.title} index={Math.min(3 + i, 6)}>
            <IdeaCard
              idea={idea}
              expanded={expandedIdeas.has(idea.title)}
              onToggleExpand={() => toggleExpandIdea(idea.title)}
              picked={pickedIdeas.has(idea.title)}
              onTogglePick={() => togglePickIdea(idea.title)}
              busy={busyIdea === idea.title}
              onRate={(rating) => handleRateIdea(idea, rating)}
              onToggleFavorite={() => handleToggleFavoriteIdea(idea)}
              onCooked={() => handleCookedIdea(idea)}
            />
          </Reveal>
        ))
      )}
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
        onChange={handleTabChange}
        ariaLabel="Widok diety"
      />

      <SwipeDeck
        index={tabIndex}
        onChange={(i) => handleTabChange(TAB_KEYS[i] ?? "today")}
        labels={TABS.map((t) => t.label)}
        enabled={!showAdd && !showShopping}
      >
        {todayPanel}
        {ideasPanel}
        {calendarPanel}
      </SwipeDeck>

      {/* Shopping list within thumb reach - this is used while standing in the shop */}
      {tab === "ideas" && pickedIdeaList.length > 0 && !showShopping && !showAdd && (
        <BodyPortal>
          <Pressable
            onPress={openShopping}
            haptic="impact"
            ariaLabel={`Lista zakupów, ${pickedIdeaList.length} dań`}
            style={{
              position: "fixed",
              left: "50%",
              transform: "translateX(-50%)",
              bottom: "calc(var(--above-tabbar) + 8px)",
              minHeight: 52,
              padding: `0 ${T.sp5}`,
              gap: 8,
              borderRadius: T.rFull,
              background: "var(--grad-accent)",
              color: "var(--accent-ink)",
              boxShadow: "var(--glow-accent-cta)",
              ...TYPO.callout,
              fontWeight: 700,
              zIndex: 60,
            }}
          >
            <CartIcon />
            Lista zakupów ({pickedIdeaList.length})
          </Pressable>
        </BodyPortal>
      )}

      {/* SHOPPING LIST - computed from the picked cards, never stored */}
      <Sheet
        open={showShopping}
        onClose={() => setShowShopping(false)}
        title="Lista zakupów"
        footer={
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 12 }}>
            <Button variant="secondary" size="lg" fullWidth onPress={() => setShowShopping(false)}>
              Zamknij
            </Button>
            <Button
              size="lg"
              fullWidth
              haptic="success"
              disabled={shoppingCount === 0}
              onPress={handleCopyShoppingList}
            >
              Kopiuj listę
            </Button>
          </div>
        }
      >
        {shoppingCount === 0 ? (
          <EmptyState
            compact
            icon={<CartIcon size={26} />}
            title="Nic nie wybrano"
            body="Zaznacz kwadracik przy daniu, a jego składniki trafią na tę listę."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <p style={{ ...TYPO.footnote, color: T.text3, margin: 0 }}>
              Składniki z {pickedIdeaList.length}{" "}
              {pickedIdeaList.length === 1 ? "dania" : "dań"}. Odhaczaj, co masz już w domu.
            </p>

            {shoppingGroups.map((group) => (
              <div key={group.label}>
                <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>{group.label}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {group.items.map((item) => {
                    const bought = boughtItems.has(item.key);
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => toggleBoughtItem(item.key)}
                        haptic={false}
                        role="checkbox"
                        ariaChecked={bought}
                        ariaLabel={item.text}
                        style={{
                          minHeight: 44,
                          justifyContent: "flex-start",
                          gap: 12,
                          padding: `0 ${T.sp2}`,
                          borderRadius: T.rMd,
                          width: "100%",
                        }}
                      >
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            flexShrink: 0,
                            borderRadius: T.rXs,
                            border: `2px solid ${bought ? T.success : T.borderStrong}`,
                            background: bought ? T.success : "transparent",
                            color: bought ? T.textInverse : "transparent",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <CheckIcon size={16} />
                        </span>
                        <span
                          style={{
                            ...TYPO.callout,
                            color: bought ? T.text3 : T.text,
                            textAlign: "left",
                            textDecoration: bought ? "line-through" : "none",
                          }}
                        >
                          {item.text}
                          {item.count > 1 && (
                            <span style={{ color: T.text3, fontWeight: 700 }}> x{item.count}</span>
                          )}
                        </span>
                      </Pressable>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>

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
              // Sits directly on top of both FABs (zIndex 60, same bottom offset).
              // Without this, every tap on "+" during the toast's life did nothing.
              pointerEvents: "none",
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

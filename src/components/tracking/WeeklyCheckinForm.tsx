"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Button,
  Card,
  Field,
  Skeleton,
  fieldControlStyle,
  fieldTextareaStyle,
  T,
  TYPO,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";

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
        haptic.success();
        setTimeout(() => setSaved(false), 3000);
      } else {
        haptic.error();
      }
    } catch {
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <Skeleton variant="line" width="55%" height={20} />
      </Card>
    );
  }

  return (
    <Card>
      <button
        onClick={() => {
          haptic.tap();
          setExpanded((v) => !v);
        }}
        className="pressable"
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: T.sp3,
          width: "100%",
          minHeight: T.tapMin,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ display: "block", minWidth: 0 }}>
          <span style={{ display: "block", ...TYPO.title3, color: T.text }}>
            Tygodniowy check-in
          </span>
          {checkin?.energyAvg != null && (
            <span
              style={{
                display: "block",
                ...TYPO.footnote,
                color: T.text3,
                marginTop: 2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Średnia energia: {checkin.energyAvg}/10
            </span>
          )}
        </span>
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: T.text3,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 220ms var(--ease-out)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <form
          onSubmit={handleSubmit}
          className="reveal"
          style={{ marginTop: T.sp4, display: "flex", flexDirection: "column", gap: T.sp4 }}
        >
          <Field label="Waga (kg)">
            {(p) => (
              <input
                {...p}
                type="number"
                step="0.1"
                min="30"
                max="300"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="np. 82.5"
                inputMode="decimal"
                style={fieldControlStyle}
              />
            )}
          </Field>

          <Field label="Co poszło dobrze?">
            {(p) => (
              <textarea
                {...p}
                value={wins}
                onChange={(e) => setWins(e.target.value)}
                placeholder="Twoje sukcesy tego tygodnia..."
                rows={3}
                style={fieldTextareaStyle}
              />
            )}
          </Field>

          <Field label="Co było trudne?">
            {(p) => (
              <textarea
                {...p}
                value={fails}
                onChange={(e) => setFails(e.target.value)}
                placeholder="Wyzwania i trudności..."
                rows={3}
                style={fieldTextareaStyle}
              />
            )}
          </Field>

          <Button type="submit" size="lg" fullWidth loading={saving} haptic="impact">
            {saved ? "Zapisano" : "Zapisz check-in"}
          </Button>
        </form>
      )}
    </Card>
  );
}

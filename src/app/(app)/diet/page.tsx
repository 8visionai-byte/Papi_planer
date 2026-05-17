"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import VoiceTextarea from "@/components/forms/VoiceTextarea";

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
  caloriesBurned: number;
  balance: number;
  targetCalories: number;
  bmr?: number;
  tdee?: number;
  bmrSoFarToday?: number;
}

interface HistoryDay {
  date: string;
  totals: Totals;
  caloriesBurned: number;
  balance: number;
  mealCount: number;
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

function nowHHMM(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Circular progress                                                  */
/* ------------------------------------------------------------------ */

function CircularProgress({
  value,
  target,
  size = 180,
}: {
  value: number;
  target: number;
  size?: number;
}) {
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const offset = circumference * (1 - pct);
  const over = value > target;
  const color = over ? "var(--danger, #ef4444)" : "var(--primary)";

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
          style={{ transition: "stroke-dashoffset 400ms ease" }}
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
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--foreground)" }}>
          {Math.round(value)}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>z {target} kcal</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          {Math.round(pct * 100)}%
        </div>
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
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DietPage() {
  const [today, setToday] = useState<TodayData | null>(null);
  const [history, setHistory] = useState<HistoryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  const fetchAll = useCallback(async () => {
    try {
      const [todayRes, historyRes] = await Promise.all([
        fetch("/api/meals"),
        fetch("/api/meals?days=7"),
      ]);
      if (todayRes.ok) {
        setToday(await todayRes.json());
      }
      if (historyRes.ok) {
        const data = await historyRes.json();
        setHistory(Array.isArray(data.history) ? data.history : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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
      // Reset the input so the same file can be reselected later
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
      fetchAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bład zapisu";
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }, [name, time, description, calories, protein, carbs, fat, showToast, resetForm, fetchAll]);

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
        fetchAll();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Bład usuwania";
        showToast(msg);
      }
    },
    [showToast, fetchAll]
  );

  const balanceColor = useMemo(() => {
    if (!today) return "var(--muted)";
    return today.balance >= 0 ? "var(--success, #16a34a)" : "var(--danger, #ef4444)";
  }, [today]);

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
  const target = today?.targetCalories ?? 2500;
  const burned = today?.caloriesBurned ?? 0;
  const balance = today?.balance ?? 0;

  return (
    <div style={{ padding: "16px 12px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ padding: "4px 4px 0" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>🍽️ Dieta</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
          Śledź posiłki i bilans kaloryczny
        </p>
      </header>

      {/* DZISIAJ */}
      <section style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Dzisiaj</h2>

        <CircularProgress value={totals.calories} target={target} />

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

        {/* BMR info */}
        {today?.bmr != null && (
          <div
            style={{
              marginTop: 16,
              padding: "8px 12px",
              borderRadius: 10,
              background: "var(--background)",
              border: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            🌡️ BMR: <strong style={{ color: "var(--foreground)" }}>{today.bmr} kcal/dzień</strong>{" "}
            (spalanie spoczynkowe)
          </div>
        )}

        {/* Bilans */}
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "var(--background)",
            border: `1px solid ${balanceColor}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            🌡️ {Math.round(today?.bmrSoFarToday ?? 0)} + 🔥 {Math.round(burned)} − 🍽️{" "}
            {Math.round(totals.calories)} kcal
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: balanceColor }}>
            {balance >= 0 ? "+" : ""}
            {Math.round(balance)} kcal
          </div>
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          BMR proporcjonalnie + aktywności − zjedzone
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          {balance >= 0 ? "Deficyt kaloryczny" : "Nadwyżka kaloryczna"}
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
              <div>
                📸 Rozpoznano: {visionInfo.foods.join(", ") || "—"}
              </div>
              <div>
                Pewność:{" "}
                <strong
                  style={{
                    color:
                      visionInfo.confidence === "high"
                        ? "var(--success, #16a34a)"
                        : visionInfo.confidence === "medium"
                        ? "var(--primary)"
                        : "var(--danger, #ef4444)",
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

      {/* HISTORIA */}
      <section style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Historia (7 dni)</h2>
        {history.length === 0 ? (
          <div
            style={{
              padding: "20px 0",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13,
            }}
          >
            Brak historii
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((d) => {
              const bColor =
                d.balance >= 0 ? "var(--success, #16a34a)" : "var(--danger, #ef4444)";
              return (
                <div
                  key={d.date}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(d.date)}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: bColor }}>
                      {d.balance >= 0 ? "+" : ""}
                      {Math.round(d.balance)} kcal
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    🍽️ {Math.round(d.totals.calories)} · 🔥 {Math.round(d.caloriesBurned)} · B{" "}
                    {Math.round(d.totals.protein)}g · W {Math.round(d.totals.carbs)}g · T{" "}
                    {Math.round(d.totals.fat)}g · {d.mealCount} posił.
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

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

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

interface LifeAreaRef {
  id: string;
  name: string;
  slug: string | null;
  category: string | null;
  description: string | null;
}

interface TrainingLog {
  id: string;
  date: string;
  exerciseName: string;
  sets: number | null;
  reps: number | null;
  weightKg: number | null;
  durationMin: number | null;
  distance: number | null;
  notes: string | null;
  rating: number | null;
}

interface PersonalRecord {
  id: string;
  exerciseName: string;
  value: number;
  unit: string;
  achievedAt: string;
  notes: string | null;
}

interface Milestone {
  id: string;
  title: string;
  completed: boolean;
}

interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  progress: number;
  milestones: Milestone[];
  mentor: { id: string; name: string; avatarEmoji: string | null; role: string } | null;
}

interface MentorInfo {
  id: string;
  name: string;
  role: string;
  persona: string;
  avatarEmoji: string | null;
  style: string | null;
}

interface DisciplineData {
  lifeArea: LifeAreaRef;
  trainingLogs: TrainingLog[];
  personalRecords: PersonalRecord[];
  goals: Goal[];
  mentor: MentorInfo | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 16,
  border: "1px solid var(--border)",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "var(--foreground)",
  margin: 0,
  marginBottom: 12,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--muted)",
  display: "block",
  marginBottom: 4,
};

const buttonPrimaryStyle: React.CSSProperties = {
  background: "var(--primary)",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const buttonSecondaryStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--primary)",
  border: "1px solid var(--primary)",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

export default function DisciplinePage() {
  const params = useParams();
  const slug = (params?.slug as string) || "";

  const [data, setData] = useState<DisciplineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTrainingForm, setShowTrainingForm] = useState(false);
  const [showRecordForm, setShowRecordForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/discipline/${encodeURIComponent(slug)}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Błąd serwera" }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) load();
  }, [slug, load]);

  async function deleteLog(id: string) {
    if (!confirm("Usunąć ten wpis treningu?")) return;
    const res = await fetch("/api/training-logs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) load();
  }

  async function deleteRecord(id: string) {
    if (!confirm("Usunąć ten rekord?")) return;
    const res = await fetch("/api/personal-records", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) load();
  }

  if (loading) {
    return (
      <div style={{ padding: "24px 16px" }}>
        <div
          style={{
            height: 40,
            background: "var(--border)",
            borderRadius: 8,
            marginBottom: 16,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            style={{
              ...cardStyle,
              height: 120,
              marginBottom: 12,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        ))}
        <style>{`@keyframes pulse { 0%,100% {opacity:1} 50% {opacity:0.5} }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: "24px 16px" }}>
        <div
          style={{
            textAlign: "center",
            color: "#ef4444",
            fontSize: 14,
            padding: "32px 16px",
            background: "rgba(239,68,68,0.06)",
            borderRadius: 12,
          }}
        >
          {error || "Nie znaleziono dyscypliny"}
        </div>
      </div>
    );
  }

  const { lifeArea, trainingLogs, personalRecords, goals, mentor } = data;

  return (
    <div style={{ padding: "24px 16px", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "var(--foreground)",
            margin: 0,
            marginBottom: 4,
          }}
        >
          {lifeArea.name}
        </h1>
        {lifeArea.category && (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{lifeArea.category}</div>
        )}
        {lifeArea.description && (
          <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 8 }}>
            {lifeArea.description}
          </div>
        )}
      </div>

      {/* Mentor card */}
      {mentor && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 9999,
                background: "var(--primary-light, rgba(59,130,246,0.1))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                flexShrink: 0,
              }}
            >
              {mentor.avatarEmoji || "🧑‍🏫"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)" }}>
                {mentor.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>{mentor.role}</div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 4,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {mentor.persona}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          style={buttonPrimaryStyle}
          onClick={() => setShowTrainingForm(true)}
        >
          + Dodaj trening
        </button>
        <button
          style={buttonSecondaryStyle}
          onClick={() => setShowRecordForm(true)}
        >
          🏆 Nowy rekord
        </button>
      </div>

      {/* Active goals */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionTitleStyle}>Cele aktywne ({goals.length})</h2>
        {goals.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Brak aktywnych celów w tej dyscyplinie
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {goals.map((g) => (
              <div key={g.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>
                    {g.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {g.progress}%
                  </div>
                </div>
                {g.description && (
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                    {g.description}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 8,
                    height: 4,
                    background: "var(--border)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${g.progress}%`,
                      height: "100%",
                      background: "var(--primary)",
                    }}
                  />
                </div>
                {g.milestones.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                    Milestone'ów: {g.milestones.filter((m) => m.completed).length}/{g.milestones.length}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Personal records */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionTitleStyle}>🏆 Rekordy ({personalRecords.length})</h2>
        {personalRecords.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Brak rekordów. Dodaj pierwszy!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {personalRecords.map((r) => (
              <div key={r.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>
                      {r.exerciseName}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      {formatDate(r.achievedAt)}
                    </div>
                    {r.notes && (
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        {r.notes}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--primary)" }}>
                      {r.value}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.unit}</div>
                  </div>
                  <button
                    onClick={() => deleteRecord(r.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#ef4444",
                      fontSize: 18,
                      cursor: "pointer",
                      padding: 4,
                    }}
                    aria-label="Usuń"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Training history */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionTitleStyle}>📋 Historia treningów ({trainingLogs.length})</h2>
        {trainingLogs.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Brak treningów. Dodaj pierwszy wpis!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trainingLogs.slice(0, 10).map((log) => (
              <div key={log.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>
                      {log.exerciseName}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {formatDate(log.date)}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {log.sets != null && log.reps != null && (
                        <span>{log.sets}×{log.reps}</span>
                      )}
                      {log.weightKg != null && <span>{log.weightKg} kg</span>}
                      {log.durationMin != null && <span>{log.durationMin} min</span>}
                      {log.distance != null && <span>{log.distance} km</span>}
                      {log.rating != null && <span>⭐ {log.rating}/5</span>}
                    </div>
                    {log.notes && (
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, fontStyle: "italic" }}>
                        {log.notes}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => deleteLog(log.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#ef4444",
                      fontSize: 18,
                      cursor: "pointer",
                      padding: 4,
                    }}
                    aria-label="Usuń"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            {trainingLogs.length > 10 && (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, padding: 8 }}>
                Pokazano 10 z {trainingLogs.length}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Training form modal */}
      {showTrainingForm && (
        <TrainingForm
          lifeAreaId={lifeArea.id}
          onClose={() => setShowTrainingForm(false)}
          onSaved={() => {
            setShowTrainingForm(false);
            load();
          }}
        />
      )}

      {/* Record form modal */}
      {showRecordForm && (
        <RecordForm
          lifeAreaId={lifeArea.id}
          onClose={() => setShowRecordForm(false)}
          onSaved={() => {
            setShowRecordForm(false);
            load();
          }}
        />
      )}

      <style>{`@keyframes pulse { 0%,100% {opacity:1} 50% {opacity:0.5} }`}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Training form modal                                                */
/* ------------------------------------------------------------------ */

function TrainingForm({
  lifeAreaId,
  onClose,
  onSaved,
}: {
  lifeAreaId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [exerciseName, setExerciseName] = useState("");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [distance, setDistance] = useState("");
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!exerciseName.trim()) {
      setErr("Nazwa ćwiczenia jest wymagana");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/training-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lifeAreaId,
          exerciseName,
          sets: sets || undefined,
          reps: reps || undefined,
          weightKg: weightKg || undefined,
          durationMin: durationMin || undefined,
          distance: distance || undefined,
          notes: notes || undefined,
          rating: rating || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Błąd zapisu" }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Błąd");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Dodaj trening">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={labelStyle}>Ćwiczenie *</label>
          <input
            style={inputStyle}
            value={exerciseName}
            onChange={(e) => setExerciseName(e.target.value)}
            placeholder="np. Przysiad ze sztangą"
            autoFocus
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>Serie</label>
            <input style={inputStyle} type="number" value={sets} onChange={(e) => setSets(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Powtórzenia</label>
            <input style={inputStyle} type="number" value={reps} onChange={(e) => setReps(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>Ciężar (kg)</label>
            <input style={inputStyle} type="number" step="0.5" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Czas (min)</label>
            <input style={inputStyle} type="number" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>Dystans (km)</label>
            <input style={inputStyle} type="number" step="0.1" value={distance} onChange={(e) => setDistance(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Ocena (1-5)</label>
            <input style={inputStyle} type="number" min="1" max="5" value={rating} onChange={(e) => setRating(e.target.value)} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Notatki</label>
          <textarea
            style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {err && (
          <div style={{ color: "#ef4444", fontSize: 13 }}>{err}</div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ ...buttonSecondaryStyle, color: "var(--muted)", borderColor: "var(--border)" }}>
            Anuluj
          </button>
          <button type="submit" disabled={submitting} style={{ ...buttonPrimaryStyle, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Zapisuję..." : "Zapisz"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Record form modal                                                  */
/* ------------------------------------------------------------------ */

function RecordForm({
  lifeAreaId,
  onClose,
  onSaved,
}: {
  lifeAreaId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [exerciseName, setExerciseName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("kg");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!exerciseName.trim() || !value || !unit.trim()) {
      setErr("Wypełnij ćwiczenie, wartość i jednostkę");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/personal-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lifeAreaId,
          exerciseName,
          value,
          unit,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Błąd zapisu" }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Błąd");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Nowy rekord">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={labelStyle}>Ćwiczenie *</label>
          <input
            style={inputStyle}
            value={exerciseName}
            onChange={(e) => setExerciseName(e.target.value)}
            placeholder="np. Martwy ciąg"
            autoFocus
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>Wartość *</label>
            <input style={inputStyle} type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Jednostka *</label>
            <input style={inputStyle} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, km, s..." />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Notatki</label>
          <textarea
            style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {err && (
          <div style={{ color: "#ef4444", fontSize: 13 }}>{err}</div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ ...buttonSecondaryStyle, color: "var(--muted)", borderColor: "var(--border)" }}>
            Anuluj
          </button>
          <button type="submit" disabled={submitting} style={{ ...buttonPrimaryStyle, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Zapisuję..." : "Zapisz"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal wrapper                                                      */
/* ------------------------------------------------------------------ */

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)",
          borderRadius: 16,
          padding: 20,
          maxWidth: 480,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--foreground)", margin: 0 }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 24,
              color: "var(--muted)",
              cursor: "pointer",
              lineHeight: 1,
              padding: 0,
            }}
            aria-label="Zamknij"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

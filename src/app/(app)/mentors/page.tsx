"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { MentorData as ViewMentor } from "@/components/mentors/MentorCard";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { MENTOR_MODELS } from "@/lib/mentors-constants";

type PageTab = "view" | "edit";

interface MentorLifeArea {
  id: string;
  name: string;
}

interface EditMentor {
  id: string;
  name: string;
  role: string;
  persona: string;
  systemPrompt: string;
  avatarEmoji: string | null;
  model: string;
  active: boolean;
  sortOrder: number;
  lifeAreas: MentorLifeArea[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Styles ───

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 12,
  border: "1.5px solid var(--border)",
  fontSize: 14,
  background: "var(--background)",
  color: "var(--foreground)",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--muted)",
  marginBottom: 4,
  display: "block",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 12,
  border: "none",
  background: "var(--primary)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "none",
  background: "var(--danger)",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1.5px solid var(--border)",
  background: "var(--card)",
  color: "var(--foreground)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const card: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 20,
  boxShadow: "var(--card-shadow)",
};

export default function MentorsPage() {
  const [tab, setTab] = useState<PageTab>("view");

  // View tab
  const [mentors, setMentors] = useState<ViewMentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsMentor, setDetailsMentor] = useState<ViewMentor | null>(null);

  // Edit tab
  const [editMentors, setEditMentors] = useState<EditMentor[]>([]);
  const [lifeAreas, setLifeAreas] = useState<MentorLifeArea[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editingMentor, setEditingMentor] = useState<EditMentor | null>(null);
  const [showMentorForm, setShowMentorForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [mentorForm, setMentorForm] = useState({
    name: "",
    role: "",
    persona: "",
    systemPrompt: "",
    avatarEmoji: "🧑‍🏫",
    model: "claude-sonnet-4-6",
    lifeAreaIds: [] as string[],
  });

  // ─── Fetch view mentors ───
  useEffect(() => {
    fetch("/api/mentors")
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Błąd serwera" }));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => setMentors(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // ─── Fetch edit data ───
  const fetchEditData = useCallback(async () => {
    try {
      const [mentorsRes, areasRes] = await Promise.all([
        fetch("/api/admin/mentors"),
        fetch("/api/admin/life-areas"),
      ]);
      if (mentorsRes.ok) setEditMentors(await mentorsRes.json());
      if (areasRes.ok) setLifeAreas(await areasRes.json());
      else setLifeAreas([]);
    } catch {}
  }, []);

  useEffect(() => {
    if (tab === "edit") fetchEditData();
  }, [tab, fetchEditData]);

  // Lock body scroll while modal open
  useEffect(() => {
    if (detailsMentor) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [detailsMentor]);

  // Close modal on Escape
  useEffect(() => {
    if (!detailsMentor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailsMentor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailsMentor]);

  // ─── Edit actions ───
  const resetMentorForm = () => {
    setMentorForm({
      name: "",
      role: "",
      persona: "",
      systemPrompt: "",
      avatarEmoji: "🧑‍🏫",
      model: "claude-sonnet-4-6",
      lifeAreaIds: [],
    });
    setEditingMentor(null);
    setShowMentorForm(false);
  };

  const openEditMentor = (m: EditMentor) => {
    setEditingMentor(m);
    setMentorForm({
      name: m.name,
      role: m.role,
      persona: m.persona,
      systemPrompt: m.systemPrompt,
      avatarEmoji: m.avatarEmoji || "🧑‍🏫",
      model: m.model || "claude-sonnet-4-6",
      lifeAreaIds: m.lifeAreas.map((la) => la.id),
    });
    setShowMentorForm(true);
  };

  const saveMentor = async () => {
    if (
      !mentorForm.name ||
      !mentorForm.role ||
      !mentorForm.persona ||
      !mentorForm.systemPrompt
    ) {
      setEditError("Wypełnij wszystkie wymagane pola");
      return;
    }
    setEditLoading(true);
    setEditError("");
    try {
      const method = editingMentor ? "PUT" : "POST";
      const payload = editingMentor
        ? { id: editingMentor.id, ...mentorForm }
        : mentorForm;
      const res = await fetch("/api/admin/mentors", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setEditError(data.error || "Błąd zapisu");
      } else {
        resetMentorForm();
        fetchEditData();
        // Refresh view list too — added/edited mentor may affect grid
        fetch("/api/mentors")
          .then((r) => (r.ok ? r.json() : []))
          .then((d) => setMentors(d))
          .catch(() => {});
      }
    } catch {
      setEditError("Błąd połączenia");
    }
    setEditLoading(false);
  };

  const deleteMentor = async (id: string) => {
    setEditLoading(true);
    try {
      await fetch("/api/admin/mentors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchEditData();
      // Refresh view list too
      fetch("/api/mentors")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setMentors(d))
        .catch(() => {});
    } catch {}
    setEditLoading(false);
    setConfirmDelete(null);
  };

  // ─── Tab button style (big tabs, diet-style) ───
  const tabButton = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: 12,
    borderRadius: 10,
    border: "none",
    background: active ? "var(--primary)" : "var(--background)",
    color: active ? "#fff" : "var(--foreground)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 200ms ease, color 200ms ease",
  });

  return (
    <div style={{ padding: "24px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "var(--foreground)",
            margin: 0,
          }}
        >
          Mentorzy
        </h1>
        {tab === "view" && !loading && mentors.length > 0 && (
          <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}>
            {mentors.length}
          </span>
        )}
      </div>

      {/* Big tabs (diet style) */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={tabButton(tab === "view")} onClick={() => setTab("view")}>
          Twoi mentorzy
        </button>
        <button style={tabButton(tab === "edit")} onClick={() => setTab("edit")}>
          Edytuj mentorów
        </button>
      </div>

      {/* ─── VIEW TAB ─── */}
      {tab === "view" && (
        <>
          {/* Loading skeletons */}
          {loading && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                gap: 12,
              }}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    background: "var(--card)",
                    borderRadius: 16,
                    padding: 16,
                    border: "1px solid var(--border)",
                    height: 200,
                    animation: "pulse 1.5s ease-in-out infinite",
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 9999,
                      background: "var(--border)",
                      margin: "0 auto 12px",
                    }}
                  />
                  <div
                    style={{
                      width: "70%",
                      height: 14,
                      borderRadius: 4,
                      background: "var(--border)",
                      margin: "0 auto 6px",
                    }}
                  />
                  <div
                    style={{
                      width: "50%",
                      height: 12,
                      borderRadius: 4,
                      background: "var(--border)",
                      margin: "0 auto",
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              style={{
                textAlign: "center",
                color: "#ef4444",
                fontSize: 14,
                padding: "20px 16px",
                background: "rgba(239,68,68,0.06)",
                borderRadius: 12,
              }}
            >
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && mentors.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "48px 16px",
                color: "var(--muted)",
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12 }}>🧑‍🏫</div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>Brak mentorów</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Przejdź do zakładki &ldquo;Edytuj mentorów&rdquo; aby dodać pierwszego
              </div>
            </div>
          )}

          {/* Mentor grid — compact */}
          {!loading && !error && mentors.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                gap: 12,
              }}
            >
              {mentors.map((mentor) => {
                const firstArea = mentor.lifeAreas[0];
                const disciplineSlug = firstArea ? slugify(firstArea) : null;
                return (
                  <div
                    key={mentor.id}
                    onClick={() => setDetailsMentor(mentor)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetailsMentor(mentor);
                      }
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      background: "var(--card)",
                      borderRadius: 16,
                      padding: 16,
                      boxShadow:
                        "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "transform 150ms ease, box-shadow 150ms ease",
                    }}
                    onPointerDown={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = "scale(0.97)";
                    }}
                    onPointerUp={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = "scale(1)";
                    }}
                    onPointerLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = "scale(1)";
                    }}
                  >
                    {/* Avatar emoji */}
                    <div
                      style={{
                        fontSize: 44,
                        lineHeight: 1,
                        width: 64,
                        height: 64,
                        borderRadius: 9999,
                        background: "var(--primary-light, rgba(59,130,246,0.1))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {mentor.avatarEmoji || "🧑‍🏫"}
                    </div>

                    {/* Name */}
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "var(--foreground)",
                        lineHeight: 1.25,
                        width: "100%",
                      }}
                    >
                      {mentor.name}
                    </div>

                    {/* Role (max 2 lines) */}
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        lineHeight: 1.35,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        width: "100%",
                      }}
                    >
                      {mentor.role}
                    </div>

                    {/* LifeArea pills */}
                    {mentor.lifeAreas.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 4,
                          justifyContent: "center",
                          width: "100%",
                        }}
                      >
                        {mentor.lifeAreas.map((area) => (
                          <span
                            key={area}
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              color: "var(--primary)",
                              background: "var(--primary-light, rgba(59,130,246,0.08))",
                              borderRadius: 6,
                              padding: "2px 8px",
                              lineHeight: 1.5,
                            }}
                          >
                            {area}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Trening / historia button */}
                    {disciplineSlug && (
                      <Link
                        href={`/discipline/${disciplineSlug}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          display: "block",
                          textAlign: "center",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--primary)",
                          background: "var(--primary-light, rgba(59,130,246,0.08))",
                          borderRadius: 10,
                          padding: "8px 12px",
                          textDecoration: "none",
                          border: "1px solid transparent",
                          transition: "background 150ms ease",
                          width: "100%",
                          marginTop: "auto",
                        }}
                      >
                        📚 Trening / historia
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ─── EDIT TAB ─── */}
      {tab === "edit" && (
        <div>
          {/* Edit error */}
          {editError && (
            <div
              style={{
                ...card,
                background: "#fef2f2",
                color: "var(--danger)",
                marginBottom: 16,
                fontSize: 14,
              }}
            >
              {editError}
              <button
                onClick={() => setEditError("")}
                style={{
                  marginLeft: 12,
                  background: "none",
                  border: "none",
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Confirm delete dialog */}
          {confirmDelete && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
              }}
            >
              <div style={{ ...card, maxWidth: 340, textAlign: "center" }}>
                <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
                  Czy na pewno?
                </p>
                <p
                  style={{ fontSize: 14, color: "var(--muted)", marginBottom: 20 }}
                >
                  Ta akcja jest nieodwracalna.
                </p>
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                  <button
                    style={btnSecondary}
                    onClick={() => setConfirmDelete(null)}
                  >
                    Anuluj
                  </button>
                  <button
                    style={btnDanger}
                    onClick={() => deleteMentor(confirmDelete)}
                  >
                    Usuń
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mentor form */}
          {showMentorForm && (
            <div style={{ ...card, marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
                {editingMentor ? "Edytuj mentora" : "Nowy mentor"}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Nazwa *</label>
                  <input
                    style={inputStyle}
                    value={mentorForm.name}
                    onChange={(e) =>
                      setMentorForm({ ...mentorForm, name: e.target.value })
                    }
                    placeholder="np. Coach Marek"
                  />
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Rola *</label>
                    <input
                      style={inputStyle}
                      value={mentorForm.role}
                      onChange={(e) =>
                        setMentorForm({ ...mentorForm, role: e.target.value })
                      }
                      placeholder="np. Trener personalny"
                    />
                  </div>
                  <div style={{ width: 80 }}>
                    <label style={labelStyle}>Emoji</label>
                    <input
                      style={inputStyle}
                      value={mentorForm.avatarEmoji}
                      onChange={(e) =>
                        setMentorForm({
                          ...mentorForm,
                          avatarEmoji: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Persona *</label>
                  <VoiceTextarea
                    value={mentorForm.persona}
                    onChange={(v) => setMentorForm({ ...mentorForm, persona: v })}
                    minHeight={100}
                    placeholder="Opis osobowości i stylu mentora..."
                  />
                </div>
                <div>
                  <label style={labelStyle}>
                    System Prompt * (realny prompt wysyłany do API)
                  </label>
                  <VoiceTextarea
                    value={mentorForm.systemPrompt}
                    onChange={(v) =>
                      setMentorForm({ ...mentorForm, systemPrompt: v })
                    }
                    minHeight={150}
                    placeholder="Instrukcje systemowe dla AI..."
                  />
                </div>
                <div>
                  <label style={labelStyle}>Model LLM *</label>
                  <select
                    style={inputStyle}
                    value={mentorForm.model}
                    onChange={(e) =>
                      setMentorForm({ ...mentorForm, model: e.target.value })
                    }
                  >
                    {MENTOR_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <div
                    style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}
                  >
                    Opus dla mentorów strategicznych, Sonnet dla większości, Haiku
                    dla szybkich odpowiedzi
                  </div>
                </div>
                {lifeAreas.length > 0 && (
                  <div>
                    <label style={labelStyle}>Obszary życia</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {lifeAreas.map((la) => {
                        const checked = mentorForm.lifeAreaIds.includes(la.id);
                        return (
                          <label
                            key={la.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 13,
                              cursor: "pointer",
                              padding: "4px 10px",
                              borderRadius: 8,
                              background: checked
                                ? "var(--primary)"
                                : "var(--background)",
                              color: checked ? "#fff" : "var(--foreground)",
                              border: `1.5px solid ${
                                checked ? "var(--primary)" : "var(--border)"
                              }`,
                              transition: "all 0.15s",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const ids = checked
                                  ? mentorForm.lifeAreaIds.filter(
                                      (id) => id !== la.id
                                    )
                                  : [...mentorForm.lifeAreaIds, la.id];
                                setMentorForm({
                                  ...mentorForm,
                                  lifeAreaIds: ids,
                                });
                              }}
                              style={{ display: "none" }}
                            />
                            {la.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <button
                    style={btnPrimary}
                    onClick={saveMentor}
                    disabled={editLoading}
                  >
                    {editingMentor ? "Zapisz zmiany" : "Dodaj mentora"}
                  </button>
                  <button style={btnSecondary} onClick={resetMentorForm}>
                    Anuluj
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add button */}
          {!showMentorForm && (
            <button
              style={{ ...btnPrimary, marginBottom: 16 }}
              onClick={() => {
                resetMentorForm();
                setShowMentorForm(true);
              }}
            >
              + Dodaj mentora
            </button>
          )}

          {/* Mentors list (active + inactive) */}
          {editMentors.map((m) => (
            <div key={m.id} style={{ ...card, marginBottom: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 24 }}>
                      {m.avatarEmoji || "🧑‍🏫"}
                    </span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {m.role}
                      </div>
                    </div>
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--muted)",
                      marginTop: 8,
                      marginBottom: 4,
                    }}
                  >
                    {m.persona.length > 120
                      ? m.persona.slice(0, 120) + "..."
                      : m.persona}
                  </p>
                  {m.lifeAreas.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        marginTop: 6,
                      }}
                    >
                      {m.lifeAreas.map((la) => (
                        <span
                          key={la.id}
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "var(--background)",
                            color: "var(--muted)",
                          }}
                        >
                          {la.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: m.active ? "#dcfce7" : "#fef2f2",
                        color: m.active ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      {m.active ? "Aktywny" : "Nieaktywny"}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: "var(--primary)",
                        color: "#fff",
                        fontWeight: 600,
                      }}
                      title={m.model}
                    >
                      🧠{" "}
                      {m.model
                        ?.replace("claude-", "")
                        .replace("-20251001", "")
                        .replace(/-/g, " ") || "sonnet 4-6"}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginLeft: 12,
                  }}
                >
                  <button style={btnSecondary} onClick={() => openEditMentor(m)}>
                    Edytuj
                  </button>
                  <button
                    style={btnDanger}
                    onClick={() => setConfirmDelete(m.id)}
                  >
                    Usuń
                  </button>
                </div>
              </div>
            </div>
          ))}
          {editMentors.length === 0 && !showMentorForm && (
            <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
              Brak mentorów. Dodaj pierwszego!
            </p>
          )}
        </div>
      )}

      {/* Details modal (view tab) */}
      {detailsMentor && (
        <div
          onClick={() => setDetailsMentor(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card)",
              borderRadius: 20,
              maxWidth: 480,
              width: "100%",
              maxHeight: "80vh",
              overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              border: "1px solid var(--border)",
              position: "relative",
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setDetailsMentor(null)}
              aria-label="Zamknij"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                width: 32,
                height: 32,
                borderRadius: 9999,
                border: "none",
                background: "rgba(0,0,0,0.06)",
                color: "var(--foreground)",
                fontSize: 18,
                lineHeight: 1,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1,
              }}
            >
              ×
            </button>

            <div style={{ padding: "24px 20px" }}>
              {/* Header: emoji + name + role */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  marginBottom: 18,
                  paddingRight: 32,
                }}
              >
                <div
                  style={{
                    fontSize: 40,
                    lineHeight: 1,
                    width: 64,
                    height: 64,
                    borderRadius: 9999,
                    background: "var(--primary-light, rgba(59,130,246,0.1))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {detailsMentor.avatarEmoji || "🧑‍🏫"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: "var(--foreground)",
                      lineHeight: 1.2,
                    }}
                  >
                    {detailsMentor.name}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--muted)",
                      marginTop: 4,
                      lineHeight: 1.35,
                    }}
                  >
                    {detailsMentor.role}
                  </div>
                </div>
              </div>

              {/* Persona / Opis */}
              {detailsMentor.persona && (
                <section style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      marginBottom: 6,
                    }}
                  >
                    Opis
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: "var(--foreground)",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {detailsMentor.persona}
                  </div>
                </section>
              )}

              {/* Twoje obszary */}
              {detailsMentor.lifeAreas.length > 0 && (
                <section style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      marginBottom: 8,
                    }}
                  >
                    Twoje obszary
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {detailsMentor.lifeAreas.map((area) => (
                      <span
                        key={area}
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "var(--primary)",
                          background: "var(--primary-light, rgba(59,130,246,0.08))",
                          borderRadius: 8,
                          padding: "4px 10px",
                          lineHeight: 1.5,
                        }}
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Model AI badge */}
              {detailsMentor.style && (
                <section style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      marginBottom: 6,
                    }}
                  >
                    Styl
                  </div>
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--foreground)",
                      background: "var(--border)",
                      borderRadius: 8,
                      padding: "4px 10px",
                    }}
                  >
                    {detailsMentor.style}
                  </span>
                </section>
              )}

              {/* Akcje */}
              <section
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 22,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                }}
              >
                {(() => {
                  const firstArea = detailsMentor.lifeAreas[0];
                  const disciplineSlug = firstArea ? slugify(firstArea) : null;
                  return disciplineSlug ? (
                    <Link
                      href={`/discipline/${disciplineSlug}`}
                      onClick={() => setDetailsMentor(null)}
                      style={{
                        display: "block",
                        textAlign: "center",
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#fff",
                        background: "var(--primary)",
                        borderRadius: 12,
                        padding: "10px 16px",
                        textDecoration: "none",
                      }}
                    >
                      📚 Trening / historia
                    </Link>
                  ) : null;
                })()}
                <button
                  onClick={() => {
                    // Switch to edit tab and open form for this mentor
                    setDetailsMentor(null);
                    setTab("edit");
                    // The edit data will fetch via tab effect; pre-open form when ready
                    fetch("/api/admin/mentors")
                      .then((r) => (r.ok ? r.json() : []))
                      .then((data: EditMentor[]) => {
                        setEditMentors(data);
                        const target = data.find((m) => m.id === detailsMentor.id);
                        if (target) openEditMentor(target);
                      })
                      .catch(() => {});
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "center",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--foreground)",
                    background: "transparent",
                    borderRadius: 12,
                    padding: "10px 16px",
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  ✏️ Edytuj
                </button>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Skeleton animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

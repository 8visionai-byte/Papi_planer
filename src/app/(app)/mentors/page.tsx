"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { MentorData as ViewMentor } from "@/components/mentors/MentorCard";
import { MentorChat } from "@/components/mentors/MentorChat";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { MENTOR_MODELS } from "@/lib/mentors-constants";
import { haptic } from "@/lib/haptics";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Pressable,
  Sheet,
  Skeleton,
  fieldControlStyle,
  T,
  TYPO,
} from "@/components/ui";
import { SegmentedTabs, SwipeDeck } from "@/components/motion";

type PageTab = "view" | "edit";
const TABS: PageTab[] = ["view", "edit"];

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

/* ------------------------------------------------------------------ */
/*  Interface icons — SVG, stroke 1.75, round caps (never emoji)       */
/* ------------------------------------------------------------------ */

function Icon({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

const ChatIcon = () => (
  <Icon>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Icon>
);

const HistoryIcon = () => (
  <Icon>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </Icon>
);

const PencilIcon = () => (
  <Icon>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);

const PlusIcon = () => (
  <Icon>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Icon>
);

const TrashIcon = () => (
  <Icon size={18}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);

/* ------------------------------------------------------------------ */
/*  Shared chip                                                        */
/* ------------------------------------------------------------------ */

function AreaChip({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "muted" }) {
  const accent = tone === "accent";
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.3,
        color: accent ? T.primaryOnSurface : T.text3,
        background: accent ? T.primarySoft : T.surface2,
        border: `1px solid ${accent ? T.borderAccent : T.border}`,
        borderRadius: T.rFull,
        padding: "4px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MentorsPage() {
  const [tab, setTab] = useState<PageTab>("view");

  // View tab
  const [mentors, setMentors] = useState<ViewMentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsMentor, setDetailsMentor] = useState<ViewMentor | null>(null);
  const [chatMentor, setChatMentor] = useState<ViewMentor | null>(null);

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

  // Lock body scroll while the full-screen chat is open.
  // (The details / confirm Sheets lock the page themselves.)
  useEffect(() => {
    if (!chatMentor) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [chatMentor]);

  // Close chat on Escape
  useEffect(() => {
    if (!chatMentor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChatMentor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatMentor]);

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
      haptic.warning();
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
        haptic.error();
        setEditError(data.error || "Błąd zapisu");
      } else {
        haptic.success();
        resetMentorForm();
        fetchEditData();
        // Refresh view list too — added/edited mentor may affect grid
        fetch("/api/mentors")
          .then((r) => (r.ok ? r.json() : []))
          .then((d) => setMentors(d))
          .catch(() => {});
      }
    } catch {
      haptic.error();
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
      haptic.success();
      fetchEditData();
      // Refresh view list too
      fetch("/api/mentors")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setMentors(d))
        .catch(() => {});
    } catch {
      haptic.error();
    }
    setEditLoading(false);
    setConfirmDelete(null);
  };

  const tabIndex = TABS.indexOf(tab);
  const changeTab = (next: PageTab) => {
    if (next === tab) return;
    haptic.selection();
    setTab(next);
  };

  /* ---------------- VIEW PANEL ---------------- */

  const viewPanel = (
    <div>
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: T.sp3 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="block" height={212} radius={20} />
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            ...TYPO.callout,
            color: T.dangerOnSurface,
            background: T.dangerSoft,
            border: `1px solid ${T.danger}`,
            borderRadius: T.rMd,
            padding: `${T.sp4} ${T.sp4}`,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && mentors.length === 0 && (
        <Card>
          <EmptyState
            icon="🧑‍🏫"
            title="Brak mentorów"
            body="Dodaj pierwszego mentora, żeby mieć z kim rozmawiać i prowadzić dyscypliny."
            action={{ label: "Dodaj mentora", onPress: () => { changeTab("edit"); setShowMentorForm(true); } }}
          />
        </Card>
      )}

      {!loading && !error && mentors.length > 0 && (
        <div
          className="anim-stagger"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: T.sp3,
          }}
        >
          {mentors.map((mentor) => {
            const firstArea = mentor.lifeAreas[0];
            const disciplineSlug = firstArea ? slugify(firstArea) : null;
            return (
              <Card
                key={mentor.id}
                onPress={() => setDetailsMentor(mentor)}
                ariaLabel={`${mentor.name}, ${mentor.role}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: T.sp2,
                  textAlign: "center",
                }}
              >
                {/* Avatar with an accent halo */}
                <div
                  className="glow-soft"
                  style={{
                    fontSize: 36,
                    lineHeight: 1,
                    width: 68,
                    height: 68,
                    borderRadius: T.rFull,
                    background: T.primarySoft,
                    border: `1px solid ${T.borderAccent}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {mentor.avatarEmoji || "🧑‍🏫"}
                </div>

                <div style={{ ...TYPO.title3, fontWeight: 700, color: T.text, width: "100%", overflowWrap: "anywhere" }}>
                  {mentor.name}
                </div>

                <div
                  style={{
                    ...TYPO.footnote,
                    color: T.text3,
                    width: "100%",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {mentor.role}
                </div>

                {mentor.lifeAreas.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", width: "100%" }}>
                    {mentor.lifeAreas.map((area) => (
                      <AreaChip key={area}>{area}</AreaChip>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: T.sp2,
                    width: "100%",
                    marginTop: "auto",
                    paddingTop: T.sp2,
                  }}
                >
                  <Button
                    size="sm"
                    fullWidth
                    iconLeft={<ChatIcon />}
                    haptic="impact"
                    onPress={(e) => {
                      e.stopPropagation();
                      setChatMentor(mentor);
                    }}
                  >
                    Pogadaj
                  </Button>

                  {disciplineSlug && (
                    <Link
                      href={`/discipline/${disciplineSlug}`}
                      onClick={(e) => e.stopPropagation()}
                      className="pressable"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        minHeight: T.tapMin,
                        width: "100%",
                        boxSizing: "border-box",
                        ...TYPO.footnote,
                        fontWeight: 700,
                        color: T.primaryOnSurface,
                        background: T.surface2,
                        border: `1px solid ${T.border}`,
                        borderRadius: T.rMd,
                        padding: `0 ${T.sp3}`,
                        textDecoration: "none",
                      }}
                    >
                      <HistoryIcon />
                      Trening
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  /* ---------------- EDIT PANEL ---------------- */

  const editPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
      {editError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: T.sp3,
            ...TYPO.callout,
            color: T.dangerOnSurface,
            background: T.dangerSoft,
            border: `1px solid ${T.danger}`,
            borderRadius: T.rMd,
            padding: `${T.sp3} ${T.sp4}`,
          }}
        >
          <span style={{ minWidth: 0 }}>{editError}</span>
          <Pressable
            onPress={() => setEditError("")}
            ariaLabel="Zamknij komunikat"
            style={{ color: T.dangerOnSurface, flexShrink: 0 }}
          >
            <Icon size={18}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </Icon>
          </Pressable>
        </div>
      )}

      {showMentorForm ? (
        <Card padding="lg">
          <h3 style={{ ...TYPO.title2, color: T.text, margin: `0 0 ${T.sp4}` }}>
            {editingMentor ? "Edytuj mentora" : "Nowy mentor"}
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
            <Field label="Nazwa" required>
              {(p) => (
                <input
                  {...p}
                  style={fieldControlStyle}
                  value={mentorForm.name}
                  onChange={(e) => setMentorForm({ ...mentorForm, name: e.target.value })}
                  placeholder="np. Coach Marek"
                />
              )}
            </Field>

            <div style={{ display: "flex", gap: T.sp3 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label="Rola" required>
                  {(p) => (
                    <input
                      {...p}
                      style={fieldControlStyle}
                      value={mentorForm.role}
                      onChange={(e) => setMentorForm({ ...mentorForm, role: e.target.value })}
                      placeholder="np. Trener personalny"
                    />
                  )}
                </Field>
              </div>
              <div style={{ width: 88, flexShrink: 0 }}>
                <Field label="Emoji">
                  {(p) => (
                    <input
                      {...p}
                      style={{ ...fieldControlStyle, textAlign: "center", padding: 0 }}
                      value={mentorForm.avatarEmoji}
                      onChange={(e) => setMentorForm({ ...mentorForm, avatarEmoji: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            </div>

            <div>
              <label style={{ ...TYPO.footnote, fontWeight: 600, color: T.text2, display: "block", marginBottom: 6 }}>
                Persona *
              </label>
              <VoiceTextarea
                value={mentorForm.persona}
                onChange={(v) => setMentorForm({ ...mentorForm, persona: v })}
                minHeight={100}
                placeholder="Opis osobowości i stylu mentora..."
              />
            </div>

            <div>
              <label style={{ ...TYPO.footnote, fontWeight: 600, color: T.text2, display: "block", marginBottom: 6 }}>
                System Prompt * (realny prompt wysyłany do API)
              </label>
              <VoiceTextarea
                value={mentorForm.systemPrompt}
                onChange={(v) => setMentorForm({ ...mentorForm, systemPrompt: v })}
                minHeight={150}
                placeholder="Instrukcje systemowe dla AI..."
              />
            </div>

            <Field
              label="Model LLM"
              required
              hint="Opus dla mentorów strategicznych, Sonnet dla większości, Haiku dla szybkich odpowiedzi"
            >
              {(p) => (
                <select
                  {...p}
                  style={fieldControlStyle}
                  value={mentorForm.model}
                  onChange={(e) => setMentorForm({ ...mentorForm, model: e.target.value })}
                >
                  {MENTOR_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {lifeAreas.length > 0 && (
              <div>
                <label style={{ ...TYPO.footnote, fontWeight: 600, color: T.text2, display: "block", marginBottom: T.sp2 }}>
                  Obszary życia
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: T.sp2 }}>
                  {lifeAreas.map((la) => {
                    const checked = mentorForm.lifeAreaIds.includes(la.id);
                    return (
                      <Pressable
                        key={la.id}
                        role="checkbox"
                        ariaChecked={checked}
                        haptic="selection"
                        noMinSize
                        onPress={() => {
                          const ids = checked
                            ? mentorForm.lifeAreaIds.filter((id) => id !== la.id)
                            : [...mentorForm.lifeAreaIds, la.id];
                          setMentorForm({ ...mentorForm, lifeAreaIds: ids });
                        }}
                        style={{
                          minHeight: T.tapMin,
                          padding: `0 ${T.sp4}`,
                          borderRadius: T.rFull,
                          ...TYPO.footnote,
                          fontWeight: 700,
                          background: checked ? T.primarySoft : T.surface2,
                          color: checked ? T.primaryOnSurface : T.text2,
                          border: `1.5px solid ${checked ? T.borderAccent : T.border}`,
                          boxShadow: checked ? T.glowAccentSoft : "none",
                          transition: "background-color 140ms linear, color 140ms linear",
                        }}
                      >
                        {la.name}
                      </Pressable>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: T.sp2, marginTop: T.sp1 }}>
              <Button size="lg" fullWidth loading={editLoading} haptic="impact" onPress={saveMentor}>
                {editingMentor ? "Zapisz zmiany" : "Dodaj mentora"}
              </Button>
              <Button variant="ghost" size="md" fullWidth onPress={resetMentorForm}>
                Anuluj
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Button
          size="md"
          iconLeft={<PlusIcon />}
          onPress={() => {
            resetMentorForm();
            setShowMentorForm(true);
          }}
        >
          Dodaj mentora
        </Button>
      )}

      {editMentors.map((m) => (
        <Card key={m.id}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: T.sp3 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: T.rFull,
                background: T.surface2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {m.avatarEmoji || "🧑‍🏫"}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...TYPO.title3, color: T.text, overflowWrap: "anywhere" }}>{m.name}</div>
              <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{m.role}</div>

              <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp2} 0 0` }}>
                {m.persona.length > 120 ? m.persona.slice(0, 120) + "..." : m.persona}
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: T.sp3 }}>
                {m.lifeAreas.map((la) => (
                  <AreaChip key={la.id} tone="muted">
                    {la.name}
                  </AreaChip>
                ))}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1.3,
                    padding: "4px 10px",
                    borderRadius: T.rFull,
                    background: m.active ? T.successSoft : T.dangerSoft,
                    color: m.active ? T.successOnSurface : T.dangerOnSurface,
                    border: `1px solid ${m.active ? T.success : T.danger}`,
                  }}
                >
                  {m.active ? "Aktywny" : "Nieaktywny"}
                </span>
                <span
                  title={m.model}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1.3,
                    padding: "4px 10px",
                    borderRadius: T.rFull,
                    background: T.surface2,
                    color: T.text3,
                    border: `1px solid ${T.border}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.model?.replace("claude-", "").replace("-20251001", "").replace(/-/g, " ") ||
                    "sonnet 4-6"}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: T.sp2, marginTop: T.sp4 }}>
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              iconLeft={<PencilIcon />}
              onPress={() => openEditMentor(m)}
            >
              Edytuj
            </Button>
            <Pressable
              onPress={() => {
                haptic.warning();
                setConfirmDelete(m.id);
              }}
              ariaLabel={`Usuń mentora ${m.name}`}
              style={{
                width: T.tapMin,
                minWidth: T.tapMin,
                height: T.tapMin,
                borderRadius: T.rMd,
                background: T.dangerSoft,
                color: T.dangerOnSurface,
                border: `1px solid ${T.danger}`,
                flexShrink: 0,
              }}
            >
              <TrashIcon />
            </Pressable>
          </div>
        </Card>
      ))}

      {editMentors.length === 0 && !showMentorForm && (
        <Card>
          <EmptyState
            icon="🧑‍🏫"
            title="Nie masz jeszcze mentorów"
            body="Mentor to persona AI z własnym promptem i obszarami życia."
            action={{ label: "Dodaj pierwszego", onPress: () => setShowMentorForm(true) }}
          />
        </Card>
      )}
    </div>
  );

  /* ---------------- RENDER ---------------- */

  const detailsSlug = detailsMentor?.lifeAreas[0] ? slugify(detailsMentor.lifeAreas[0]) : null;

  return (
    <div style={{ padding: `${T.sp6} ${T.gutter} ${T.sp6}` }}>
      {/* Header */}
      <header className="anim-in" style={{ marginBottom: T.sp5 }}>
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Twój zespół</div>
        <h1 style={{ ...TYPO.title1, color: T.text, margin: 0 }}>Mentorzy</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
          {loading
            ? "Ładuję..."
            : mentors.length === 0
              ? "Jeszcze nikogo tu nie ma"
              : `${mentors.length} ${mentors.length === 1 ? "mentor gotowy" : "mentorów gotowych"} do rozmowy`}
        </p>
      </header>

      <SegmentedTabs
        tabs={[
          { key: "view", label: "Twoi mentorzy" },
          { key: "edit", label: "Edytuj" },
        ]}
        active={tab}
        onChange={(k) => changeTab(k as PageTab)}
        ariaLabel="Widok mentorów"
        style={{ marginBottom: T.sp4 }}
      />

      <SwipeDeck
        index={tabIndex}
        onChange={(i) => changeTab(TABS[i])}
        labels={["Twoi mentorzy", "Edytuj"]}
        ariaLabel="Panele mentorów"
        enabled={!detailsMentor && !confirmDelete && !chatMentor}
      >
        {viewPanel}
        {editPanel}
      </SwipeDeck>

      {/* ─── Details sheet ─── */}
      <Sheet
        open={Boolean(detailsMentor)}
        onClose={() => setDetailsMentor(null)}
        ariaLabel={detailsMentor?.name ?? "Mentor"}
        footer={
          detailsMentor ? (
            <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
              <Button
                size="lg"
                fullWidth
                iconLeft={<ChatIcon />}
                haptic="impact"
                onPress={() => {
                  const target = detailsMentor;
                  setDetailsMentor(null);
                  setChatMentor(target);
                }}
              >
                Pogadaj z mentorem
              </Button>
              <div style={{ display: "flex", gap: T.sp2 }}>
                {detailsSlug && (
                  <Link
                    href={`/discipline/${detailsSlug}`}
                    onClick={() => setDetailsMentor(null)}
                    className="pressable"
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      minHeight: T.ctrlMd,
                      boxSizing: "border-box",
                      ...TYPO.callout,
                      fontWeight: 700,
                      color: T.primaryOnSurface,
                      background: T.surface2,
                      border: `1px solid ${T.border}`,
                      borderRadius: T.rMd,
                      textDecoration: "none",
                    }}
                  >
                    <HistoryIcon />
                    Trening
                  </Link>
                )}
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth={!detailsSlug}
                  iconLeft={<PencilIcon />}
                  style={detailsSlug ? { flex: 1 } : undefined}
                  onPress={() => {
                    const targetId = detailsMentor.id;
                    setDetailsMentor(null);
                    changeTab("edit");
                    fetch("/api/admin/mentors")
                      .then((r) => (r.ok ? r.json() : []))
                      .then((data: EditMentor[]) => {
                        setEditMentors(data);
                        const target = data.find((m) => m.id === targetId);
                        if (target) openEditMentor(target);
                      })
                      .catch(() => {});
                  }}
                >
                  Edytuj
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {detailsMentor && (
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: T.sp4 }}>
              <div
                className="glow-soft"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: T.rFull,
                  background: T.primarySoft,
                  border: `1px solid ${T.borderAccent}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 38,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                {detailsMentor.avatarEmoji || "🧑‍🏫"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...TYPO.title2, color: T.text, overflowWrap: "anywhere" }}>
                  {detailsMentor.name}
                </div>
                <div style={{ ...TYPO.footnote, color: T.text3, marginTop: T.sp1 }}>
                  {detailsMentor.role}
                </div>
              </div>
            </div>

            {detailsMentor.persona && (
              <section>
                <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>Opis</div>
                <div style={{ ...TYPO.callout, color: T.text2, whiteSpace: "pre-wrap" }}>
                  {detailsMentor.persona}
                </div>
              </section>
            )}

            {detailsMentor.lifeAreas.length > 0 && (
              <section>
                <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>Twoje obszary</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {detailsMentor.lifeAreas.map((area) => (
                    <AreaChip key={area}>{area}</AreaChip>
                  ))}
                </div>
              </section>
            )}

            {detailsMentor.style && (
              <section>
                <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>Styl</div>
                <AreaChip tone="muted">{detailsMentor.style}</AreaChip>
              </section>
            )}
          </div>
        )}
      </Sheet>

      {/* ─── Delete confirmation sheet ─── */}
      <Sheet
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Usunąć mentora?"
        dismissOnBackdrop={false}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button
              variant="danger"
              size="lg"
              fullWidth
              loading={editLoading}
              haptic="warning"
              onPress={() => confirmDelete && deleteMentor(confirmDelete)}
            >
              Usuń mentora
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={() => setConfirmDelete(null)}>
              Anuluj
            </Button>
          </div>
        }
      >
        <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
          Tej operacji nie da się cofnąć. Rozmowy z tym mentorem przestaną być dostępne.
        </p>
      </Sheet>

      {/* Mentor 1-on-1 chat overlay */}
      {chatMentor && (
        <MentorChat
          mentor={{
            id: chatMentor.id,
            name: chatMentor.name,
            role: chatMentor.role,
            avatarEmoji: chatMentor.avatarEmoji,
          }}
          onClose={() => setChatMentor(null)}
        />
      )}
    </div>
  );
}

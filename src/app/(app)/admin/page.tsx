"use client";

import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import FileUpload from "@/components/files/FileUpload";
import FileList from "@/components/files/FileList";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import MicDevicePicker from "@/components/forms/MicDevicePicker";

type Tab = "overview" | "users" | "mydata" | "mentors" | "files" | "data" | "feedback" | "settings";

interface StatsData {
  totalUsers: number;
  totalDailyLogs: number;
  totalActivities: number;
  totalBriefings: number;
  totalRoundTables: number;
  totalFiles: number;
  last7Days: { date: string; count: number }[];
}

interface UserData {
  id: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "USER";
  createdAt: string;
  _count: { dailyLogs: number; mentors: number };
}

interface AllowedEmailData {
  id: string;
  email: string;
  role: "ADMIN" | "USER";
  createdAt: string;
}

interface MentorLifeArea {
  id: string;
  name: string;
}

interface MentorData {
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

const MENTOR_MODELS = [
  { id: "claude-opus-4-6", label: "Opus 4.6 (najinteligentniejszy)" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (zbalansowany)" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (szybki/tani)" },
];

// ─── Styles ───

const card: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 20,
  boxShadow: "var(--card-shadow)",
};

const pill = (active: boolean): React.CSSProperties => ({
  padding: "8px 18px",
  borderRadius: 20,
  fontSize: 14,
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
  background: active ? "var(--primary)" : "var(--background)",
  color: active ? "#fff" : "var(--muted)",
  transition: "all 0.2s",
});

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

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 100,
  resize: "vertical" as const,
  fontFamily: "monospace",
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

const roleBadge = (role: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
  background: role === "ADMIN" ? "var(--primary)" : "var(--background)",
  color: role === "ADMIN" ? "#fff" : "var(--muted)",
});

// ─── Component ───

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");

  // Stats
  const [stats, setStats] = useState<StatsData | null>(null);

  // Users
  const [users, setUsers] = useState<UserData[]>([]);
  const [allowedEmails, setAllowedEmails] = useState<AllowedEmailData[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newEmailRole, setNewEmailRole] = useState<"USER" | "ADMIN">("USER");

  // Mentors
  const [mentors, setMentors] = useState<MentorData[]>([]);
  const [lifeAreas, setLifeAreas] = useState<MentorLifeArea[]>([]);
  const [editingMentor, setEditingMentor] = useState<MentorData | null>(null);
  const [showMentorForm, setShowMentorForm] = useState(false);
  const [mentorForm, setMentorForm] = useState({
    name: "",
    role: "",
    persona: "",
    systemPrompt: "",
    avatarEmoji: "🧑‍🏫",
    model: "claude-sonnet-4-6",
    lifeAreaIds: [] as string[],
  });

  // Files
  const [fileRefresh, setFileRefresh] = useState(0);

  // UI
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ─── Auth guard ───
  useEffect(() => {
    if (!isLoading && (!user || user.role !== "ADMIN")) {
      router.replace("/");
    }
  }, [isLoading, user, router]);

  // ─── Data fetching ───
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) setStats(await res.json());
    } catch {}
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setAllowedEmails(data.allowedEmails);
      }
    } catch {}
  }, []);

  const fetchMentors = useCallback(async () => {
    try {
      const [mentorsRes, areasRes] = await Promise.all([
        fetch("/api/admin/mentors"),
        fetch("/api/admin/life-areas"),
      ]);
      if (mentorsRes.ok) setMentors(await mentorsRes.json());
      if (areasRes.ok) setLifeAreas(await areasRes.json());
      else setLifeAreas([]);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;
    if (tab === "overview") fetchStats();
    if (tab === "users") fetchUsers();
    if (tab === "mentors") fetchMentors();
  }, [tab, user, fetchStats, fetchUsers, fetchMentors]);

  // ─── Actions ───
  const addEmail = async () => {
    if (!newEmail.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), role: newEmailRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Błąd dodawania");
      } else {
        setNewEmail("");
        setNewEmailRole("USER");
        fetchUsers();
      }
    } catch {
      setError("Błąd połączenia");
    }
    setLoading(false);
  };

  const removeEmail = async (email: string) => {
    setLoading(true);
    try {
      await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      fetchUsers();
    } catch {}
    setLoading(false);
    setConfirmDelete(null);
  };

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

  const openEditMentor = (m: MentorData) => {
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
    if (!mentorForm.name || !mentorForm.role || !mentorForm.persona || !mentorForm.systemPrompt) {
      setError("Wypełnij wszystkie wymagane pola");
      return;
    }
    setLoading(true);
    setError("");
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
        setError(data.error || "Błąd zapisu");
      } else {
        resetMentorForm();
        fetchMentors();
      }
    } catch {
      setError("Błąd połączenia");
    }
    setLoading(false);
  };

  const deleteMentor = async (id: string) => {
    setLoading(true);
    try {
      await fetch("/api/admin/mentors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchMentors();
    } catch {}
    setLoading(false);
    setConfirmDelete(null);
  };

  // ─── Guard render ───
  if (isLoading || !user || user.role !== "ADMIN") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
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

  // ─── Tabs ───
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Przegląd" },
    { key: "users", label: "Użytkownicy" },
    { key: "mydata", label: "Moje dane" },
    { key: "mentors", label: "Mentorzy" },
    { key: "files", label: "Pliki" },
    { key: "data", label: "Dane" },
    { key: "feedback", label: "Feedback" },
    { key: "settings", label: "Ustawienia" },
  ];

  return (
    <div style={{ padding: "24px 16px" }}>
      {/* Header */}
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "var(--foreground)",
          marginBottom: 4,
        }}
      >
        Admin Panel
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>
        Zarządzanie aplikacją PAPI PLANER
      </p>

      {/* Tab navigation */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 24,
          overflowX: "auto",
          paddingBottom: 4,
        }}
      >
        {tabs.map((t) => (
          <button key={t.key} style={pill(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            ...card,
            background: "#fef2f2",
            color: "var(--danger)",
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {error}
          <button
            onClick={() => setError("")}
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

      {/* Confirm dialog */}
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
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Czy na pewno?</p>
            <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 20 }}>
              Ta akcja jest nieodwracalna.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button style={btnSecondary} onClick={() => setConfirmDelete(null)}>
                Anuluj
              </button>
              <button
                style={btnDanger}
                onClick={() => {
                  if (confirmDelete.startsWith("email:")) {
                    removeEmail(confirmDelete.slice(6));
                  } else if (confirmDelete.startsWith("mentor:")) {
                    deleteMentor(confirmDelete.slice(7));
                  }
                }}
              >
                Usuń
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── OVERVIEW TAB ─── */}
      {tab === "overview" && (
        <div>
          {!stats ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>Ładowanie...</p>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 24,
                }}
              >
                <StatCard label="Użytkownicy" value={stats.totalUsers} emoji="👥" />
                <StatCard label="Dzienniki" value={stats.totalDailyLogs} emoji="📓" />
                <StatCard label="Aktywności" value={stats.totalActivities} emoji="🏃" />
                <StatCard label="Briefingi" value={stats.totalBriefings} emoji="📋" />
                <StatCard label="Okrągłe stoły" value={stats.totalRoundTables} emoji="🗣️" />
                <StatCard label="Pliki" value={stats.totalFiles} emoji="📁" />
              </div>

              <div style={card}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                  Dzienniki — ostatnie 7 dni
                </h3>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
                  {stats.last7Days.map((day) => {
                    const max = Math.max(...stats.last7Days.map((d) => d.count), 1);
                    const h = Math.max((day.count / max) * 60, 4);
                    return (
                      <div key={day.date} style={{ flex: 1, textAlign: "center" }}>
                        <div
                          style={{
                            height: h,
                            background: "var(--primary)",
                            borderRadius: 4,
                            marginBottom: 4,
                            opacity: day.count === 0 ? 0.2 : 1,
                          }}
                        />
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>
                          {day.date.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── USERS TAB ─── */}
      {tab === "users" && (
        <div>
          {/* Add email form */}
          <div style={{ ...card, marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              Dodaj email do whitelisty
            </h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                placeholder="email@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addEmail()}
              />
              <select
                style={{ ...inputStyle, width: 100, flex: "none" }}
                value={newEmailRole}
                onChange={(e) => setNewEmailRole(e.target.value as "USER" | "ADMIN")}
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              <button style={btnPrimary} onClick={addEmail} disabled={loading}>
                Dodaj
              </button>
            </div>
          </div>

          {/* Whitelisted emails */}
          <div style={{ ...card, marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              Dozwolone emaile ({allowedEmails.length})
            </h3>
            {allowedEmails.map((ae) => (
              <div
                key={ae.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <span style={{ fontSize: 14 }}>{ae.email}</span>
                  <span style={{ ...roleBadge(ae.role), marginLeft: 8 }}>{ae.role}</span>
                </div>
                <button
                  style={btnDanger}
                  onClick={() => setConfirmDelete(`email:${ae.email}`)}
                >
                  Usuń
                </button>
              </div>
            ))}
            {allowedEmails.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Brak emaili</p>
            )}
          </div>

          {/* Users table */}
          <div style={card}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              Zarejestrowani użytkownicy ({users.length})
            </h3>
            {users.map((u, i) => (
              <div
                key={u.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 8px",
                  borderBottom: i < users.length - 1 ? "1px solid var(--border)" : "none",
                  background: i % 2 === 0 ? "transparent" : "var(--background)",
                  borderRadius: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{u.name || "—"}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={roleBadge(u.role)}>{u.role}</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {u._count.dailyLogs} logów
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {new Date(u.createdAt).toLocaleDateString("pl")}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {users.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Brak użytkowników</p>
            )}
          </div>
        </div>
      )}

      {/* ─── MY DATA TAB ─── */}
      {tab === "mydata" && <MyDataTab />}

      {/* ─── MENTORS TAB ─── */}
      {tab === "mentors" && (
        <div>
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
                    onChange={(e) => setMentorForm({ ...mentorForm, name: e.target.value })}
                    placeholder="np. Coach Marek"
                  />
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Rola *</label>
                    <input
                      style={inputStyle}
                      value={mentorForm.role}
                      onChange={(e) => setMentorForm({ ...mentorForm, role: e.target.value })}
                      placeholder="np. Trener personalny"
                    />
                  </div>
                  <div style={{ width: 80 }}>
                    <label style={labelStyle}>Emoji</label>
                    <input
                      style={inputStyle}
                      value={mentorForm.avatarEmoji}
                      onChange={(e) =>
                        setMentorForm({ ...mentorForm, avatarEmoji: e.target.value })
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
                  <label style={labelStyle}>System Prompt * (realny prompt wysyłany do API)</label>
                  <VoiceTextarea
                    value={mentorForm.systemPrompt}
                    onChange={(v) => setMentorForm({ ...mentorForm, systemPrompt: v })}
                    minHeight={150}
                    placeholder="Instrukcje systemowe dla AI..."
                  />
                </div>
                <div>
                  <label style={labelStyle}>Model LLM *</label>
                  <select
                    style={inputStyle}
                    value={mentorForm.model}
                    onChange={(e) => setMentorForm({ ...mentorForm, model: e.target.value })}
                  >
                    {MENTOR_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    Opus dla mentorów strategicznych, Sonnet dla większości, Haiku dla szybkich odpowiedzi
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
                              background: checked ? "var(--primary)" : "var(--background)",
                              color: checked ? "#fff" : "var(--foreground)",
                              border: `1.5px solid ${checked ? "var(--primary)" : "var(--border)"}`,
                              transition: "all 0.15s",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const ids = checked
                                  ? mentorForm.lifeAreaIds.filter((id) => id !== la.id)
                                  : [...mentorForm.lifeAreaIds, la.id];
                                setMentorForm({ ...mentorForm, lifeAreaIds: ids });
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
                  <button style={btnPrimary} onClick={saveMentor} disabled={loading}>
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

          {/* Mentors list */}
          {mentors.map((m) => (
            <div key={m.id} style={{ ...card, marginBottom: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 24 }}>{m.avatarEmoji || "🧑‍🏫"}</span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{m.role}</div>
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
                    {m.persona.length > 120 ? m.persona.slice(0, 120) + "..." : m.persona}
                  </p>
                  {m.lifeAreas.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
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
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
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
                      🧠 {m.model?.replace("claude-", "").replace("-20251001", "").replace(/-/g, " ") || "sonnet 4-6"}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginLeft: 12 }}>
                  <button style={btnSecondary} onClick={() => openEditMentor(m)}>
                    Edytuj
                  </button>
                  <button
                    style={btnDanger}
                    onClick={() => setConfirmDelete(`mentor:${m.id}`)}
                  >
                    Usuń
                  </button>
                </div>
              </div>
            </div>
          ))}
          {mentors.length === 0 && !showMentorForm && (
            <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
              Brak mentorów. Dodaj pierwszego!
            </p>
          )}
        </div>
      )}

      {/* ─── FILES TAB ─── */}
      {tab === "files" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              Przeslij plik
            </h3>
            <FileUpload
              onUploadComplete={() => setFileRefresh((n) => n + 1)}
            />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              Przeslane pliki
            </h3>
            <FileList refreshTrigger={fileRefresh} />
          </div>
        </div>
      )}

      {/* ─── FEEDBACK TAB ─── */}
      {tab === "feedback" && <FeedbackTab />}

      {tab === "settings" && <SettingsTab />}

      {/* ─── DATA TAB ─── */}
      {tab === "data" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* DB Status */}
          <div style={card}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Status bazy danych</h3>
            <DbStatus />
          </div>

          {/* Export placeholder */}
          <div style={card}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Eksport danych</h3>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Eksport danych użytkowników i logów (wkrótce).
            </p>
            <button style={{ ...btnSecondary, opacity: 0.5, cursor: "not-allowed" }} disabled>
              Eksportuj CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function StatCard({
  label,
  value,
  emoji,
}: {
  label: string;
  value: number;
  emoji: string;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        borderRadius: 16,
        padding: "16px 14px",
        boxShadow: "var(--card-shadow)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 28 }}>{emoji}</span>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      </div>
    </div>
  );
}

interface FeedbackItem {
  id: string;
  type: string;
  message: string;
  status: string;
  createdAt: string;
  user: { name: string | null; email: string };
}

const feedbackTypes = [
  { value: "bug", label: "Bug", color: "var(--danger)" },
  { value: "idea", label: "Pomysł", color: "var(--primary)" },
  { value: "change", label: "Zmiana", color: "var(--warning)" },
];

const feedbackStatuses = [
  { value: "new", label: "Nowe", color: "var(--primary)" },
  { value: "in_progress", label: "W toku", color: "var(--warning)" },
  { value: "done", label: "Zrobione", color: "var(--success)" },
];

function FeedbackTab() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [message, setMessage] = useState("");
  const [type, setType] = useState("change");
  const [sending, setSending] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const { isRecording, startRecording, stopRecording, audioBlob, duration } = useVoiceRecorder();
  const lastBlobRef = useRef<Blob | null>(null);

  const transcribeAudio = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");
      const res = await fetch("/api/voice/transcribe", { method: "POST", body: formData });
      if (res.ok) {
        const { text: transcribed } = await res.json();
        if (transcribed) {
          setMessage((prev) => (prev ? `${prev} ${transcribed}` : transcribed));
        }
      }
    } catch {}
    setIsTranscribing(false);
  }, []);

  if (audioBlob && audioBlob !== lastBlobRef.current) {
    lastBlobRef.current = audioBlob;
    transcribeAudio(audioBlob);
  }

  const fetchFeedback = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feedback");
      if (res.ok) setItems(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const submit = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message }),
      });
      if (res.ok) {
        setMessage("");
        fetchFeedback();
      }
    } catch {}
    setSending(false);
  };

  const updateStatus = async (id: string, status: string) => {
    await fetch("/api/admin/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    fetchFeedback();
  };

  const remove = async (id: string) => {
    await fetch("/api/admin/feedback", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchFeedback();
  };

  const getTypeInfo = (t: string) => feedbackTypes.find((ft) => ft.value === t) || feedbackTypes[2];
  const getStatusInfo = (s: string) => feedbackStatuses.find((fs) => fs.value === s) || feedbackStatuses[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          Nowy feedback
        </h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {feedbackTypes.map((ft) => (
            <button
              key={ft.value}
              onClick={() => setType(ft.value)}
              style={{
                padding: "6px 14px",
                borderRadius: 12,
                border: type === ft.value ? `2px solid ${ft.color}` : "2px solid var(--border)",
                background: type === ft.value ? ft.color : "var(--background)",
                color: type === ft.value ? "#fff" : "var(--foreground)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {ft.label}
            </button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <textarea
            style={{
              width: "100%",
              padding: "12px 50px 12px 14px",
              borderRadius: 12,
              border: "1.5px solid var(--border)",
              fontSize: 14,
              background: "var(--background)",
              color: "var(--foreground)",
              outline: "none",
              boxSizing: "border-box" as const,
              minHeight: 100,
              resize: "vertical" as const,
            }}
            placeholder={isTranscribing ? "Transkrybuje nagranie..." : "Opisz bug, pomysł lub zmianę... (lub kliknij mikrofon)"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={isRecording || isTranscribing}
          />
          <button
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            disabled={isTranscribing}
            title={isRecording ? "Zatrzymaj nagrywanie" : "Nagraj feedback"}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              cursor: isTranscribing ? "not-allowed" : "pointer",
              background: isRecording ? "var(--danger)" : "var(--background)",
              boxShadow: isRecording ? "0 0 0 3px rgba(239,68,68,0.25)" : "0 1px 3px rgba(0,0,0,0.1)",
              fontSize: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 150ms ease",
            }}
          >
            {isRecording ? "⏹️" : "🎙️"}
          </button>
        </div>
        {isRecording && (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--danger)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", animation: "pulse 1.5s ease-in-out infinite" }} />
            Nagrywam... {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, "0")}
          </div>
        )}
        {isTranscribing && (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
            Transkrybuje...
          </div>
        )}
        <button
          style={{
            marginTop: 12,
            padding: "10px 24px",
            borderRadius: 12,
            border: "none",
            background: "var(--primary)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            opacity: sending ? 0.6 : 1,
          }}
          onClick={submit}
          disabled={sending}
        >
          {sending ? "Wysyłanie..." : "Wyślij feedback"}
        </button>
      </div>

      <div>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          Lista feedbacku ({items.length})
        </h3>
        {items.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Brak feedbacku</p>
        )}
        {items.map((item) => {
          const typeInfo = getTypeInfo(item.type);
          const statusInfo = getStatusInfo(item.status);
          return (
            <div key={item.id} style={{ ...card, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 10px",
                      borderRadius: 8,
                      background: typeInfo.color,
                      color: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    {typeInfo.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 10px",
                      borderRadius: 8,
                      background: statusInfo.color,
                      color: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    {statusInfo.label}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  {new Date(item.createdAt).toLocaleDateString("pl")}
                </span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 12, whiteSpace: "pre-wrap" }}>
                {item.message}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {feedbackStatuses.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => updateStatus(item.id, s.value)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 8,
                      border: item.status === s.value ? `2px solid ${s.color}` : "1px solid var(--border)",
                      background: item.status === s.value ? s.color : "transparent",
                      color: item.status === s.value ? "#fff" : "var(--muted)",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  onClick={() => remove(item.id)}
                  style={{
                    marginLeft: "auto",
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--danger)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Usuń
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── My Data Tab ───

interface MyDataMetrics {
  bmr: number | null;
  tdee: number | null;
  targetCalories: number | null;
  activityFactor: number | null;
}

interface MyDataPayload {
  user: { name: string | null; email: string };
  data: Record<string, unknown>;
  counts: {
    goals: number;
    activities: number;
    trainingLogs: number;
    dailyLogs: number;
    briefings: number;
  };
  metrics?: MyDataMetrics;
  markdown: string;
}

// ─── Typed biometric form definition ───

const TYPED_KEYS_SET = new Set([
  "gender",
  "age",
  "heightCm",
  "weightKg",
  "bodyFatPct",
  "activityLevel",
  "goal",
  "weeklyTargetKg",
  "targetCalories",
]);

const GENDER_OPTIONS = [
  { value: "", label: "— wybierz —" },
  { value: "male", label: "Mężczyzna" },
  { value: "female", label: "Kobieta" },
];

const ACTIVITY_OPTIONS = [
  { value: "", label: "— wybierz —" },
  { value: "sedentary", label: "Siedzący (brak ruchu)" },
  { value: "light", label: "Lekka (1-3x/tydz.)" },
  { value: "moderate", label: "Średnia (3-5x/tydz.)" },
  { value: "high", label: "Duża (6-7x/tydz.)" },
  { value: "very_high", label: "Bardzo duża (codziennie intensywnie)" },
];

const GOAL_OPTIONS = [
  { value: "", label: "— wybierz —" },
  { value: "cut", label: "Redukcja" },
  { value: "maintain", label: "Utrzymanie" },
  { value: "bulk", label: "Masa" },
];

interface TypedForm {
  gender: string;
  age: string;
  heightCm: string;
  weightKg: string;
  bodyFatPct: string;
  activityLevel: string;
  goal: string;
  weeklyTargetKg: string;
  targetCalories: string;
}

const EMPTY_TYPED_FORM: TypedForm = {
  gender: "",
  age: "",
  heightCm: "",
  weightKg: "",
  bodyFatPct: "",
  activityLevel: "",
  goal: "",
  weeklyTargetKg: "",
  targetCalories: "",
};

function typedFormFromData(data: Record<string, unknown>): TypedForm {
  return {
    gender: typeof data.gender === "string" ? data.gender : "",
    age: typeof data.age === "number" ? String(data.age) : typeof data.age === "string" ? data.age : "",
    heightCm:
      typeof data.heightCm === "number"
        ? String(data.heightCm)
        : typeof data.heightCm === "string"
          ? data.heightCm
          : "",
    weightKg:
      typeof data.weightKg === "number"
        ? String(data.weightKg)
        : typeof data.weightKg === "string"
          ? data.weightKg
          : "",
    bodyFatPct:
      typeof data.bodyFatPct === "number"
        ? String(data.bodyFatPct)
        : typeof data.bodyFatPct === "string"
          ? data.bodyFatPct
          : "",
    activityLevel: typeof data.activityLevel === "string" ? data.activityLevel : "",
    goal: typeof data.goal === "string" ? data.goal : "",
    weeklyTargetKg:
      typeof data.weeklyTargetKg === "number"
        ? String(data.weeklyTargetKg)
        : typeof data.weeklyTargetKg === "string"
          ? data.weeklyTargetKg
          : "",
    targetCalories:
      typeof data.targetCalories === "number"
        ? String(data.targetCalories)
        : typeof data.targetCalories === "string"
          ? data.targetCalories
          : "",
  };
}

function typedFormToPayload(form: TypedForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (form.gender) out.gender = form.gender;
  if (form.activityLevel) out.activityLevel = form.activityLevel;
  if (form.goal) out.goal = form.goal;
  const numericKeys: (keyof TypedForm)[] = [
    "age",
    "heightCm",
    "weightKg",
    "bodyFatPct",
    "weeklyTargetKg",
    "targetCalories",
  ];
  for (const k of numericKeys) {
    const raw = form[k].trim();
    if (raw === "") continue;
    const parsed = parseFloat(raw.replace(",", "."));
    if (Number.isFinite(parsed)) {
      out[k as string] = parsed;
    }
  }
  return out;
}

// Known field definitions (Polish UI). Order matters — shown top-down.
// `multiline: true` renders VoiceTextarea; `multiline: false` renders plain input.
// NOTE: biometric fields (gender, age, heightCm, weightKg, bodyFatPct, activityLevel, goal, ...)
// are now rendered in a separate TYPED form section above. Do NOT duplicate them here.
const PROFILE_FIELDS: { key: string; label: string; multiline: boolean; placeholder?: string }[] = [
  {
    key: "shortTermGoals",
    label: "Cele krótkoterminowe",
    multiline: true,
    placeholder: "Cele na najbliższe 1-3 miesiące...",
  },
  {
    key: "longTermGoals",
    label: "Cele długoterminowe",
    multiline: true,
    placeholder: "Cele roczne i dalsze...",
  },
  {
    key: "medicalConditions",
    label: "Choroby / ograniczenia",
    multiline: true,
    placeholder: "Diagnozy, schorzenia, ograniczenia ruchowe...",
  },
  {
    key: "injuries",
    label: "Kontuzje",
    multiline: true,
    placeholder: "Przebyte kontuzje, obecne dolegliwości...",
  },
  {
    key: "allergies",
    label: "Alergie",
    multiline: true,
    placeholder: "Alergie pokarmowe, leki...",
  },
  {
    key: "medications",
    label: "Leki",
    multiline: true,
    placeholder: "Stałe leki, dawki...",
  },
  {
    key: "trainingPreferences",
    label: "Preferencje treningowe",
    multiline: true,
    placeholder: "Co lubisz, czego unikasz, godziny treningu...",
  },
  {
    key: "trainingFrequency",
    label: "Częstotliwość treningów",
    multiline: false,
    placeholder: "np. 4x/tydzień",
  },
  {
    key: "trainingExperience",
    label: "Doświadczenie treningowe",
    multiline: true,
    placeholder: "Lata treningu, dyscypliny, poziom...",
  },
  {
    key: "supplementation",
    label: "Suplementacja",
    multiline: true,
    placeholder: "Suplementy, dawki, godziny przyjmowania...",
  },
  {
    key: "diet",
    label: "Dieta",
    multiline: true,
    placeholder: "Sposób odżywiania, kalorie, makro...",
  },
  { key: "sleepHours", label: "Sen (godz./dobę)", multiline: false, placeholder: "np. 7" },
  {
    key: "experience",
    label: "Doświadczenie",
    multiline: true,
    placeholder: "Ogólne doświadczenie życiowe / zawodowe...",
  },
  {
    key: "notes",
    label: "Inne notatki",
    multiline: true,
    placeholder: "Cokolwiek mentor powinien wiedzieć...",
  },
];

function toStringValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function MyDataTab() {
  const [payload, setPayload] = useState<MyDataPayload | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<TypedForm>(EMPTY_TYPED_FORM);
  const [extraKey, setExtraKey] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const buildFormFromData = useCallback((data: Record<string, unknown>) => {
    const next: Record<string, string> = {};
    for (const f of PROFILE_FIELDS) {
      next[f.key] = toStringValue(data[f.key]);
    }
    // Extra fields not in PROFILE_FIELDS and not typed — include them so user can edit
    const knownKeys = new Set(PROFILE_FIELDS.map((f) => f.key));
    for (const k of Object.keys(data)) {
      if (!knownKeys.has(k) && !TYPED_KEYS_SET.has(k)) {
        next[k] = toStringValue(data[k]);
      }
    }
    return next;
  }, []);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/admin/my-data");
      if (!res.ok) {
        setLoadError("Nie udało się załadować danych");
        return;
      }
      const data: MyDataPayload = await res.json();
      setPayload(data);
      setForm(buildFormFromData(data.data || {}));
      setTyped(typedFormFromData(data.data || {}));
    } catch {
      setLoadError("Błąd połączenia");
    }
  }, [buildFormFromData]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      // Free-form fields: only send non-empty values to keep storage tidy
      const freeForm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) {
        if (v.trim() === "") continue;
        if (TYPED_KEYS_SET.has(k)) continue; // never overwrite typed keys from free-form bucket
        freeForm[k] = v;
      }
      const typedPayload = typedFormToPayload(typed);
      // Typed keys take precedence
      const out = { ...freeForm, ...typedPayload };

      const res = await fetch("/api/admin/my-data", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: out }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast("err", err?.error || "Błąd zapisu");
      } else {
        const data: MyDataPayload = await res.json();
        setPayload(data);
        setForm(buildFormFromData(data.data || {}));
        setTyped(typedFormFromData(data.data || {}));
        showToast("ok", "Zapisano");
      }
    } catch {
      showToast("err", "Błąd połączenia");
    }
    setSaving(false);
  };

  const copyMarkdown = async () => {
    if (!payload?.markdown) return;
    try {
      await navigator.clipboard.writeText(payload.markdown);
      showToast("ok", "Skopiowano Markdown do schowka");
    } catch {
      showToast("err", "Nie udało się skopiować");
    }
  };

  const addExtraField = () => {
    const key = extraKey.trim();
    if (!key) return;
    if (TYPED_KEYS_SET.has(key)) {
      showToast("err", "To pole jest częścią danych biometrycznych — edytuj je w sekcji powyżej");
      return;
    }
    if (key in form) {
      showToast("err", "Pole o takim kluczu już istnieje");
      return;
    }
    setForm((prev) => ({ ...prev, [key]: extraValue }));
    setExtraKey("");
    setExtraValue("");
  };

  if (loadError) {
    return (
      <div style={{ ...card, background: "#fef2f2", color: "var(--danger)", fontSize: 14 }}>
        {loadError}
      </div>
    );
  }

  if (!payload) {
    return <p style={{ color: "var(--muted)", fontSize: 14 }}>Ładowanie...</p>;
  }

  const knownKeys = new Set(PROFILE_FIELDS.map((f) => f.key));
  const extraKeys = Object.keys(form).filter((k) => !knownKeys.has(k));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            ...card,
            background: toast.kind === "ok" ? "#dcfce7" : "#fef2f2",
            color: toast.kind === "ok" ? "var(--success)" : "var(--danger)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header / summary */}
      <div style={card}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Moje dane (kontekst dla mentorów)</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
          Te informacje są źródłem prawdy, z którego mentorzy AI budują swój kontekst o Tobie. Aktualizuj
          je gdy zmieniają się Twoje cele, parametry lub ograniczenia.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <SummaryPill emoji="🎯" label="Cele" value={payload.counts.goals} />
          <SummaryPill emoji="🏃" label="Aktywności" value={payload.counts.activities} />
          <SummaryPill emoji="💪" label="Treningi" value={payload.counts.trainingLogs} />
          <SummaryPill emoji="📓" label="Dzienniki" value={payload.counts.dailyLogs} />
          <SummaryPill emoji="📋" label="Briefingi" value={payload.counts.briefings} />
        </div>
      </div>

      {/* Typed biometric form */}
      <div style={card}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          🧬 Dane biometryczne (dla BMR/TDEE)
        </h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          Wymagane do automatycznego obliczania zapotrzebowania kalorycznego (Mifflin-St Jeor).
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <label style={labelStyle}>Płeć</label>
            <select
              style={inputStyle}
              value={typed.gender}
              onChange={(e) => setTyped((p) => ({ ...p, gender: e.target.value }))}
            >
              {GENDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Wiek</label>
            <input
              type="number"
              min={10}
              max={100}
              style={inputStyle}
              value={typed.age}
              placeholder="np. 38"
              onChange={(e) => setTyped((p) => ({ ...p, age: e.target.value }))}
            />
          </div>

          <div>
            <label style={labelStyle}>Wzrost (cm)</label>
            <input
              type="number"
              min={100}
              max={250}
              style={inputStyle}
              value={typed.heightCm}
              placeholder="np. 178"
              onChange={(e) => setTyped((p) => ({ ...p, heightCm: e.target.value }))}
            />
          </div>

          <div>
            <label style={labelStyle}>Waga (kg)</label>
            <input
              type="number"
              min={30}
              max={250}
              step="0.1"
              style={inputStyle}
              value={typed.weightKg}
              placeholder="np. 89"
              onChange={(e) => setTyped((p) => ({ ...p, weightKg: e.target.value }))}
            />
          </div>

          <div>
            <label style={labelStyle}>Tkanka tłuszczowa (%) — opcjonalnie</label>
            <input
              type="number"
              min={5}
              max={50}
              step="0.1"
              style={inputStyle}
              value={typed.bodyFatPct}
              placeholder="np. 18"
              onChange={(e) => setTyped((p) => ({ ...p, bodyFatPct: e.target.value }))}
            />
          </div>

          <div>
            <label style={labelStyle}>Poziom aktywności</label>
            <select
              style={inputStyle}
              value={typed.activityLevel}
              onChange={(e) => setTyped((p) => ({ ...p, activityLevel: e.target.value }))}
            >
              {ACTIVITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Cel</label>
            <select
              style={inputStyle}
              value={typed.goal}
              onChange={(e) => setTyped((p) => ({ ...p, goal: e.target.value }))}
            >
              {GOAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Tempo (kg/tydzień) — opcjonalnie</label>
            <input
              type="number"
              min={0}
              max={2}
              step="0.1"
              style={inputStyle}
              value={typed.weeklyTargetKg}
              placeholder="np. 0.5"
              onChange={(e) => setTyped((p) => ({ ...p, weeklyTargetKg: e.target.value }))}
            />
          </div>

          <div>
            <label style={labelStyle}>Limit kalorii (nadpisuje auto)</label>
            <input
              type="number"
              min={800}
              max={8000}
              step="10"
              style={inputStyle}
              value={typed.targetCalories}
              placeholder="zostaw puste = auto"
              onChange={(e) => setTyped((p) => ({ ...p, targetCalories: e.target.value }))}
            />
          </div>
        </div>

        {/* Computed metrics preview */}
        {payload?.metrics && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 12,
              background: "var(--background)",
              border: "1px solid var(--border)",
              fontSize: 13,
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
            }}
          >
            {payload.metrics.bmr !== null ? (
              <span>
                🌡️ <strong>BMR:</strong> {payload.metrics.bmr} kcal/dzień
              </span>
            ) : (
              <span style={{ color: "var(--muted)" }}>
                🌡️ BMR: uzupełnij płeć, wiek, wzrost i wagę
              </span>
            )}
            {payload.metrics.tdee !== null && (
              <span>
                📊 <strong>TDEE:</strong> {payload.metrics.tdee} kcal/dzień
              </span>
            )}
            {payload.metrics.targetCalories !== null && (
              <span>
                🎯 <strong>Cel:</strong> {payload.metrics.targetCalories} kcal/dzień
              </span>
            )}
          </div>
        )}
      </div>

      {/* Form */}
      <div style={card}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Profil</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {PROFILE_FIELDS.map((f) => (
            <div key={f.key}>
              <label style={labelStyle}>{f.label}</label>
              {f.multiline ? (
                <VoiceTextarea
                  value={form[f.key] || ""}
                  onChange={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
                  minHeight={80}
                  placeholder={f.placeholder}
                />
              ) : (
                <input
                  style={inputStyle}
                  value={form[f.key] || ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
              )}
            </div>
          ))}

          {extraKeys.length > 0 && (
            <div
              style={{
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>Dodatkowe pola</div>
              {extraKeys.map((k) => (
                <div key={k}>
                  <label style={labelStyle}>{k}</label>
                  <VoiceTextarea
                    value={form[k] || ""}
                    onChange={(v) => setForm((prev) => ({ ...prev, [k]: v }))}
                    minHeight={60}
                    placeholder={`Wartość dla "${k}"...`}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Add custom field */}
          <div
            style={{
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>
              Dodaj własne pole
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                style={{ ...inputStyle, flex: "1 1 160px", minWidth: 140 }}
                placeholder="klucz (np. ulubionySport)"
                value={extraKey}
                onChange={(e) => setExtraKey(e.target.value)}
              />
              <input
                style={{ ...inputStyle, flex: "2 1 240px", minWidth: 180 }}
                placeholder="wartość początkowa"
                value={extraValue}
                onChange={(e) => setExtraValue(e.target.value)}
              />
              <button style={btnSecondary} onClick={addExtraField}>
                Dodaj
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <button style={btnPrimary} onClick={save} disabled={saving}>
            {saving ? "Zapisywanie..." : "Zapisz"}
          </button>
          <button style={btnSecondary} onClick={copyMarkdown}>
            Skopiuj jako Markdown
          </button>
          <button style={btnSecondary} onClick={load} disabled={saving}>
            Odśwież
          </button>
        </div>
      </div>

      {/* Markdown preview */}
      <div style={card}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Podgląd Markdown</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          Format używany do feedowania kontekstu do mentorów AI.
        </p>
        <pre
          style={{
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 12,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 360,
            overflow: "auto",
            margin: 0,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          }}
        >
          {payload.markdown || "(brak danych)"}
        </pre>
      </div>
    </div>
  );
}

function SummaryPill({ emoji, label, value }: { emoji: string; label: string; value: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 12,
        background: "var(--background)",
        fontSize: 13,
      }}
    >
      <span>{emoji}</span>
      <span style={{ color: "var(--muted)" }}>{label}:</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function DbStatus() {
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => {
        setStatus(r.ok ? "ok" : "error");
      })
      .catch(() => setStatus("error"));
  }, []);

  const colors = {
    checking: "var(--warning)",
    ok: "var(--success)",
    error: "var(--danger)",
  };

  const labels = {
    checking: "Sprawdzanie...",
    ok: "Połączono",
    error: "Błąd połączenia",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: colors[status],
          animation: status === "checking" ? "pulse 1s infinite" : "none",
        }}
      />
      <span style={{ fontSize: 14, color: colors[status], fontWeight: 600 }}>
        {labels[status]}
      </span>
    </div>
  );
}

const VOICE_DEVICE_STORAGE_KEY = "papicoach.audioInputDeviceId";

function SettingsTab() {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(VOICE_DEVICE_STORAGE_KEY) : null;
    setDeviceId(saved);
  }, []);

  const onDeviceChange = (id: string | null) => {
    setDeviceId(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(VOICE_DEVICE_STORAGE_KEY, id);
      else localStorage.removeItem(VOICE_DEVICE_STORAGE_KEY);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          🎙️ Mikrofon
        </h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.5 }}>
          Wybierz domyślny mikrofon dla całej aplikacji. Ustawienie zapisuje się lokalnie w przeglądarce
          i obowiązuje globalnie we wszystkich miejscach z transkrypcją mowy (dashboard, cele, dieta,
          debaty, mentorzy, nawyki, follow-up).
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <MicDevicePicker value={deviceId} onChange={onDeviceChange} />
          <span style={{ fontSize: 13, color: "var(--foreground)" }}>
            {deviceId ? "Konkretne urządzenie wybrane" : "Domyślne urządzenie systemowe"}
          </span>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
          ⚠️ = urządzenie wirtualne (Sonic Studio, VB-Cable, Stereo Mix itp.) — unikaj, nie nagrywa fizycznego mikrofonu.
        </div>
      </div>

      <JournalAgentSettings />
    </div>
  );
}

const DEFAULT_JOURNAL_PROMPT =
  'Jesteś redaktorem dziennika osobistego. Z surowego tekstu użytkownika (luźne myśli) napisz krótszą, ustrukturyzowaną wersję w formacie Markdown — zachowaj WSZYSTKIE fakty i emocje. Następnie zaklasyfikuj wpis. Zwróć TYLKO JSON: {"redacted": "...", "category": "Myśl|Refleksja|Wniosek|Doświadczenie", "topic": "zdrowie|dzieci|dziewczyna|biznes|inne"}';

function JournalAgentSettings() {
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [model, setModel] = useState<string>("claude-sonnet-4-6");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/journal/agent-config");
      if (res.ok) {
        const json = await res.json();
        setSystemPrompt(json.systemPrompt || "");
        setModel(json.model || "claude-sonnet-4-6");
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!systemPrompt.trim() || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/journal/agent-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt: systemPrompt.trim(), model }),
      });
      if (res.ok) {
        setStatus("Zapisano");
        setTimeout(() => setStatus(null), 2500);
      } else {
        const err = await res.json().catch(() => ({}));
        setStatus(err.error || "Błąd zapisu");
      }
    } catch {
      setStatus("Błąd zapisu");
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = () => {
    setSystemPrompt(DEFAULT_JOURNAL_PROMPT);
  };

  return (
    <div style={card}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        📔 Dziennik — agent AI
      </h3>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.5 }}>
        Konfigurowalny prompt agenta, który redaguje i kategoryzuje Twoje wpisy w dzienniku.
        Zmień prompt i model, aby testować różne style redakcji.
      </p>

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Ładuję konfigurację...</div>
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={inputStyle}
              disabled={saving}
            >
              {MENTOR_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>System prompt</label>
            <VoiceTextarea
              value={systemPrompt}
              onChange={setSystemPrompt}
              placeholder="Instrukcje dla agenta redagującego dziennik..."
              minHeight={200}
              disabled={saving}
            />
          </div>

          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              marginBottom: 12,
              padding: "8px 10px",
              background: "var(--background)",
              borderRadius: 8,
              border: "1px solid var(--border)",
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--foreground)" }}>
              Wymagane wartości w zwracanym JSON:
            </div>
            category = <code>Myśl | Refleksja | Wniosek | Doświadczenie</code>
            <br />
            topic = <code>zdrowie | dzieci | dziewczyna | biznes | inne</code>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={save}
              disabled={!systemPrompt.trim() || saving}
              style={{
                ...btnPrimary,
                opacity: !systemPrompt.trim() || saving ? 0.5 : 1,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Zapisuję..." : "Zapisz"}
            </button>
            <button
              onClick={resetDefault}
              disabled={saving}
              style={{
                padding: "10px 18px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--foreground)",
                fontSize: 14,
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              Przywróć domyślny
            </button>
            {status && (
              <span
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  alignSelf: "center",
                  fontWeight: 500,
                }}
              >
                {status}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

type Tab = "overview" | "users" | "mentors" | "data";

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
  active: boolean;
  sortOrder: number;
  lifeAreas: MentorLifeArea[];
}

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
    lifeAreaIds: [] as string[],
  });

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
    { key: "mentors", label: "Mentorzy" },
    { key: "data", label: "Dane" },
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
        Zarządzanie aplikacją PapiCoach
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
                  <textarea
                    style={textareaStyle}
                    value={mentorForm.persona}
                    onChange={(e) => setMentorForm({ ...mentorForm, persona: e.target.value })}
                    placeholder="Opis osobowości i stylu mentora..."
                  />
                </div>
                <div>
                  <label style={labelStyle}>System Prompt *</label>
                  <textarea
                    style={{ ...textareaStyle, minHeight: 150 }}
                    value={mentorForm.systemPrompt}
                    onChange={(e) =>
                      setMentorForm({ ...mentorForm, systemPrompt: e.target.value })
                    }
                    placeholder="Instrukcje systemowe dla AI..."
                  />
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
                  <div style={{ marginTop: 6 }}>
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

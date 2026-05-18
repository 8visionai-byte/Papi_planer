"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { MentorData } from "@/components/mentors/MentorCard";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function MentorsPage() {
  const [mentors, setMentors] = useState<MentorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsMentor, setDetailsMentor] = useState<MentorData | null>(null);

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

  return (
    <div style={{ padding: "24px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 20,
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
          Twoi Mentorzy
        </h1>
        {!loading && mentors.length > 0 && (
          <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}>
            {mentors.length}
          </span>
        )}
      </div>

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
            Mentorzy pojawią się po skonfigurowaniu konta
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
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
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

      {/* Details modal */}
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
                <Link
                  href="/admin/mentors"
                  onClick={() => setDetailsMentor(null)}
                  style={{
                    display: "block",
                    textAlign: "center",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--foreground)",
                    background: "transparent",
                    borderRadius: 12,
                    padding: "10px 16px",
                    textDecoration: "none",
                    border: "1px solid var(--border)",
                  }}
                >
                  ✏️ Edytuj
                </Link>
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

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MentorCard } from "@/components/mentors/MentorCard";
import { MentorChat } from "@/components/mentors/MentorChat";
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
  const [activeMentor, setActiveMentor] = useState<MentorData | null>(null);

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
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
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
                height: 140,
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 9999,
                    background: "var(--border)",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      width: "70%",
                      height: 14,
                      borderRadius: 4,
                      background: "var(--border)",
                      marginBottom: 6,
                    }}
                  />
                  <div
                    style={{
                      width: "50%",
                      height: 12,
                      borderRadius: 4,
                      background: "var(--border)",
                    }}
                  />
                </div>
              </div>
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

      {/* Mentor grid */}
      {!loading && !error && mentors.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          {mentors.map((mentor) => {
            const firstArea = mentor.lifeAreas[0];
            const disciplineSlug = firstArea ? slugify(firstArea) : null;
            return (
              <div key={mentor.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <MentorCard mentor={mentor} onClick={setActiveMentor} />
                {disciplineSlug && (
                  <Link
                    href={`/discipline/${disciplineSlug}`}
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

      {/* Chat modal */}
      {activeMentor && (
        <MentorChat
          mentor={activeMentor}
          onClose={() => setActiveMentor(null)}
        />
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

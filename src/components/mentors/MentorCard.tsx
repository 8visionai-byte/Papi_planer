"use client";

export interface MentorData {
  id: string;
  name: string;
  role: string;
  persona: string;
  avatarEmoji: string | null;
  style: string | null;
  sortOrder: number;
  lifeAreas: string[];
}

interface MentorCardProps {
  mentor: MentorData;
  onClick: (mentor: MentorData) => void;
}

export function MentorCard({ mentor, onClick }: MentorCardProps) {
  return (
    <button
      onClick={() => onClick(mentor)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 10,
        background: "var(--card)",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        border: "1px solid var(--border)",
        cursor: "pointer",
        width: "100%",
        textAlign: "left",
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
      {/* Avatar + Info */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
        {/* Avatar circle */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 9999,
            background: "var(--primary-light, rgba(59,130,246,0.1))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            flexShrink: 0,
          }}
        >
          {mentor.avatarEmoji || "🧑‍🏫"}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--foreground)",
              lineHeight: 1.3,
            }}
          >
            {mentor.name}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              lineHeight: 1.3,
              marginTop: 1,
            }}
          >
            {mentor.role}
          </div>
        </div>
      </div>

      {/* Persona excerpt */}
      <div
        style={{
          fontSize: 12,
          color: "var(--muted)",
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {mentor.persona}
      </div>

      {/* Life area tags */}
      {mentor.lifeAreas.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
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
    </button>
  );
}

"use client";

import { Card, T, TYPO } from "@/components/ui";

/**
 * One row of GET /api/mentors (active mentors only). This is the shared shape:
 * the mentors screen imports the type for its own richer tile (avatar + "Pogadaj"
 * + "Trening"), this component is the plain list variant.
 */
export interface MentorData {
  id: string;
  name: string;
  role: string;
  persona: string;
  avatarEmoji: string | null;
  style: string | null;
  /** Claude model answering as this mentor, e.g. "claude-sonnet-4-6". */
  model: string;
  sortOrder: number;
  lifeAreas: string[];
}

interface MentorCardProps {
  mentor: MentorData;
  onClick: (mentor: MentorData) => void;
}

/**
 * Mentor tile: big avatar with a soft accent halo, name as the loud line,
 * role muted, life-area chips at the bottom. The whole card is one 44px+
 * target (Card + Pressable), so no nested buttons are needed.
 */
export function MentorCard({ mentor, onClick }: MentorCardProps) {
  return (
    <Card
      onPress={() => onClick(mentor)}
      ariaLabel={`${mentor.name}, ${mentor.role}`}
      style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}
    >
      {/* Avatar + identity */}
      <div style={{ display: "flex", alignItems: "center", gap: T.sp3, width: "100%" }}>
        <div
          className="glow-soft"
          style={{
            width: 56,
            height: 56,
            borderRadius: T.rFull,
            background: T.primarySoft,
            border: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {mentor.avatarEmoji || "🧑‍🏫"}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TYPO.title3, color: T.text, overflowWrap: "anywhere" }}>
            {mentor.name}
          </div>
          <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{mentor.role}</div>
        </div>
      </div>

      {/* Persona excerpt — second text tier, 15px */}
      <div
        style={{
          ...TYPO.callout,
          color: T.text2,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {mentor.persona}
      </div>

      {/* Life area chips */}
      {mentor.lifeAreas.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {mentor.lifeAreas.map((area) => (
            <span
              key={area}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: T.primaryOnSurface,
                background: T.primarySoft,
                border: `1px solid ${T.borderAccent}`,
                borderRadius: T.rFull,
                padding: "4px 10px",
                lineHeight: 1.3,
              }}
            >
              {area}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

"use client";

import React from "react";
import { Card, T, TYPO } from "@/components/ui";

/**
 * One row of GET /api/mentors (active mentors only). This is the shared shape:
 * the mentors screen imports the type for its own tile, this component renders it.
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

/** Lowercase + trimmed, the only comparison used to decide "this is the same label". */
function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** True when two labels are the same text (case and edge spaces ignored). */
export function sameLabel(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeLabel(a);
  return left.length > 0 && left === normalizeLabel(b);
}

/**
 * The single line printed on a mentor tile.
 *
 * The owner asked for the profession and nothing else: "Wystarczy tylko psycholog zmiany
 * nawykow, naturopata ziololecznik, trener kalisteniki i tyle". That is the ROLE, so the
 * role wins and the name is the fallback for mentors created without one. On his own data
 * name and role hold the same text, which is why the old card printed it twice.
 */
export function mentorTitle(mentor: { name: string; role: string }): string {
  const role = (mentor.role ?? "").trim();
  return role || (mentor.name ?? "").trim();
}

/** Chip with a life-area name. Same look as the chips on the mentors screen. */
function AreaChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        ...TYPO.footnote,
        fontWeight: 700,
        color: T.primaryOnSurface,
        background: T.primarySoft,
        border: `1px solid ${T.borderAccent}`,
        borderRadius: T.rFull,
        padding: "4px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export interface MentorCardProps {
  mentor: MentorData;
  onClick: (mentor: MentorData) => void;
  /**
   * Buttons under the chips ("Pogadaj", "Trening"). The card swallows the pointer and
   * key events around them, so a tap on a button never also opens the details sheet.
   */
  actions?: React.ReactNode;
  /** Chips shown before the overflow badge. Default 3. */
  maxAreas?: number;
}

/**
 * Mentor tile: emoji, ONE title line, life-area chips, actions.
 *
 * Deliberately does not show the persona or the description any more. The full text
 * lives in the details sheet that opens on tap - on the tile it produced a wall of
 * clamped paragraphs ("nie powinny sie wyswietlac te pelne opisy").
 */
export function MentorCard({ mentor, onClick, actions, maxAreas = 3 }: MentorCardProps) {
  const title = mentorTitle(mentor);
  const shown = mentor.lifeAreas.slice(0, maxAreas);
  const overflow = mentor.lifeAreas.length - shown.length;

  // The visible line can be just the role, so the accessible name keeps the mentor's
  // own name too - unless both hold the same text, which would read it twice.
  const ariaLabel = sameLabel(mentor.name, mentor.role)
    ? title
    : [mentor.name, mentor.role].filter(Boolean).join(", ");

  return (
    <Card
      onPress={() => onClick(mentor)}
      ariaLabel={ariaLabel}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: T.sp2,
        textAlign: "center",
      }}
    >
      <div
        className="glow-soft"
        style={{
          width: 68,
          height: 68,
          borderRadius: T.rFull,
          background: T.primarySoft,
          border: `1px solid ${T.borderAccent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 36,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {mentor.avatarEmoji || "🧑‍🏫"}
      </div>

      <div
        style={{
          ...TYPO.title3,
          fontWeight: 700,
          color: T.text,
          width: "100%",
          overflowWrap: "anywhere",
        }}
      >
        {title}
      </div>

      {shown.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            justifyContent: "center",
            width: "100%",
          }}
        >
          {shown.map((area) => (
            <AreaChip key={area}>{area}</AreaChip>
          ))}
          {overflow > 0 && <AreaChip>+{overflow}</AreaChip>}
        </div>
      )}

      {actions && (
        <div
          // The card itself is one big target and buzzes on pointer down. The controls
          // inside have their own feedback, so the gesture stops here or every tap on
          // them fires two haptics.
          onPointerDown={(e) => e.stopPropagation()}
          // Same for the keyboard: the card is a div[role=button] with its own
          // Enter/Space handler, so without this Enter on "Pogadaj" ALSO opened the
          // details sheet and the chat landed behind it.
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: T.sp2,
            width: "100%",
            marginTop: "auto",
            paddingTop: T.sp2,
          }}
        >
          {actions}
        </div>
      )}
    </Card>
  );
}

export default MentorCard;

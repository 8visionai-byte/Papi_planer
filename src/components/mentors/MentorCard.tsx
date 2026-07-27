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

export interface MentorCardProps {
  mentor: MentorData;
  onClick: (mentor: MentorData) => void;
  /**
   * Buttons under the title ("Pogadaj", "Trening"). The card swallows the pointer and
   * key events around them, so a tap on a button never also opens the details sheet.
   */
  actions?: React.ReactNode;
}

/**
 * Mentor tile: emoji, ONE title line, actions. Nothing else.
 *
 * The life-area chips used to sit between the title and the buttons. They are gone from
 * the tile - the owner looks at this on a phone and it still read as a list ("tylko emoji
 * i kim jest trener. I tyle. Nic wiecej."). The areas stay one tap away in the details
 * sheet and in the edit form, so nothing was deleted, only moved off the tile.
 */
export function MentorCard({ mentor, onClick, actions }: MentorCardProps) {
  const title = mentorTitle(mentor);

  // The visible line can be just the role, so the accessible name keeps the mentor's
  // own name too - unless both hold the same text, which would read it twice.
  const ariaLabel = sameLabel(mentor.name, mentor.role)
    ? title
    : [mentor.name, mentor.role].filter(Boolean).join(", ");

  return (
    // height 100%: the tiles sit in a two column grid and stretch to the tallest one in
    // the row. The inner column below then pushes the buttons to the bottom edge, so a
    // one line title and a two line title do not leave a hole under the shorter card.
    <Card onPress={() => onClick(mentor)} ariaLabel={ariaLabel} style={{ height: "100%" }}>
      {/* Card forces `display: block` on a pressable card, so the column lives one level
          deeper. That is also what makes `marginTop: auto` on the buttons work. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: T.sp2,
          textAlign: "center",
          // minHeight, not height: the column fills the stretched card (that is what lets
          // the buttons sit on the bottom edge) but a three line title can still push it
          // taller instead of spilling out of the card.
          minHeight: "100%",
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

        {/* Two lines are reserved even for a short role ("Trener plywania" wraps, "Trener
            kalisteniki" does not), so neighbouring tiles line their buttons up instead of
            stepping by one line. Longer titles are free to take a third line. */}
        <div
          style={{
            ...TYPO.title3,
            fontWeight: 700,
            color: T.text,
            width: "100%",
            minHeight: "2.6em",
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </div>

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
      </div>
    </Card>
  );
}

export default MentorCard;

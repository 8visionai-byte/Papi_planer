export interface MentorModelOption {
  id: string;
  /** Full label for the picker in the mentor form. */
  label: string;
  /** Two-word name for the small badge in the list / details sheet. */
  short: string;
}

export const MENTOR_MODELS: MentorModelOption[] = [
  { id: "claude-opus-4-6", label: "Opus 4.6 (najinteligentniejszy)", short: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (zbalansowany)", short: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (szybki/tani)", short: "Haiku 4.5" },
];

/** Same default as `Mentor.model` in prisma/schema.prisma. Keep the two in sync. */
export const DEFAULT_MENTOR_MODEL = "claude-sonnet-4-6";

/**
 * Short label for the model badge.
 *
 * A mentor can carry a model id that is not on the list (set by hand in the database,
 * or a model we have since retired from the picker). Those must still render as
 * something readable instead of disappearing, hence the fallback that only strips the
 * vendor prefix and the date suffix.
 */
export function mentorModelShort(id?: string | null): string {
  const key = id || DEFAULT_MENTOR_MODEL;
  const known = MENTOR_MODELS.find((m) => m.id === key);
  if (known) return known.short;
  return key.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-/g, " ");
}

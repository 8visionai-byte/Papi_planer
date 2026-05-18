export interface MentorModelOption {
  id: string;
  label: string;
}

export const MENTOR_MODELS: MentorModelOption[] = [
  { id: "claude-opus-4-6", label: "Opus 4.6 (najinteligentniejszy)" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (zbalansowany)" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (szybki/tani)" },
];

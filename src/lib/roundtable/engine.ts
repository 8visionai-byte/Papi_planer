import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";
import { buildUserContext } from "@/lib/ai/user-context";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** One concrete change the debate proposes for the user's plan. */
export interface RoundTablePlanChange {
  /** "activity" = scheduled block with a time, "task" = to-do without a time. */
  kind: "activity" | "task";
  title: string;
  description?: string;
  /** Activity type used for the MET/calorie estimate (see calorie-calculator). */
  type?: string;
  /** YYYY-MM-DD. Missing = today. */
  date?: string;
  /** HH:MM. Missing = unscheduled to-do. */
  time?: string;
  durationMin?: number;
  lifeAreaId?: string | null;
}

export interface RoundTablePlanChanges {
  version: "rt-v1";
  changes: RoundTablePlanChange[];
}

export type RoundTableEvent =
  | {
      type: "mentor_start";
      mentorId: string;
      mentorName: string;
      mentorRole: string;
      avatarEmoji: string;
      model: string;
      round: number;
    }
  | {
      type: "mentor_response";
      mentorId: string;
      mentorName: string;
      mentorRole: string;
      avatarEmoji: string;
      model: string;
      round: number;
      content: string;
    }
  | { type: "consensus"; content: string; model: string }
  | { type: "plan_changes"; changes: RoundTablePlanChange[] }
  | { type: "done"; sessionId: string }
  | { type: "error"; error: string };

interface MentorInfo {
  id: string;
  name: string;
  role: string;
  persona: string;
  systemPrompt: string;
  avatarEmoji: string;
  model: string;
}

interface MentorTurn {
  mentor: MentorInfo;
  round: number;
  content: string;
}

/* ------------------------------------------------------------------ */
/*  Consensus -> concrete plan changes                                 */
/* ------------------------------------------------------------------ */

const VALID_CHANGE_KINDS = new Set(["activity", "task"]);
const MAX_CHANGES = 5;

function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function isISODate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Turn the consensus text into machine-readable proposals.
 * Until this existed, `RoundTableSession.planChanges` and `.applied` were never
 * written and the UI always said "Nie wdrożone" (roundtable/page.tsx:1085).
 * Failure here is non-fatal: the debate still gets saved, just without proposals.
 */
async function generatePlanChanges(
  userId: string,
  question: string,
  consensusText: string
): Promise<RoundTablePlanChange[]> {
  if (!consensusText.trim()) return [];

  const lifeAreas = await prisma.lifeArea.findMany({
    where: { userId },
    select: { id: true, name: true, category: true },
  });
  const areaIds = new Set(lifeAreas.map((a) => a.id));

  const areaList = lifeAreas.length
    ? lifeAreas.map((a) => `- ${a.id} = ${a.name} (${a.category})`).join("\n")
    : "(brak obszarów życia)";

  const system = [
    "Zamieniasz ustalenia debaty mentorów na konkretne pozycje do planu użytkownika.",
    "Zwróć WYŁĄCZNIE JSON, bez komentarza i bez bloku markdown:",
    '{ "changes": [',
    '  { "kind": "activity", "title": "krótka nazwa", "description": "1 zdanie po co",',
    '    "type": "training", "time": "07:00", "durationMin": 45, "lifeAreaId": "id lub null" }',
    "] }",
    "",
    "Zasady:",
    `- Maksymalnie ${MAX_CHANGES} pozycji. Lepiej 2 dobre niż 5 ogólników.`,
    '- "kind": "activity" gdy da się przypisać godzinę, "task" gdy to zadanie bez pory dnia.',
    '- "type": jeden z: training, running, cycling, swimming, karate, boxing, yoga, stretching,',
    "  meditation, walking, study, work, mindset, health, nutrition, rest, scheduled.",
    '- "time" tylko w formacie HH:MM, "durationMin" liczba minut (10-240).',
    `- "lifeAreaId" MUSI pochodzić z tej listy albo być null:\n${areaList}`,
    "- Tytuły po polsku, w trybie rozkazującym, konkretne (nie 'popracuj nad sobą').",
    "- Nie dopisuj nic, czego nie ma w konsensusie.",
  ].join("\n");

  const response = await anthropic.messages.create({
    model: MODELS.CHAT,
    max_tokens: 1200,
    temperature: 0.2,
    system,
    messages: [
      {
        role: "user",
        content: `## Pytanie użytkownika\n${question}\n\n## Konsensus mentorów\n${consensusText}`,
      },
    ],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") return [];

  let jsonStr = block.text.trim();
  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  const rawChanges =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { changes?: unknown }).changes)
      ? ((parsed as { changes: unknown[] }).changes as Record<string, unknown>[])
      : [];

  const out: RoundTablePlanChange[] = [];
  for (const raw of rawChanges) {
    if (!raw || typeof raw !== "object") continue;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 120) : "";
    if (!title) continue;

    const kind = VALID_CHANGE_KINDS.has(String(raw.kind))
      ? (raw.kind as "activity" | "task")
      : "task";
    const durationRaw = Number(raw.durationMin);
    const durationMin =
      Number.isFinite(durationRaw) && durationRaw >= 10 && durationRaw <= 240
        ? Math.round(durationRaw)
        : undefined;

    out.push({
      kind,
      title,
      description:
        typeof raw.description === "string" && raw.description.trim()
          ? raw.description.trim().slice(0, 400)
          : undefined,
      type: typeof raw.type === "string" && raw.type.trim() ? raw.type.trim() : undefined,
      date: isISODate(raw.date) ? raw.date : undefined,
      time: isHHMM(raw.time) ? raw.time : undefined,
      durationMin,
      lifeAreaId:
        typeof raw.lifeAreaId === "string" && areaIds.has(raw.lifeAreaId) ? raw.lifeAreaId : null,
    });
    if (out.length >= MAX_CHANGES) break;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  Format transcript so far (for context passed to each mentor)       */
/* ------------------------------------------------------------------ */

function formatTranscript(turns: MentorTurn[]): string {
  if (turns.length === 0) return "(jeszcze nikt się nie wypowiedział)";
  return turns
    .map(
      (t) =>
        `### Runda ${t.round} — ${t.mentor.name} (${t.mentor.role}) ${t.mentor.avatarEmoji}\n${t.content}`
    )
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/*  Single mentor Claude call                                          */
/* ------------------------------------------------------------------ */

async function callMentor(
  mentor: MentorInfo,
  userMessage: string,
  taskInstruction: string,
  temperature: number,
  maxTokens: number
): Promise<string> {
  // Use mentor's own systemPrompt verbatim (from DB / settings).
  // Append the round task instruction so persona stays primary.
  const system = [
    mentor.systemPrompt,
    "",
    "---",
    "",
    "## Zadanie w tej rundzie debaty Okrągłego Stołu:",
    taskInstruction,
    "",
    "Zawsze odpowiadaj po polsku. Pisz pełnymi zdaniami — nie urywaj.",
    "Mów od siebie, w pierwszej osobie, zgodnie ze swoim charakterem i stylem.",
  ].join("\n");

  const response = await anthropic.messages.create({
    model: mentor.model || MODELS.CHAT,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

/* ------------------------------------------------------------------ */
/*  Round Table engine (async generator)                               */
/* ------------------------------------------------------------------ */

export async function* runRoundTable(
  input: string,
  userId: string,
  mentorIds?: string[]
): AsyncGenerator<RoundTableEvent> {
  // 1. Fetch active mentors (Prisma returns unique rows by PK)
  const mentorsRaw = await prisma.mentor.findMany({
    where: {
      userId,
      active: true,
      ...(mentorIds && mentorIds.length > 0 ? { id: { in: mentorIds } } : {}),
    },
    orderBy: { sortOrder: "asc" },
  });

  if (mentorsRaw.length === 0) {
    yield {
      type: "error",
      error: "Brak aktywnych mentorów. Skonfiguruj mentorów w ustawieniach.",
    };
    return;
  }

  // Defensive dedupe by id — guarantees each mentor speaks at most once per round
  const seenIds = new Set<string>();
  const mentors: MentorInfo[] = [];
  for (const m of mentorsRaw) {
    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);
    mentors.push({
      id: m.id,
      name: m.name,
      role: m.role,
      persona: m.persona,
      systemPrompt: m.systemPrompt,
      avatarEmoji: m.avatarEmoji ?? "🧑‍🏫",
      model: m.model || MODELS.CHAT,
    });
  }

  // 2. Build user context ONCE and paste it into the base question block.
  //    Context source: src/lib/ai/user-context.ts (scope "debate").
  //    The debate costs 2N+2 model calls, so "debate" is the leanest scope
  //    (3000 chars); building it per call would multiply the bill by 2N+2.
  //    Replaces the former local `buildUserContext` here — same name as the
  //    shared one but a different signature (audit K1.3).
  const ctx = await buildUserContext(userId, { scope: "debate" });

  const baseQuestionBlock = [
    "## Pytanie / problem użytkownika:",
    input,
    "",
    "## Kontekst użytkownika:",
    ctx.text,
  ].join("\n");

  const allTurns: MentorTurn[] = [];
  const allEvents: RoundTableEvent[] = [];

  /* -------- ROUND 1 — Initial unique perspective from every mentor --- */

  const round1Instruction = [
    "To jest RUNDA 1 debaty. Inni mentorzy też się wypowiedzą — Ty masz przedstawić SWOJĄ unikalną perspektywę.",
    "Odpowiedz na pytanie użytkownika ze swojego punktu widzenia, zgodnie ze swoją rolą i stylem.",
    "Długość: 4-8 zdań. Konkretnie, praktycznie, bez owijania w bawełnę.",
    "Nie powtarzaj treści pytania — od razu przejdź do odpowiedzi.",
  ].join("\n");

  // Emit mentor_start events for round 1 (so UI can show typing dots)
  for (const m of mentors) {
    const startEv: RoundTableEvent = {
      type: "mentor_start",
      mentorId: m.id,
      mentorName: m.name,
      mentorRole: m.role,
      avatarEmoji: m.avatarEmoji,
      model: m.model,
      round: 1,
    };
    yield startEv;
  }

  // Run round 1 in parallel (each mentor sees only the question)
  const round1Results = await Promise.all(
    mentors.map(async (m) => {
      try {
        const content = await callMentor(
          m,
          baseQuestionBlock,
          round1Instruction,
          0.8,
          1500
        );
        return { mentor: m, content };
      } catch (err) {
        return {
          mentor: m,
          content: `[Błąd: ${err instanceof Error ? err.message : "nieznany"}]`,
        };
      }
    })
  );

  // Emit each round-1 response in mentor sortOrder (consistent ordering)
  for (const r of round1Results) {
    allTurns.push({ mentor: r.mentor, round: 1, content: r.content });
    const ev: RoundTableEvent = {
      type: "mentor_response",
      mentorId: r.mentor.id,
      mentorName: r.mentor.name,
      mentorRole: r.mentor.role,
      avatarEmoji: r.mentor.avatarEmoji,
      model: r.mentor.model,
      round: 1,
      content: r.content,
    };
    allEvents.push(ev);
    yield ev;
  }

  /* -------- ROUND 2 — Each mentor reacts to round 1 (sequential) ----- */

  // Sequential so each mentor sees prior round-2 reactions too
  for (const m of mentors) {
    const startEv: RoundTableEvent = {
      type: "mentor_start",
      mentorId: m.id,
      mentorName: m.name,
      mentorRole: m.role,
      avatarEmoji: m.avatarEmoji,
      model: m.model,
      round: 2,
    };
    yield startEv;

    const transcriptSoFar = formatTranscript(allTurns);

    const userMessageRound2 = [
      baseQuestionBlock,
      "",
      "## Dotychczasowy przebieg debaty:",
      transcriptSoFar,
    ].join("\n");

    const round2Instruction = [
      "To jest RUNDA 2 debaty. Słyszałeś już wypowiedzi pozostałych mentorów (powyżej).",
      "Zareaguj na ich stanowiska:",
      "- z czym się zgadzasz i dlaczego",
      "- z czym się NIE zgadzasz i dlaczego",
      "- co chcesz dodać lub zniuansować",
      "Odnoś się konkretnie do innych mentorów po imieniu.",
      "Dąż do wypracowania wspólnego stanowiska — gdzie widzisz pole do kompromisu, a gdzie różnica jest fundamentalna.",
      "Długość: 4-7 zdań. Bez powtarzania tego co już powiedziałeś w rundzie 1.",
    ].join("\n");

    let content: string;
    try {
      content = await callMentor(
        m,
        userMessageRound2,
        round2Instruction,
        0.7,
        1500
      );
    } catch (err) {
      content = `[Błąd: ${err instanceof Error ? err.message : "nieznany"}]`;
    }

    allTurns.push({ mentor: m, round: 2, content });
    const ev: RoundTableEvent = {
      type: "mentor_response",
      mentorId: m.id,
      mentorName: m.name,
      mentorRole: m.role,
      avatarEmoji: m.avatarEmoji,
      model: m.model,
      round: 2,
      content,
    };
    allEvents.push(ev);
    yield ev;
  }

  /* -------- CONSENSUS (Opus moderator) ------------------------------- */

  const fullTranscriptForConsensus = [
    "## Pytanie użytkownika:",
    input,
    "",
    "## Pełny przebieg debaty:",
    formatTranscript(allTurns),
  ].join("\n");

  const consensusSystem = [
    "Jesteś bezstronnym moderatorem debaty Okrągłego Stołu — grupy mentorów życiowych użytkownika.",
    "Twoim zadaniem jest zsyntetyzować ich wypowiedzi w zwięzły konsensus dla użytkownika.",
    "",
    "## Struktura odpowiedzi (po polsku, używaj markdownu):",
    "",
    "**Zgodność:** w czym mentorzy się zgadzają (1-3 punkty)",
    "",
    "**Różnice:** gdzie się różnią i dlaczego — wymień konkretnie kto co mówi (1-3 punkty)",
    "",
    "**Rekomendacja dla Ciebie:** 2-4 konkretne kroki do wykonania, łączące najlepsze elementy każdego stanowiska",
    "",
    "**Słowo na koniec:** jedno motywujące zdanie",
    "",
    "Bądź konkretny, bez ogólników. Maks. 250 słów łącznie.",
  ].join("\n");

  let consensusText = "";
  try {
    const consensusResponse = await anthropic.messages.create({
      model: MODELS.ROUNDTABLE, // Opus for the synthesis step
      max_tokens: 2000,
      temperature: 0.3,
      system: consensusSystem,
      messages: [{ role: "user", content: fullTranscriptForConsensus }],
    });

    const consensusBlock = consensusResponse.content[0];
    consensusText = consensusBlock.type === "text" ? consensusBlock.text : "";

    const consensusEv: RoundTableEvent = {
      type: "consensus",
      content: consensusText,
      model: MODELS.ROUNDTABLE,
    };
    allEvents.push(consensusEv);
    yield consensusEv;
  } catch (err) {
    yield {
      type: "error",
      error: `Błąd generowania konsensusu: ${err instanceof Error ? err.message : "nieznany"}`,
    };
    return;
  }

  /* -------- PLAN CHANGES (proposals the user can apply) -------------- */

  let planChanges: RoundTablePlanChange[] = [];
  try {
    planChanges = await generatePlanChanges(userId, input, consensusText);
  } catch (err) {
    // Never let this kill a finished debate — the consensus is the main artifact.
    console.error("[roundtable] plan changes generation failed", err);
  }

  if (planChanges.length > 0) {
    const changesEv: RoundTableEvent = { type: "plan_changes", changes: planChanges };
    allEvents.push(changesEv);
    yield changesEv;
  }

  /* -------- SAVE TO DB ---------------------------------------------- */

  try {
    const payload: RoundTablePlanChanges = { version: "rt-v1", changes: planChanges };
    const session = await prisma.roundTableSession.create({
      data: {
        userId,
        inputText: input,
        inputType: "text",
        consensus: consensusText || null,
        debateTranscript: JSON.parse(JSON.stringify(allEvents)),
        planChanges: planChanges.length > 0 ? JSON.parse(JSON.stringify(payload)) : undefined,
      },
    });

    yield { type: "done", sessionId: session.id };
  } catch (err) {
    yield {
      type: "error",
      error: `Błąd zapisu sesji: ${err instanceof Error ? err.message : "nieznany"}`,
    };
  }
}

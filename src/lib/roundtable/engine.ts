import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";
import { subDays, format } from "date-fns";
import { pl } from "date-fns/locale";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
/*  User context builder                                               */
/* ------------------------------------------------------------------ */

async function buildUserContext(userId: string): Promise<string> {
  const sevenDaysAgo = subDays(new Date(), 7);

  const [userProfile, recentLogs] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.dailyLog.findMany({
      where: { userId, date: { gte: sevenDaysAgo } },
      orderBy: { date: "desc" },
      take: 7,
      include: { activities: true },
    }),
  ]);

  const parts: string[] = [];

  if (userProfile?.data) {
    const data = userProfile.data as Record<string, unknown>;
    parts.push(`## Profil użytkownika\n${JSON.stringify(data, null, 2)}`);
  }

  if (recentLogs.length > 0) {
    const summary = recentLogs
      .map((log) => {
        const d = format(log.date, "EEEE, d MMMM", { locale: pl });
        const items = [`### ${d}`];
        if (log.energy != null) items.push(`Energia: ${log.energy}/10`);
        if (log.mood) items.push(`Nastrój: ${log.mood}`);
        if (log.sleepHours != null) items.push(`Sen: ${log.sleepHours}h`);
        return items.join("\n");
      })
      .join("\n\n");
    parts.push(`## Ostatnie dni\n${summary}`);
  }

  return parts.join("\n\n");
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
  userId: string
): AsyncGenerator<RoundTableEvent> {
  // 1. Fetch active mentors (Prisma returns unique rows by PK)
  const mentorsRaw = await prisma.mentor.findMany({
    where: { userId, active: true },
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

  // 2. Build user context once
  const userContext = await buildUserContext(userId);

  const baseQuestionBlock = [
    "## Pytanie / problem użytkownika:",
    input,
    "",
    "## Kontekst użytkownika:",
    userContext || "(brak dodatkowego kontekstu)",
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

  /* -------- SAVE TO DB ---------------------------------------------- */

  try {
    const session = await prisma.roundTableSession.create({
      data: {
        userId,
        inputText: input,
        inputType: "text",
        consensus: consensusText || null,
        debateTranscript: JSON.parse(JSON.stringify(allEvents)),
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

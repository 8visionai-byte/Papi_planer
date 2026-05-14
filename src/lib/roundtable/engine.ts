import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";
import { subDays, format } from "date-fns";
import { pl } from "date-fns/locale";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type RoundTableEvent =
  | { type: "mentor_start"; mentorId: string; mentorName: string; avatarEmoji: string }
  | { type: "mentor_response"; mentorId: string; mentorName: string; avatarEmoji: string; content: string }
  | { type: "cross_comment"; mentorId: string; mentorName: string; avatarEmoji: string; content: string; replyingTo: string }
  | { type: "consensus"; content: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; error: string };

interface MentorInfo {
  id: string;
  name: string;
  role: string;
  persona: string;
  systemPrompt: string;
  avatarEmoji: string;
}

/* ------------------------------------------------------------------ */
/*  User context builder (lightweight, no mentor-specific filtering)   */
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
        if (log.mood) items.push(`Nastroj: ${log.mood}`);
        if (log.sleepHours != null) items.push(`Sen: ${log.sleepHours}h`);
        return items.join("\n");
      })
      .join("\n\n");
    parts.push(`## Ostatnie dni\n${summary}`);
  }

  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/*  Single mentor Claude call                                          */
/* ------------------------------------------------------------------ */

async function callMentor(
  mentor: MentorInfo,
  userMessage: string,
  systemSuffix: string,
  temperature: number,
  maxTokens: number
): Promise<string> {
  const system = [
    mentor.systemPrompt,
    "",
    "---",
    "",
    systemSuffix,
  ].join("\n");

  const response = await anthropic.messages.create({
    model: MODELS.CHAT,
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
  // 1. Fetch active mentors
  const mentors = await prisma.mentor.findMany({
    where: { userId, active: true },
    orderBy: { sortOrder: "asc" },
  });

  if (mentors.length === 0) {
    yield { type: "error", error: "Brak aktywnych mentorów. Skonfiguruj mentorów w ustawieniach." };
    return;
  }

  const mentorInfos: MentorInfo[] = mentors.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    persona: m.persona,
    systemPrompt: m.systemPrompt,
    avatarEmoji: m.avatarEmoji ?? "🧑‍🏫",
  }));

  // 2. Build user context
  const userContext = await buildUserContext(userId);

  const userMessage = [
    "## Pytanie / problem użytkownika:",
    input,
    "",
    "## Kontekst użytkownika:",
    userContext,
  ].join("\n");

  const allEvents: RoundTableEvent[] = [];

  // 3. Round 1 — Initial responses (parallel)
  for (const m of mentorInfos) {
    yield { type: "mentor_start", mentorId: m.id, mentorName: m.name, avatarEmoji: m.avatarEmoji };
  }

  const round1SystemSuffix = [
    "Odpowiadasz jako mentor w debacie Okrągłego Stołu.",
    "Odpowiedz na pytanie użytkownika ze swojej unikalnej perspektywy.",
    "Pisz po polsku, 2-4 zdania. Bądź konkretny i praktyczny.",
    "Mów od siebie, w pierwszej osobie.",
  ].join("\n");

  const round1Promises = mentorInfos.map((m) =>
    callMentor(m, userMessage, round1SystemSuffix, 0.8, 500)
      .then((content) => ({ mentor: m, content }))
      .catch((err) => ({
        mentor: m,
        content: `[Błąd: ${err instanceof Error ? err.message : "nieznany"}]`,
      }))
  );

  const round1Results = await Promise.all(round1Promises);

  for (const r of round1Results) {
    const event: RoundTableEvent = {
      type: "mentor_response",
      mentorId: r.mentor.id,
      mentorName: r.mentor.name,
      avatarEmoji: r.mentor.avatarEmoji,
      content: r.content,
    };
    allEvents.push(event);
    yield event;
  }

  // 4. Round 2 — Cross-commentary (2-3 random mentors)
  const crossCommentCount = Math.min(3, mentorInfos.length);
  const shuffled = [...mentorInfos].sort(() => Math.random() - 0.5);
  const crossCommenters = shuffled.slice(0, crossCommentCount);

  const round1Summary = round1Results
    .map((r) => `**${r.mentor.name}** (${r.mentor.role}): ${r.content}`)
    .join("\n\n");

  const crossPromises = crossCommenters.map((m) => {
    const others = round1Results.filter((r) => r.mentor.id !== m.id);
    const replyingToMentor = others[Math.floor(Math.random() * others.length)];
    const replyingTo = replyingToMentor?.mentor.name ?? mentorInfos[0].name;

    const crossSystemSuffix = [
      "Jesteś w debacie Okrągłego Stołu. Inni mentorzy już odpowiedzieli.",
      "Twoim zadaniem jest skomentować odpowiedzi innych — możesz się zgodzić, nie zgodzić, lub dodać niuans.",
      "Pisz po polsku, 2-3 zdania. Odnieś się konkretnie do wypowiedzi innego mentora.",
      "",
      "## Odpowiedzi innych mentorów:",
      round1Summary,
    ].join("\n");

    return callMentor(m, userMessage, crossSystemSuffix, 0.5, 300)
      .then((content) => ({ mentor: m, content, replyingTo }))
      .catch((err) => ({
        mentor: m,
        content: `[Błąd: ${err instanceof Error ? err.message : "nieznany"}]`,
        replyingTo,
      }));
  });

  const crossResults = await Promise.all(crossPromises);

  for (const r of crossResults) {
    const event: RoundTableEvent = {
      type: "cross_comment",
      mentorId: r.mentor.id,
      mentorName: r.mentor.name,
      avatarEmoji: r.mentor.avatarEmoji,
      content: r.content,
      replyingTo: r.replyingTo,
    };
    allEvents.push(event);
    yield event;
  }

  // 5. Consensus
  const fullTranscript = [
    "## Pytanie użytkownika:",
    input,
    "",
    "## Odpowiedzi mentorów (Runda 1):",
    round1Summary,
    "",
    "## Komentarze krzyżowe (Runda 2):",
    crossResults
      .map((r) => `**${r.mentor.name}** (odpowiada na ${r.replyingTo}): ${r.content}`)
      .join("\n\n"),
  ].join("\n");

  const consensusSystem = [
    "Jesteś moderatorem debaty Okrągłego Stołu — grupy mentorów życiowych.",
    "Na podstawie wszystkich wypowiedzi mentorów, stwórz podsumowanie konsensusu.",
    "",
    "## Zasady podsumowania:",
    "- Pisz po polsku",
    "- Wskaż główne punkty zgodności i różnic",
    "- Zaproponuj 2-3 konkretne kroki działania dla użytkownika",
    "- Bądź zwięzły ale treściwy (max 200 słów)",
    "- Zakończ motywującym zdaniem",
  ].join("\n");

  try {
    const consensusResponse = await anthropic.messages.create({
      model: MODELS.CHAT,
      max_tokens: 800,
      temperature: 0.3,
      system: consensusSystem,
      messages: [{ role: "user", content: fullTranscript }],
    });

    const consensusBlock = consensusResponse.content[0];
    const consensusText = consensusBlock.type === "text" ? consensusBlock.text : "";

    const consensusEvent: RoundTableEvent = { type: "consensus", content: consensusText };
    allEvents.push(consensusEvent);
    yield consensusEvent;
  } catch (err) {
    yield {
      type: "error",
      error: `Błąd generowania konsensusu: ${err instanceof Error ? err.message : "nieznany"}`,
    };
    return;
  }

  // 6. Save to DB
  try {
    const consensusText = allEvents.find((e) => e.type === "consensus");
    const session = await prisma.roundTableSession.create({
      data: {
        userId,
        inputText: input,
        inputType: "text",
        consensus: consensusText && "content" in consensusText ? consensusText.content : null,
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

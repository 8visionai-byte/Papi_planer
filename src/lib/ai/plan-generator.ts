import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";
import { getCalendarEvents, polishDayBounds } from "@/lib/google/calendar";
import { startOfDay } from "date-fns";

const PL_TIME_FMT = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Warsaw",
});

export interface GeneratedActivity {
  name: string;
  type: string;
  scheduledAt: string; // HH:MM
  durationMin: number;
  notes: string | null;
  lifeAreaId: string | null;
}

export interface PlanGeneratorOptions {
  userContext?: string;
  mode: "full" | "replan";
  preserveCompleted?: boolean;
}

const VALID_ACTIVITY_TYPES = new Set([
  "training",
  "exercise",
  "study",
  "work",
  "health",
  "mindset",
  "nutrition",
  "rest",
  "scheduled",
]);

function normalizeType(input: unknown): string {
  if (typeof input !== "string") return "scheduled";
  const lower = input.trim().toLowerCase();
  if (VALID_ACTIVITY_TYPES.has(lower)) return lower;
  return "scheduled";
}

function normalizeTime(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  // Accept HH:MM or H:MM
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function findLifeAreaIdByHint(
  hint: unknown,
  lifeAreas: Array<{ id: string; name: string }>
): string | null {
  if (typeof hint !== "string") return null;
  const lower = hint.trim().toLowerCase();
  if (!lower) return null;
  // Direct match
  const direct = lifeAreas.find((la) => la.name.toLowerCase() === lower);
  if (direct) return direct.id;
  // Substring match either direction
  const partial = lifeAreas.find((la) => {
    const n = la.name.toLowerCase();
    return n.includes(lower) || lower.includes(n);
  });
  return partial?.id ?? null;
}

export async function generateDayPlan(
  userId: string,
  options: PlanGeneratorOptions
): Promise<GeneratedActivity[]> {
  const today = startOfDay(new Date());
  const dayOfWeek = new Date().getDay();

  const [profile, goals, mentors, schedule, lifeAreas, dailyLog] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { data: true },
    }),
    prisma.goal.findMany({
      where: { userId, status: "active" },
      select: {
        id: true,
        title: true,
        description: true,
        targetDate: true,
        lifeAreaId: true,
      },
    }),
    prisma.mentor.findMany({
      where: { userId, active: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        systemPrompt: true,
        lifeAreas: { select: { id: true, name: true } },
      },
    }),
    prisma.schedule.findMany({
      where: { userId, dayOfWeek },
      orderBy: { time: "asc" },
      select: {
        time: true,
        activityName: true,
        notes: true,
        lifeAreaId: true,
      },
    }),
    prisma.lifeArea.findMany({
      where: { userId, active: true },
      select: { id: true, name: true },
    }),
    prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: today } },
      include: {
        activities: {
          orderBy: { scheduledAt: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            scheduledAt: true,
            durationMin: true,
            completed: true,
            notes: true,
            lifeAreaId: true,
          },
        },
      },
    }),
  ]);

  if (mentors.length === 0) {
    throw new Error("Brak aktywnych mentorów — dodaj mentora w ustawieniach.");
  }

  // Fetch today's Google Calendar meetings (when user opted in) so mentors
  // plan AROUND fixed commitments. Calendar is optional — never break plan gen.
  const showCalendar =
    !!profile?.data &&
    typeof profile.data === "object" &&
    (profile.data as Record<string, unknown>).showCalendarInPlan === true;
  let meetings: { time: string; endTime: string; name: string }[] = [];
  if (showCalendar) {
    try {
      const { from, to } = polishDayBounds(new Date());
      const events = await getCalendarEvents(userId, { from, to });
      meetings = events
        .filter((e) => !e.allDay)
        .map((e) => ({
          time: PL_TIME_FMT.format(new Date(e.start)),
          endTime: PL_TIME_FMT.format(new Date(e.end)),
          name: e.title,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
    } catch {
      // Token expired / not connected — proceed without meetings.
    }
  }

  // Build system prompt: concat all active mentors with separators
  const systemPrompt =
    `Jesteś zespołem mentorów PapiCoach pracujących wspólnie nad planem dnia użytkownika. ` +
    `Każdy mentor wnosi swoją perspektywę i odpowiada za przypisany obszar życia.\n\n` +
    `## Mentorzy w zespole\n\n` +
    mentors
      .map((m) => {
        const areas = m.lifeAreas.map((la) => la.name).join(", ") || "brak";
        return (
          `### ${m.name} — ${m.role}\n` +
          `Obszary życia: ${areas}\n\n` +
          `${m.systemPrompt}`
        );
      })
      .join("\n\n---\n\n") +
    `\n\n## Twoje zadanie\n\n` +
    `Wygeneruj dzisiejszy plan aktywności jako spójny zespół. ` +
    `Uwzględnij stały harmonogram, aktywne cele i kontekst od użytkownika. ` +
    `Zwróć WYŁĄCZNIE poprawny JSON (tablica), bez markdown, bez komentarzy.`;

  // Build user message
  const profileJson = profile?.data ? JSON.stringify(profile.data) : "{}";

  const goalsBlock =
    goals.length > 0
      ? goals
          .map((g) => {
            const dateStr = g.targetDate
              ? g.targetDate.toISOString().slice(0, 10)
              : "brak terminu";
            const desc = g.description?.trim() || "";
            return `- ${g.title} (termin: ${dateStr})${desc ? ` — ${desc}` : ""}`;
          })
          .join("\n")
      : "(brak aktywnych celów)";

  const scheduleBlock =
    schedule.length > 0
      ? schedule
          .map(
            (s) =>
              `- ${s.time} ${s.activityName}${s.notes ? ` (${s.notes})` : ""}`
          )
          .join("\n")
      : "(brak stałego harmonogramu na ten dzień)";

  const meetingsBlock =
    meetings.length > 0
      ? meetings
          .map((m) => `- ${m.time}–${m.endTime} ${m.name} [SPOTKANIE — zablokowane, NIE planuj tu nic]`)
          .join("\n")
      : "(brak spotkań w kalendarzu na dziś)";

  const mentorsList = mentors
    .map((m) => `${m.name} (${m.role})`)
    .join(", ");

  const lifeAreaNames = lifeAreas.map((la) => la.name).join(", ") || "brak";

  // Current time block — always inform mentor what time it is
  const now = new Date();
  const nowHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const currentTimeBlock = `\n\nAktualna godzina: ${nowHHMM}.`;

  // For replan: collect ALL past activities (before now), regardless of completion.
  // Activities BEFORE current time happened (or didn't) — mentor must not retry them.
  // Only generate activities from current time forward.
  let pastBlock = "";
  if (options.mode === "replan" && options.preserveCompleted && dailyLog) {
    const past = dailyLog.activities.filter((a) => {
      if (!a.scheduledAt) return false;
      return a.scheduledAt < nowHHMM;
    });
    if (past.length > 0) {
      pastBlock =
        `\n\nAktywności sprzed bieżącej godziny (NIE planuj ich na nowo, NIE powtarzaj — czas minął):\n` +
        past
          .map((a) => {
            const status = a.completed ? "[ZROBIONE]" : "[POMINIĘTE]";
            return `- ${a.scheduledAt ?? "?"} ${a.name} (${a.type}, ${a.durationMin ?? 0} min) ${status}`;
          })
          .join("\n");
    }
    pastBlock += `\n\nWygeneruj aktywności TYLKO od godziny ${nowHHMM} w górę. Nie cofaj się w czasie.`;
  }

  const contextBlock = options.userContext?.trim()
    ? `\n\nDodatkowy kontekst od użytkownika:\n${options.userContext.trim()}`
    : "";

  const userMsg =
    `Wygeneruj plan dnia dla podopiecznego.\n\n` +
    `## Profil użytkownika\n${profileJson}\n\n` +
    `## Aktywne cele\n${goalsBlock}\n\n` +
    `## Stały harmonogram na dziś\n${scheduleBlock}\n\n` +
    `## Spotkania z kalendarza (STAŁE — zaplanuj aktywności PRZED i PO, nigdy w tych godzinach)\n${meetingsBlock}\n\n` +
    `## Dostępne obszary życia\n${lifeAreaNames}\n\n` +
    `## Mentorzy w systemie\n${mentorsList}` +
    contextBlock +
    currentTimeBlock +
    pastBlock +
    `\n\n## Format odpowiedzi\n\n` +
    `Zwróć WYŁĄCZNIE tablicę JSON z aktywnościami na dziś (5-12 pozycji):\n\n` +
    `[{"name":"Nazwa aktywności","type":"training|exercise|study|work|health|mindset|nutrition|rest|scheduled","scheduledAt":"HH:MM","durationMin":30,"notes":"Krótka notatka lub null","lifeAreaHint":"Nazwa obszaru życia z listy powyżej lub null"}]\n\n` +
    `Reguły:\n` +
    `- NIE planuj żadnej aktywności w godzinach spotkań z kalendarza (są zablokowane). Planuj wokół nich — przed i po.\n` +
    `- type MUSI być jedną z: training, exercise, study, work, health, mindset, nutrition, rest, scheduled\n` +
    `- scheduledAt w formacie 24h "HH:MM"\n` +
    `- durationMin liczba całkowita (5-240)\n` +
    `- Sortuj chronologicznie\n` +
    `- Uwzględnij stały harmonogram (NIE pomijaj jego pozycji)\n` +
    `- Aktywności muszą pasować do profilu i celów\n` +
    `- lifeAreaHint musi pasować do nazwy z listy obszarów lub być null\n` +
    `- Bez komentarzy, bez markdown, bez tekstu poza JSON-em`;

  const response = await anthropic.messages.create({
    model: MODELS.CHAT,
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI nie zwrócił poprawnej odpowiedzi.");
  }

  const raw = textBlock.text;
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("AI nie zwrócił poprawnego JSON.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("Nie można sparsować odpowiedzi AI.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Odpowiedź AI nie jest tablicą.");
  }

  const activities: GeneratedActivity[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) continue;
    const type = normalizeType(obj.type);
    const scheduledAt = normalizeTime(obj.scheduledAt);
    if (!scheduledAt) continue;
    const durationRaw = Number(obj.durationMin);
    const durationMin =
      Number.isFinite(durationRaw) && durationRaw > 0
        ? Math.min(240, Math.max(5, Math.round(durationRaw)))
        : 30;
    const notes =
      typeof obj.notes === "string" && obj.notes.trim()
        ? obj.notes.trim()
        : null;
    const lifeAreaId = findLifeAreaIdByHint(obj.lifeAreaHint, lifeAreas);

    activities.push({
      name,
      type,
      scheduledAt,
      durationMin,
      notes,
      lifeAreaId,
    });
  }

  // Sort by scheduledAt
  activities.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  return activities;
}

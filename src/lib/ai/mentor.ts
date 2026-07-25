import { prisma } from "@/lib/db/prisma";
import { buildUserContext } from "@/lib/ai/user-context";

export interface MentorContext {
  systemPrompt: string;
  userContext: string;
  mentorName: string;
  mentorRole: string;
}

/**
 * Mentor persona + user context for a single mentor.
 *
 * The user-context half used to be assembled here (raw `JSON.stringify(profile)`
 * plus 7 raw daily logs, ~5x more tokens and missing weight, habits, training,
 * records and goals). It now DELEGATES to the shared module so that this route
 * and the 1:1 chat see exactly the same picture.
 *
 * Context source: src/lib/ai/user-context.ts (scope "chat").
 * Kept as a named export because /api/chat/route.ts and src/lib/ai/index.ts use it.
 */
export async function buildMentorContext(
  mentorId: string,
  userId: string
): Promise<MentorContext> {
  const mentor = await prisma.mentor.findUnique({
    where: { id: mentorId },
    include: { lifeAreas: { select: { id: true, name: true, description: true } } },
  });

  if (!mentor) {
    throw new Error(`Mentor ${mentorId} not found`);
  }

  if (mentor.userId !== userId) {
    throw new Error("Unauthorized access to mentor");
  }

  // A mentor owning exactly one life area gets a discipline-scoped context
  // (its goals, trainings and records), which is what "trener karate" needs.
  const lifeAreaId =
    mentor.lifeAreas.length === 1 ? mentor.lifeAreas[0].id : null;

  const ctx = await buildUserContext(userId, { scope: "chat", lifeAreaId });

  const parts = [ctx.text];
  if (mentor.lifeAreas.length > 0) {
    const areas = mentor.lifeAreas
      .map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ""}`)
      .join("\n");
    parts.push(`## Obszary zycia tego mentora\n${areas}`);
  }

  return {
    systemPrompt: mentor.systemPrompt,
    userContext: parts.join("\n\n"),
    mentorName: mentor.name,
    mentorRole: mentor.role,
  };
}

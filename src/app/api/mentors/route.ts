import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const mentors = await prisma.mentor.findMany({
      where: {
        userId: session.user.id,
        active: true,
      },
      select: {
        id: true,
        name: true,
        role: true,
        persona: true,
        avatarEmoji: true,
        style: true,
        sortOrder: true,
        lifeAreas: {
          select: { name: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    const result = mentors.map((m) => ({
      ...m,
      persona: m.persona.length > 100 ? m.persona.slice(0, 100) + "..." : m.persona,
      lifeAreas: m.lifeAreas.map((la) => la.name),
    }));

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

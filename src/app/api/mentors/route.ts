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
        // Which Claude model answers as this mentor. Shown as one small badge in the
        // details sheet, never next to every reply.
        model: true,
        sortOrder: true,
        lifeAreas: {
          select: { name: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    // Persona is sent whole. It used to be cut at 100 characters here, which also cut
    // the "Opis" block in the details sheet down to one truncated sentence with a "...".
    // The tile clamps it visually (two lines of CSS), the sheet shows all of it.
    const result = mentors.map((m) => ({
      ...m,
      lifeAreas: m.lifeAreas.map((la) => la.name),
    }));

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

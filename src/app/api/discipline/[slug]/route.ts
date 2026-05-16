import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const { slug } = await params;
  const targetSlug = slug.toLowerCase();

  try {
    // Find lifeArea by slug or by slugified name
    const allAreas = await prisma.lifeArea.findMany({
      where: { userId: session.user.id, active: true },
    });

    const lifeArea = allAreas.find((a) => {
      if (a.slug && a.slug.toLowerCase() === targetSlug) return true;
      if (slugify(a.name) === targetSlug) return true;
      return false;
    });

    if (!lifeArea) {
      return NextResponse.json(
        { error: "Dyscyplina nie znaleziona" },
        { status: 404 }
      );
    }

    const [trainingLogs, personalRecords, goals, mentor] = await Promise.all([
      prisma.trainingLog.findMany({
        where: { userId: session.user.id, lifeAreaId: lifeArea.id },
        orderBy: { date: "desc" },
        take: 30,
      }),
      prisma.personalRecord.findMany({
        where: { userId: session.user.id, lifeAreaId: lifeArea.id },
        orderBy: { achievedAt: "desc" },
      }),
      prisma.goal.findMany({
        where: {
          userId: session.user.id,
          lifeAreaId: lifeArea.id,
          status: "active",
        },
        include: {
          milestones: { orderBy: { sortOrder: "asc" } },
          mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      }),
      prisma.mentor.findFirst({
        where: {
          userId: session.user.id,
          active: true,
          lifeAreas: { some: { id: lifeArea.id } },
        },
        select: {
          id: true,
          name: true,
          role: true,
          persona: true,
          avatarEmoji: true,
          style: true,
        },
      }),
    ]);

    return NextResponse.json({
      lifeArea: {
        id: lifeArea.id,
        name: lifeArea.name,
        slug: lifeArea.slug,
        category: lifeArea.category,
        description: lifeArea.description,
      },
      trainingLogs,
      personalRecords,
      goals,
      mentor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

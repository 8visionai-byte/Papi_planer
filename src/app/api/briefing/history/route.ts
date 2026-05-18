import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setHours(0, 0, 0, 0);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const briefings = await prisma.briefing.findMany({
    where: {
      userId,
      date: { gte: thirtyDaysAgo },
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      content: true,
      audioUrl: true,
      createdAt: true,
    },
  });

  const items = briefings.map((b) => ({
    id: b.id,
    date: b.date.toISOString().slice(0, 10),
    summary: b.content.slice(0, 200).trim(),
    content: b.content,
    hasAudio: Boolean(b.audioUrl),
    audioUrl: b.audioUrl,
    createdAt: b.createdAt.toISOString(),
  }));

  return NextResponse.json({ items });
}

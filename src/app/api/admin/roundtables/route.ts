import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnien" }, { status: 403 });
  }

  const sessions = await prisma.roundTableSession.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      inputText: true,
      inputType: true,
      consensus: true,
      debateTranscript: true,
      planChanges: true,
      applied: true,
      createdAt: true,
    },
  });

  return NextResponse.json(sessions);
}

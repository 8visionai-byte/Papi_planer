import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const body = await req.json();
  const { externalId, date } = body as {
    externalId?: string;
    date?: string;
  };

  if (!externalId || typeof externalId !== "string") {
    return NextResponse.json({ error: "externalId required" }, { status: 400 });
  }
  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date required as YYYY-MM-DD" },
      { status: 400 },
    );
  }

  // Build a Date at UTC midnight for the given YYYY-MM-DD so it maps to a stable @db.Date row
  const dateOnly = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dateOnly.getTime())) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const existing = await prisma.meetingCompletion.findUnique({
    where: {
      userId_externalId_date: {
        userId,
        externalId,
        date: dateOnly,
      },
    },
  });

  if (existing) {
    await prisma.meetingCompletion.delete({ where: { id: existing.id } });
    return NextResponse.json({ completed: false });
  }

  await prisma.meetingCompletion.create({
    data: {
      userId,
      externalId,
      date: dateOnly,
    },
  });
  return NextResponse.json({ completed: true });
}

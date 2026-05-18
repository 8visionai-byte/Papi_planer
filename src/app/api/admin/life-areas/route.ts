import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 401 });
  }

  try {
    const lifeAreas = await prisma.lifeArea.findMany({
      where: { userId: session.user.id, active: true },
      select: { id: true, name: true },
      orderBy: { priority: "desc" },
    });

    return NextResponse.json(lifeAreas);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

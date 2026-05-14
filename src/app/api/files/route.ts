import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  try {
    const files = await prisma.userFile.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        analysis: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

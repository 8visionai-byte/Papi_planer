import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  try {
    const [users, allowedEmails] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          _count: {
            select: {
              dailyLogs: true,
              mentors: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.allowedEmail.findMany({
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json({ users, allowedEmails });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email, role = "USER" } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email jest wymagany" }, { status: 400 });
    }

    const existing = await prisma.allowedEmail.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      return NextResponse.json({ error: "Email już istnieje na liście" }, { status: 409 });
    }

    const allowed = await prisma.allowedEmail.create({
      data: {
        email: email.toLowerCase(),
        role: role === "ADMIN" ? "ADMIN" : "USER",
        addedBy: session.user.id,
      },
    });

    return NextResponse.json(allowed, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email jest wymagany" }, { status: 400 });
    }

    const existing = await prisma.allowedEmail.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!existing) {
      return NextResponse.json({ error: "Email nie znaleziony" }, { status: 404 });
    }

    await prisma.allowedEmail.delete({
      where: { email: email.toLowerCase() },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

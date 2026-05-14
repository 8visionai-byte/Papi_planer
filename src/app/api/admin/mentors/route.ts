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
    const mentors = await prisma.mentor.findMany({
      where: { userId: session.user.id },
      include: {
        lifeAreas: {
          select: { id: true, name: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json(mentors);
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
    const { name, role, persona, systemPrompt, avatarEmoji, lifeAreaIds } = body;

    if (!name || !role || !persona || !systemPrompt) {
      return NextResponse.json(
        { error: "Nazwa, rola, persona i system prompt są wymagane" },
        { status: 400 }
      );
    }

    const mentor = await prisma.mentor.create({
      data: {
        userId: session.user.id,
        name,
        role,
        persona,
        systemPrompt,
        avatarEmoji: avatarEmoji || "🧑‍🏫",
        lifeAreas: lifeAreaIds?.length
          ? { connect: lifeAreaIds.map((id: string) => ({ id })) }
          : undefined,
      },
      include: {
        lifeAreas: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(mentor, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, name, role, persona, systemPrompt, avatarEmoji, active, sortOrder, lifeAreaIds } =
      body;

    if (!id) {
      return NextResponse.json({ error: "ID mentora jest wymagane" }, { status: 400 });
    }

    // Verify mentor belongs to admin
    const existing = await prisma.mentor.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Mentor nie znaleziony" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (role !== undefined) updateData.role = role;
    if (persona !== undefined) updateData.persona = persona;
    if (systemPrompt !== undefined) updateData.systemPrompt = systemPrompt;
    if (avatarEmoji !== undefined) updateData.avatarEmoji = avatarEmoji;
    if (active !== undefined) updateData.active = active;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    if (lifeAreaIds !== undefined) {
      updateData.lifeAreas = {
        set: lifeAreaIds.map((laId: string) => ({ id: laId })),
      };
    }

    const mentor = await prisma.mentor.update({
      where: { id },
      data: updateData,
      include: {
        lifeAreas: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(mentor);
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
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "ID mentora jest wymagane" }, { status: 400 });
    }

    // Verify mentor belongs to admin
    const existing = await prisma.mentor.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Mentor nie znaleziony" }, { status: 404 });
    }

    await prisma.mentor.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

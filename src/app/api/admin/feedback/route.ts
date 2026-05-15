import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  const items = await prisma.feedback.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  });

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Niezalogowany" }, { status: 401 });
  }

  const { type, message } = await req.json();
  if (!message?.trim()) {
    return NextResponse.json({ error: "Wiadomość jest wymagana" }, { status: 400 });
  }

  const item = await prisma.feedback.create({
    data: {
      userId: session.user.id,
      type: type || "change",
      message: message.trim(),
    },
  });

  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  const { id, status } = await req.json();
  const item = await prisma.feedback.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  const { id } = await req.json();
  await prisma.feedback.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

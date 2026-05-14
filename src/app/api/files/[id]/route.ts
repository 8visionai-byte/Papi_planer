import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { unlink } from "fs/promises";
import path from "path";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const file = await prisma.userFile.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        analysis: true,
        createdAt: true,
      },
    });

    if (!file) {
      return NextResponse.json(
        { error: "Plik nie znaleziony" },
        { status: 404 }
      );
    }

    return NextResponse.json(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const file = await prisma.userFile.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!file) {
      return NextResponse.json(
        { error: "Plik nie znaleziony" },
        { status: 404 }
      );
    }

    // Delete from disk
    try {
      const filePath = path.join(process.cwd(), file.path);
      // Verify path is within uploads directory
      const resolved = path.resolve(filePath);
      const uploadsRoot = path.resolve(path.join(process.cwd(), "uploads"));
      if (resolved.startsWith(uploadsRoot)) {
        await unlink(filePath);
      }
    } catch {
      // File may already be deleted from disk — continue with DB cleanup
    }

    // Delete from DB
    await prisma.userFile.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

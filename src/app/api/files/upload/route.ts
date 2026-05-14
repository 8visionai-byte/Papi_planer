import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { extractFileContent } from "@/lib/files/parser";
import { analyzeFile } from "@/lib/files/analyzer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

function sanitizeFilename(name: string): string {
  // Remove path separators and null bytes
  return name
    .replace(/[/\\:\0]/g, "_")
    .replace(/\.\./g, "_")
    .slice(0, 200);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Brak pliku w żądaniu" },
        { status: 400 }
      );
    }

    // Validate size
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Plik jest za duży. Maksymalny rozmiar to 10MB." },
        { status: 400 }
      );
    }

    // Validate type
    const mimeType = file.type || "application/octet-stream";
    const ext = ALLOWED_TYPES[mimeType];
    if (!ext) {
      // Fallback: check by extension
      const fileExt = path.extname(file.name).toLowerCase();
      const allowedExts = Object.values(ALLOWED_TYPES);
      if (!allowedExts.includes(fileExt)) {
        return NextResponse.json(
          {
            error: `Nieobsługiwany typ pliku. Dozwolone: PDF, DOCX, XLSX, TXT, CSV, JPG, PNG.`,
          },
          { status: 400 }
        );
      }
    }

    const userId = session.user.id;
    const safeFilename = sanitizeFilename(file.name);
    const timestamp = Date.now();
    const storedName = `${timestamp}_${safeFilename}`;

    // Create upload directory
    const uploadDir = path.join(process.cwd(), "uploads", userId);
    await mkdir(uploadDir, { recursive: true });

    // Validate the resolved path is within uploads
    const resolvedDir = path.resolve(uploadDir);
    const uploadsRoot = path.resolve(path.join(process.cwd(), "uploads"));
    if (!resolvedDir.startsWith(uploadsRoot)) {
      return NextResponse.json(
        { error: "Nieprawidłowa ścieżka" },
        { status: 400 }
      );
    }

    // Save file to disk
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filePath = path.join(uploadDir, storedName);
    await writeFile(filePath, buffer);

    // Extract content
    const content = await extractFileContent(buffer, mimeType, file.name);

    // Analyze with AI
    const analysis = await analyzeFile(content, file.name, userId);

    // Save to DB (store relative path only)
    const relativePath = `uploads/${userId}/${storedName}`;
    const userFile = await prisma.userFile.create({
      data: {
        userId,
        filename: file.name,
        path: relativePath,
        mimeType,
        size: file.size,
        analysis: JSON.parse(JSON.stringify(analysis)),
      },
    });

    return NextResponse.json({
      fileId: userFile.id,
      analysis,
    });
  } catch (err) {
    console.error("File upload error:", err);
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

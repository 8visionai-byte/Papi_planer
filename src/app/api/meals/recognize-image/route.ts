import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { recognizeMealFromImage } from "@/lib/ai/meal-vision";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function normalizeMime(raw: string): string {
  const m = raw.toLowerCase().trim();
  if (m === "image/jpg") return "image/jpeg";
  return m;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Brak pliku 'image'" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Pusty plik" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Plik za duży (max 5MB)" },
      { status: 413 }
    );
  }

  const mime = normalizeMime(file.type || "image/jpeg");
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: "Nieobsługiwany format obrazu" },
      { status: 415 }
    );
  }

  let base64: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    base64 = buf.toString("base64");
  } catch (err) {
    console.error("[recognize-image] read failed", err);
    return NextResponse.json(
      { error: "Nie udało się odczytać pliku" },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await recognizeMealFromImage(base64, mime);
  } catch (err) {
    console.error("[recognize-image] vision failed", err);
    return NextResponse.json(
      { error: "Rozpoznawanie obrazu nie powiodło się" },
      { status: 500 }
    );
  }

  if (!result) {
    return NextResponse.json(
      { error: "Nie udało się rozpoznać posiłku ze zdjęcia" },
      { status: 422 }
    );
  }

  const name =
    result.foods.length > 0 ? result.foods.join(", ") : "Posiłek";

  return NextResponse.json({
    name,
    foods: result.foods,
    calories: result.calories,
    protein: result.protein,
    carbs: result.carbs,
    fat: result.fat,
    confidence: result.confidence,
    notes: result.notes,
  });
}

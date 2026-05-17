import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

type EntryRow = { date: Date; weightKg: number };

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDateInput(raw: unknown): Date {
  if (raw && typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return toDateOnly(parsed);
  }
  return toDateOnly(new Date());
}

function buildAdvisory(entries: EntryRow[]): {
  avg7d: number | null;
  trend7d: number;
  message: string;
} {
  if (entries.length < 7) {
    return {
      avg7d: entries.length
        ? entries.reduce((s, e) => s + e.weightKg, 0) / entries.length
        : null,
      trend7d: 0,
      message: "Wpisuj wagę codziennie rano. Za mało danych do trendu.",
    };
  }

  const last7 = entries.slice(-7);
  const avg7d =
    last7.reduce((sum, e) => sum + e.weightKg, 0) / Math.max(last7.length, 1);

  const prev7 = entries.slice(-14, -7);
  const prevAvg =
    prev7.length >= 4
      ? prev7.reduce((s, e) => s + e.weightKg, 0) / prev7.length
      : null;

  const trend7d = prevAvg !== null ? avg7d - prevAvg : 0;

  let message: string;
  if (prevAvg === null) {
    message = "⚖️ Zbieramy dane do porównania tygodni. Trzymaj rytm!";
  } else if (trend7d < -0.3) {
    message = `🎯 Spadek ${Math.abs(trend7d).toFixed(1)} kg/tyg — deficyt działa!`;
  } else if (trend7d > 0.3) {
    message = `📈 Wzrost ${trend7d.toFixed(1)} kg/tyg`;
  } else {
    message = "⚖️ Trend stabilny — masa się utrzymuje";
  }

  return { avg7d, trend7d, message };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const since = toDateOnly(new Date());
  since.setUTCDate(since.getUTCDate() - 29);

  const rows = await prisma.weightEntry.findMany({
    where: { userId: session.user.id, date: { gte: since } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, weightKg: true, note: true },
  });

  const entries = rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    weightKg: r.weightKg,
    note: r.note,
  }));

  const { avg7d, trend7d, message } = buildAdvisory(
    rows.map((r) => ({ date: r.date, weightKg: r.weightKg }))
  );

  return NextResponse.json({ entries, avg7d, trend7d, message });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rawWeight = body?.weightKg;
  if (rawWeight == null || (typeof rawWeight !== "number" && typeof rawWeight !== "string")) {
    return NextResponse.json({ error: "weightKg wymagane" }, { status: 400 });
  }

  const weightKg = Number(rawWeight);
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 250) {
    return NextResponse.json(
      { error: "weightKg musi być w zakresie 30-250 kg" },
      { status: 400 }
    );
  }

  const date = parseDateInput(body.date);
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 200)
      : null;

  const entry = await prisma.weightEntry.upsert({
    where: { userId_date: { userId: session.user.id, date } },
    create: { userId: session.user.id, date, weightKg, note },
    update: { weightKg, note },
    select: { id: true, date: true, weightKg: true, note: true },
  });

  return NextResponse.json({
    id: entry.id,
    date: entry.date.toISOString().slice(0, 10),
    weightKg: entry.weightKg,
    note: entry.note,
  });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id wymagane" }, { status: 400 });
  }

  const existing = await prisma.weightEntry.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Nie znaleziono" }, { status: 404 });
  }

  await prisma.weightEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

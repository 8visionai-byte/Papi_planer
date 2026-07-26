import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

/**
 * Life areas owned by the signed-in user.
 *
 * This is the USER-facing endpoint (the mentors screen writes through it).
 * `/api/admin/life-areas` stays as it is: it is the read-only list for the admin panel,
 * so nothing that depends on its exact shape breaks.
 */

/** Allowed categories. Kept as ASCII keys so they are safe in slugs, urls and JSON. */
const CATEGORIES = ["zdrowie", "nauka", "praca", "rozwoj", "energia"] as const;
type Category = (typeof CATEGORIES)[number];

const NAME_MIN = 2;
const NAME_MAX = 40;

/** Every relation that points at a life area. One place, so nothing is forgotten. */
const COUNT_SELECT = {
  mentors: true,
  activities: true,
  schedules: true,
  goals: true,
  trainingLogs: true,
  personalRecords: true,
  energyPillars: true,
} as const;

type CountShape = Record<keyof typeof COUNT_SELECT, number>;

interface AreaWithCount {
  id: string;
  name: string;
  slug: string | null;
  category: string | null;
  description: string | null;
  priority: number;
  active: boolean;
  _count: CountShape;
}

/**
 * Polish letters first, then NFD for the rest.
 *
 * "ł" does NOT decompose under NFD (it is one code point), so without this map
 * "Zdrowie i siła" would become "zdrowie-i-si-a". The same slugify shape is used by
 * /api/discipline/[slug], which matches either the stored slug or the slugified name.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/ø/g, "o")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Case-insensitive, whitespace-insensitive comparison used for duplicate names. */
function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

function sumCounts(count: CountShape): number {
  return Object.values(count).reduce((acc, n) => acc + n, 0);
}

function toPayload(area: AreaWithCount) {
  const linkedCount = sumCounts(area._count);
  return {
    id: area.id,
    name: area.name,
    slug: area.slug,
    category: area.category,
    description: area.description,
    priority: area.priority,
    active: area.active,
    /** Shown next to the area in the UI: "3 mentorów". */
    mentorCount: area._count.mentors,
    /** Everything hanging off this area. Drives the "na pewno wyłączyć?" sheet. */
    linkedCount,
    counts: { ...area._count },
  };
}

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

/** 400 body with a Polish message, one shape for the whole file. */
function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

function validateName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Podaj nazwę obszaru." };
  }
  const name = raw.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return {
      ok: false,
      error: `Nazwa obszaru musi mieć od ${NAME_MIN} do ${NAME_MAX} znaków.`,
    };
  }
  return { ok: true, name };
}

function validateCategory(
  raw: unknown,
): { ok: true; category: Category | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, category: null };
  if (typeof raw === "string" && (CATEGORIES as readonly string[]).includes(raw)) {
    return { ok: true, category: raw as Category };
  }
  return {
    ok: false,
    error: `Nieznana kategoria. Wybierz jedną z: ${CATEGORIES.join(", ")}.`,
  };
}

/**
 * Free slug for this user. Duplicated names are already rejected, but two different
 * names can still slugify to the same string ("Ruch!" and "ruch"), and the discipline
 * screen looks areas up by slug, so a collision would open the wrong area.
 */
async function uniqueSlug(userId: string, name: string, ignoreId?: string): Promise<string> {
  const base = slugify(name) || "obszar";
  const taken = await prisma.lifeArea.findMany({
    where: { userId, NOT: ignoreId ? { id: ignoreId } : undefined },
    select: { slug: true },
  });
  const used = new Set(taken.map((a) => (a.slug || "").toLowerCase()).filter(Boolean));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * GET /api/life-areas
 *
 * Returns ALL areas, active and inactive, because this endpoint feeds the management
 * list where turning an area back on has to be possible. Consumers that only want the
 * pickable ones filter on `active`.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 401 });
  }

  try {
    const areas = await prisma.lifeArea.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        priority: true,
        active: true,
        _count: { select: COUNT_SELECT },
      },
      orderBy: [{ active: "desc" }, { priority: "desc" }, { name: "asc" }],
    });

    return NextResponse.json(areas.map(toPayload));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/life-areas — body: { name, category?, description?, priority? } */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));

    const nameCheck = validateName(body?.name);
    if (!nameCheck.ok) return badRequest(nameCheck.error);
    const categoryCheck = validateCategory(body?.category);
    if (!categoryCheck.ok) return badRequest(categoryCheck.error);

    const { name } = nameCheck;

    // Duplicate check covers inactive areas too: a disabled area still owns its history,
    // so creating a second "Ruch" would split goals and records between two rows.
    const existing = await prisma.lifeArea.findMany({
      where: { userId },
      select: { id: true, name: true, active: true },
    });
    const clash = existing.find((a) => normalizeName(a.name) === normalizeName(name));
    if (clash) {
      return badRequest(
        clash.active
          ? `Masz już obszar o nazwie „${clash.name}”.`
          : `Obszar „${clash.name}” już istnieje, ale jest wyłączony. Włącz go zamiast tworzyć nowy.`,
        { existingId: clash.id, existingActive: clash.active },
      );
    }

    const description =
      typeof body?.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    const priority = Number.isFinite(Number(body?.priority)) ? Math.trunc(Number(body.priority)) : 0;

    const area = await prisma.lifeArea.create({
      data: {
        userId,
        name,
        slug: await uniqueSlug(userId, name),
        category: categoryCheck.category,
        description,
        priority,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        priority: true,
        active: true,
        _count: { select: COUNT_SELECT },
      },
    });

    return NextResponse.json(toPayload(area), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/life-areas — body: { id, name?, category?, description?, priority?, active? } */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return badRequest("Podaj id obszaru.");

    const current = await prisma.lifeArea.findFirst({
      where: { id, userId },
      select: { id: true, name: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Nie znaleziono obszaru." }, { status: 404 });
    }

    const data: {
      name?: string;
      slug?: string;
      category?: string | null;
      description?: string | null;
      priority?: number;
      active?: boolean;
    } = {};

    if (body?.name !== undefined) {
      const nameCheck = validateName(body.name);
      if (!nameCheck.ok) return badRequest(nameCheck.error);

      const others = await prisma.lifeArea.findMany({
        where: { userId, NOT: { id } },
        select: { name: true },
      });
      if (others.some((a) => normalizeName(a.name) === normalizeName(nameCheck.name))) {
        return badRequest(`Masz już obszar o nazwie „${nameCheck.name}”.`);
      }

      data.name = nameCheck.name;
      // The slug follows the name. /api/discipline/[slug] also matches the slugified
      // name, so an area renamed here stays reachable under its new name either way.
      if (normalizeName(current.name) !== normalizeName(nameCheck.name)) {
        data.slug = await uniqueSlug(userId, nameCheck.name, id);
      }
    }

    if (body?.category !== undefined) {
      const categoryCheck = validateCategory(body.category);
      if (!categoryCheck.ok) return badRequest(categoryCheck.error);
      data.category = categoryCheck.category;
    }

    if (body?.description !== undefined) {
      data.description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null;
    }

    if (body?.priority !== undefined) {
      const priority = Number(body.priority);
      if (!Number.isFinite(priority)) return badRequest("Priorytet musi być liczbą.");
      data.priority = Math.trunc(priority);
    }

    if (body?.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return badRequest("Pole aktywności musi być wartością tak/nie.");
      }
      data.active = body.active;
    }

    if (Object.keys(data).length === 0) {
      return badRequest("Nie podałeś żadnej zmiany.");
    }

    const area = await prisma.lifeArea.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        priority: true,
        active: true,
        _count: { select: COUNT_SELECT },
      },
    });

    return NextResponse.json(toPayload(area));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/life-areas — body: { id }
 *
 * Soft delete on purpose: it only sets `active = false`.
 *
 * A life area is the anchor of mentors, goals, activities, schedules, training logs,
 * personal records and (from now on) energy pillars. Prisma declares those relations
 * with `onDelete: Cascade`, so a hard delete would silently take the whole history with
 * it - every training log and every personal record of that discipline. There is no undo
 * for that, and the user asked for a way to manage areas, not to lose data. Turning the
 * area off hides it everywhere it is picked, and PATCH { active: true } brings it back.
 *
 * The response carries the relation counts so the UI can say what exactly is attached.
 */
export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const fromQuery = new URL(request.url).searchParams.get("id");
    const id = typeof body?.id === "string" && body.id ? body.id : fromQuery || "";
    if (!id) return badRequest("Podaj id obszaru.");

    const existing = await prisma.lifeArea.findFirst({
      where: { id, userId },
      select: { id: true, active: true, _count: { select: COUNT_SELECT } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Nie znaleziono obszaru." }, { status: 404 });
    }

    // Already off: answer the same way, so a double tap is not an error.
    const area = existing.active
      ? await prisma.lifeArea.update({
          where: { id },
          data: { active: false },
          select: {
            id: true,
            name: true,
            slug: true,
            category: true,
            description: true,
            priority: true,
            active: true,
            _count: { select: COUNT_SELECT },
          },
        })
      : await prisma.lifeArea.findFirstOrThrow({
          where: { id, userId },
          select: {
            id: true,
            name: true,
            slug: true,
            category: true,
            description: true,
            priority: true,
            active: true,
            _count: { select: COUNT_SELECT },
          },
        });

    const payload = toPayload(area);
    return NextResponse.json({
      ok: true,
      softDeleted: true,
      area: payload,
      linkedCount: payload.linkedCount,
      counts: payload.counts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

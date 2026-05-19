import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

// Removes MentorPlan rows that have no associated Goal (legacy plans
// generated before the goalId column was added). Scoped to current user.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await prisma.mentorPlan.deleteMany({
    where: {
      userId: session.user.id,
      goalId: null,
    },
  });

  return NextResponse.json({ deleted: result.count });
}

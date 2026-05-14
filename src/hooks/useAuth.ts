"use client";

import { useSession } from "next-auth/react";
import type { UserRole } from "@/generated/prisma/client";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: UserRole;
}

export function useAuth() {
  const { data: session, status } = useSession();

  return {
    user: session?.user as AuthUser | undefined,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
  };
}

"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

/**
 * On the public landing page (/), silently send already-logged-in users
 * straight to the dashboard. Logged-out visitors (and Google's verification
 * crawler) stay on the landing so the homepage is reachable without login.
 */
export function HomeRedirectIfAuthed() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  return null;
}

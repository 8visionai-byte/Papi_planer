import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import type { UserRole } from "@/generated/prisma/client";
import "@/lib/auth/types";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      const email = user.email;
      if (!email) return false;

      // Check whitelist
      const allowed = await prisma.allowedEmail.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!allowed) {
        return false;
      }

      // If user exists, update googleId if missing
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        if (!existingUser.googleId && account?.providerAccountId) {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { googleId: account.providerAccountId },
          });
        }

        // Persist refreshed Google OAuth tokens (scope, refresh_token, access_token)
        // each time the user signs in, so Calendar API can keep working after re-consent.
        if (account?.provider === "google" && account.providerAccountId) {
          try {
            await prisma.account.upsert({
              where: {
                provider_providerAccountId: {
                  provider: "google",
                  providerAccountId: account.providerAccountId,
                },
              },
              update: {
                access_token: account.access_token ?? undefined,
                // Google only returns refresh_token on prompt=consent; keep existing if missing.
                refresh_token: account.refresh_token ?? undefined,
                expires_at:
                  typeof account.expires_at === "number"
                    ? account.expires_at
                    : undefined,
                token_type: account.token_type ?? undefined,
                scope: account.scope ?? undefined,
                id_token: account.id_token ?? undefined,
              },
              create: {
                userId: existingUser.id,
                type: account.type ?? "oauth",
                provider: "google",
                providerAccountId: account.providerAccountId,
                access_token: account.access_token ?? null,
                refresh_token: account.refresh_token ?? null,
                expires_at:
                  typeof account.expires_at === "number"
                    ? account.expires_at
                    : null,
                token_type: account.token_type ?? null,
                scope: account.scope ?? null,
                id_token: account.id_token ?? null,
              },
            });
          } catch {
            // Don't block sign-in if token persistence fails.
          }
        }
      }

      return true;
    },

    async jwt({ token, user, trigger }) {
      if (user) {
        // First sign-in: fetch user from DB to get role
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email!.toLowerCase() },
        });

        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;

          // If role is default but AllowedEmail specifies a different role, update
          const allowed = await prisma.allowedEmail.findUnique({
            where: { email: token.email!.toLowerCase() },
          });
          if (allowed && allowed.role !== dbUser.role) {
            await prisma.user.update({
              where: { id: dbUser.id },
              data: { role: allowed.role },
            });
            token.role = allowed.role;
          }
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
};

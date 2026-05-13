import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import type { UserRole } from "@/generated/prisma";
import "@/lib/auth/types";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
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
      } else {
        // New user — PrismaAdapter will create them, but we need to set role
        // We do this in a post-creation step via the jwt callback
        // Store the intended role temporarily
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

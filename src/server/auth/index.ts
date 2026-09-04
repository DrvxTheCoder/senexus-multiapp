import "server-only"

import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { compare } from "bcryptjs"
import { z } from "zod"

import { db } from "@/lib/db"
import { edgeAuthConfig } from "@/server/auth/config.edge"
import { loadMemberships, MEMBERSHIP_TTL_MS } from "@/server/auth/memberships"

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...edgeAuthConfig,
  adapter: PrismaAdapter(db),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      /**
       * Verifies against the existing bcrypt hashes in `users.passwordHash`,
       * so every password issued by the legacy application keeps working.
       */
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
          },
        })

        if (!user?.passwordHash) return null

        const valid = await compare(parsed.data.password, user.passwordHash)
        if (!valid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      },
    }),
  ],
  callbacks: {
    ...edgeAuthConfig.callbacks,
    /**
     * §3.2 — memberships and roles are written into the token at sign-in so
     * that authorisation never costs a query. They are re-read when a caller
     * explicitly triggers `update()` after a membership change, and once per
     * TTL window as a safety net.
     */
    async jwt({ token, user, trigger }) {
      const signingIn = Boolean(user)
      const stale =
        typeof token.membershipsAt !== "number" ||
        Date.now() - token.membershipsAt > MEMBERSHIP_TTL_MS

      if (signingIn && user?.id) {
        token.sub = user.id
      }

      if (token.sub && (signingIn || trigger === "update" || stale)) {
        const memberships = await loadMemberships(token.sub)
        token.memberships = memberships
        token.holdingIds = [...new Set(memberships.map((m) => m.holdingId))]
        token.membershipsAt = Date.now()
      }

      return token
    },
  },
})

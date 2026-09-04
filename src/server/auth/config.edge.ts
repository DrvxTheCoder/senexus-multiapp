import type { NextAuthConfig } from "next-auth"
import type { JWT } from "next-auth/jwt"

/**
 * Edge-safe half of the auth configuration.
 *
 * The proxy runs on the edge runtime and cannot import Prisma or bcrypt, so it
 * gets this config: cookie decoding, session shape, and nothing else. The full
 * configuration (adapter, credentials provider, membership loading) lives in
 * `src/server/auth/index.ts` and only ever runs in Node.
 */
export const edgeAuthConfig = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/sign-in",
    error: "/auth/error",
  },
  providers: [],
  callbacks: {
    /**
     * Read-only projection of the JWT. The proxy needs to know *that* the
     * caller is signed in and which firms they belong to; it never refreshes
     * that data, because it runs on every request including prefetches.
     *
     * Auth.js types this callback over a union covering both the database and
     * the JWT session strategies, so `token` is only narrowed by the strategy
     * at runtime. We pin the strategy to `jwt` above, which makes the assertion
     * sound.
     */
    session({ session, token }) {
      const jwt = token as JWT

      if (jwt.sub) {
        session.user.id = jwt.sub
      }
      session.user.memberships = jwt.memberships ?? []
      session.user.holdingIds = jwt.holdingIds ?? []
      return session
    },
  },
} satisfies NextAuthConfig

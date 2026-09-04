import NextAuth from "next-auth"
import { NextResponse } from "next/server"

import { edgeAuthConfig } from "@/server/auth/config.edge"

/**
 * Next 16 renames middleware to proxy. This file must stay edge-safe: it reads
 * the session cookie and nothing else. No Prisma, no bcrypt, no database.
 *
 * The check here is deliberately optimistic — it redirects anonymous traffic
 * away from application routes so we do not render a shell for someone who
 * cannot see it. Real authorisation is `requireFirmAccess`, on the server, per
 * request. This is not a security boundary.
 */
const { auth } = NextAuth(edgeAuthConfig)

const PUBLIC_PREFIXES = [
  "/auth",
  "/api/auth",
  // The manifest and its icons must be reachable without a session, or the
  // browser cannot offer installation on the sign-in page — which is precisely
  // the inconsistency the previous application had. They contain no data.
  "/manifest.webmanifest",
  "/icons/",
]

export default auth((req) => {
  const { pathname, search } = req.nextUrl

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  if (!req.auth?.user) {
    const signIn = new URL("/auth/sign-in", req.nextUrl.origin)
    signIn.searchParams.set("callbackUrl", `${pathname}${search}`)
    return NextResponse.redirect(signIn)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /**
     * Everything except static assets and image optimisation. Route handlers
     * are included on purpose: an unauthenticated API call should not reach a
     * handler at all.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
}

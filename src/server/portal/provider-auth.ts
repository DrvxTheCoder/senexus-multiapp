import "server-only"

import { compare, hash } from "bcryptjs"
import { z } from "zod"

import { db } from "@/lib/db"
import { PortalError } from "@/server/portal/http"
import {
  afterFailedAttempt,
  issueProviderToken,
  lockRemaining,
  normaliseProviderCode,
  passwordProblem,
  PROVIDER_SESSION_TTL_SECONDS,
  verifyProviderToken,
} from "@/server/portal/provider-credentials"
import { FailureLimiter } from "@/server/portal/token"

/**
 * Connexion prestataire — code prestataire and password.
 *
 * Separate from both other logins on purpose: not a User (no route into the
 * back office), not a PortalAccount (no family), its own secret, its own
 * session table. A provider session reaches `/api/portail/prestataire/*` and
 * nothing else, and every query behind it is scoped to the account's own
 * `providerId`.
 *
 * Failures answer one sentence whatever went wrong — unknown code, wrong
 * password, deactivated account — so the login cannot be used to learn which
 * codes exist. Two counters stop guessing:
 *
 *   - on the account, persisted: five wrong passwords lock it fifteen minutes;
 *   - in memory, per code typed: the same five-in-fifteen for codes that do
 *     not exist, so an unknown code locks exactly like a known one would.
 *
 * No self-service reset: a gestionnaire resets the password from the provider
 * page, which issues a temporary one to change at first login.
 */

export const BCRYPT_COST = 10

export function providerTokenSecret(): string {
  const secret = process.env.PROVIDER_TOKEN_SECRET
  if (!secret || secret.length < 32) {
    throw new PortalError(
      503,
      "NOT_CONFIGURED",
      "L'accès prestataire n'est pas encore disponible. Réessayez plus tard."
    )
  }
  return secret
}

const globalForLimiter = globalThis as unknown as { providerLoginLimiter?: FailureLimiter }
const limiter = (globalForLimiter.providerLoginLimiter ??= new FailureLimiter(5, 15 * 60_000))

/** Test hook: the limiter is per process and would leak between test cases. */
export function resetProviderLoginLimiter(): void {
  globalForLimiter.providerLoginLimiter = new FailureLimiter(5, 15 * 60_000)
}

const currentLimiter = () => globalForLimiter.providerLoginLimiter ?? limiter

// Compared against when the code is unknown, so both paths cost one bcrypt.
// Generated once rather than written out, so it is a real hash at the cost
// the real ones use.
let dummyHash: Promise<string> | null = null
const unknownAccountHash = () => (dummyHash ??= hash("unknown-provider-account", BCRYPT_COST))

const INVALID = () =>
  new PortalError(401, "INVALID_CREDENTIALS", "Code prestataire ou mot de passe incorrect.")

const LOCKED = (seconds: number) =>
  new PortalError(
    429,
    "ACCOUNT_LOCKED",
    `Trop de tentatives. Réessayez dans ${Math.max(1, Math.ceil(seconds / 60))} min.`,
    undefined,
    { "Retry-After": String(seconds) }
  )

export const providerLoginSchema = z.object({
  code: z.string().trim().min(1, "Code requis.").max(40),
  password: z.string().min(1, "Mot de passe requis.").max(200),
})

export type ProviderLoginResult = {
  token: string
  expiresAt: string
  mustChangePassword: boolean
  provider: { id: string; name: string; code: string }
}

export async function providerLogin(
  raw: unknown,
  now: Date = new Date()
): Promise<ProviderLoginResult> {
  const secret = providerTokenSecret()
  const input = providerLoginSchema.parse(raw)
  const code = normaliseProviderCode(input.code)

  const wait = currentLimiter().retryAfter(code, now.getTime())
  if (wait > 0) throw LOCKED(wait)

  const account = await db.providerAccount.findUnique({
    where: { username: code },
    select: {
      id: true,
      firmId: true,
      passwordHash: true,
      isActive: true,
      failedAttempts: true,
      lockedUntil: true,
      mustChangePassword: true,
      provider: { select: { id: true, name: true } },
    },
  })

  const locked = lockRemaining(account?.lockedUntil ?? null, now)
  if (locked > 0) throw LOCKED(locked)

  const matches = await compare(input.password, account?.passwordHash ?? (await unknownAccountHash()))

  if (!account || !matches || !account.isActive) {
    currentLimiter().fail(code, now.getTime())
    if (account && !matches) {
      await db.providerAccount.update({
        where: { id: account.id },
        data: afterFailedAttempt(account.failedAttempts, now),
      })
    }
    throw INVALID()
  }

  currentLimiter().clear(code)
  const expiresAt = new Date(now.getTime() + PROVIDER_SESSION_TTL_SECONDS * 1000)
  const [session] = await db.$transaction([
    db.providerSession.create({
      data: { accountId: account.id, expiresAt },
      select: { id: true },
    }),
    db.providerAccount.update({
      where: { id: account.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: now },
    }),
  ])

  const { token } = issueProviderToken({ sessionId: session.id, accountId: account.id }, secret, now)
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    mustChangePassword: account.mustChangePassword,
    provider: { id: account.provider.id, name: account.provider.name, code },
  }
}

/* ==========================================================================
 * La session
 * ========================================================================== */

export type ProviderPrincipal = {
  providerAccountId: string
  providerId: string
  firmId: string
  sessionId: string
  username: string
  mustChangePassword: boolean
}

const UNAUTHENTICATED = () =>
  new PortalError(401, "UNAUTHENTICATED", "Votre session a expiré. Reconnectez-vous.")

/**
 * Who is calling a provider route. The token proves which session; the row
 * proves it is still open, the account still active and the module still on —
 * read on every request, so a revocation takes effect on the next one.
 *
 * A temporary password confines the session to the change-password route.
 */
export async function requireProviderAccount(
  request: Request,
  options: { allowPendingPasswordChange?: boolean } = {},
  now: Date = new Date()
): Promise<ProviderPrincipal> {
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) throw UNAUTHENTICATED()

  const verified = verifyProviderToken(match[1], providerTokenSecret(), now)
  if (!verified.valid) throw UNAUTHENTICATED()

  const session = await db.providerSession.findUnique({
    where: { id: verified.payload.sid },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      account: {
        select: {
          id: true,
          firmId: true,
          providerId: true,
          username: true,
          isActive: true,
          mustChangePassword: true,
          provider: { select: { status: true } },
          firm: {
            select: {
              firmModules: {
                where: { module: { slug: "ipm" } },
                select: { isEnabled: true },
              },
            },
          },
        },
      },
    },
  })

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.account.id !== verified.payload.aid ||
    !session.account.isActive ||
    !session.account.firm.firmModules.some((m) => m.isEnabled)
  ) {
    throw UNAUTHENTICATED()
  }

  if (session.account.mustChangePassword && !options.allowPendingPasswordChange) {
    throw new PortalError(
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "Choisissez un nouveau mot de passe avant de continuer."
    )
  }

  return {
    providerAccountId: session.account.id,
    providerId: session.account.providerId,
    firmId: session.account.firmId,
    sessionId: session.id,
    username: session.account.username,
    mustChangePassword: session.account.mustChangePassword,
  }
}

export async function providerLogout(principal: ProviderPrincipal): Promise<void> {
  await db.providerSession.updateMany({
    where: { id: principal.sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis.").max(200),
  newPassword: z.string().min(1, "Nouveau mot de passe requis.").max(200),
})

/**
 * The only route a temporary password may reach. Every other session of the
 * account is closed: whoever knew the old password is logged out.
 */
export async function changeProviderPassword(
  principal: ProviderPrincipal,
  raw: unknown,
  now: Date = new Date()
): Promise<{ mustChangePassword: false }> {
  const input = changePasswordSchema.parse(raw)
  const account = await db.providerAccount.findUniqueOrThrow({
    where: { id: principal.providerAccountId },
    select: { passwordHash: true, username: true },
  })

  if (!(await compare(input.currentPassword, account.passwordHash))) {
    throw new PortalError(422, "INVALID_CREDENTIALS", "Le mot de passe actuel est incorrect.", {
      fields: { currentPassword: ["Mot de passe incorrect."] },
    })
  }
  const problem = passwordProblem(input.newPassword, account.username)
  if (problem) {
    throw new PortalError(422, "WEAK_PASSWORD", problem, { fields: { newPassword: [problem] } })
  }
  if (input.newPassword === input.currentPassword) {
    const message = "Le nouveau mot de passe doit être différent de l'actuel."
    throw new PortalError(422, "WEAK_PASSWORD", message, { fields: { newPassword: [message] } })
  }

  await db.$transaction([
    db.providerAccount.update({
      where: { id: principal.providerAccountId },
      data: {
        passwordHash: await hash(input.newPassword, BCRYPT_COST),
        mustChangePassword: false,
        passwordChangedAt: now,
      },
    }),
    db.providerSession.updateMany({
      where: {
        accountId: principal.providerAccountId,
        revokedAt: null,
        id: { not: principal.sessionId },
      },
      data: { revokedAt: now },
    }),
  ])
  return { mustChangePassword: false }
}

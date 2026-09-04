import "server-only"

import { Prisma } from "@prisma/client"

import type { FirmContext } from "@/server/auth/require-firm-access"

/**
 * Role scoping.
 *
 * §3.5 is emphatic about this: role scoping lives inside the where-builder,
 * never in a handler. A user restricted to their own clients must get the same
 * restriction on the list, the facet counts, the export and the bulk actions,
 * automatically — otherwise the export leaks, which is a live bug in the
 * application being replaced.
 *
 * Every resolver in this directory starts from one of these two helpers. There
 * is no code path that reaches the database with only a `firmId`.
 */

/**
 * Prisma predicate restricting rows to the clients this caller may see.
 *
 * Returns `{}` for unrestricted roles. For a client-scoped role it returns a
 * predicate on `clientId`; an empty assignment list therefore yields
 * `clientId IN []`, which matches nothing — deliberately. A responsable with no
 * assigned clients sees nothing, rather than everything.
 */
export function clientScopeWhere(
  ctx: FirmContext,
  column: "clientId" | "assignedClientId"
): Record<string, unknown> {
  if (ctx.assignedClientIds === null) return {}
  return { [column]: { in: ctx.assignedClientIds } }
}

/** The same restriction as a SQL fragment, for the raw resolvers. */
export function clientScopeSql(
  ctx: FirmContext,
  column: Prisma.Sql
): Prisma.Sql | null {
  if (ctx.assignedClientIds === null) return null
  if (ctx.assignedClientIds.length === 0) {
    return Prisma.sql`false`
  }
  return Prisma.sql`${column} IN (${Prisma.join(ctx.assignedClientIds)})`
}

/**
 * True when the caller sees only part of the firm. Used to label totals in the
 * UI honestly — "396 contrats" means something different to a responsable than
 * it does to an administrator.
 */
export function isScoped(ctx: FirmContext): boolean {
  return ctx.assignedClientIds !== null
}

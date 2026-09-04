"use server"

import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { requireFirmAccess } from "@/server/auth/require-firm-access"
import {
  INTERIM_CEILING_DAYS,
  computeCeiling,
  renewalWouldBreach,
} from "@/server/domain/interim-ceiling"
import {
  contractQuerySchema,
  type ContractQuery,
} from "@/lib/queries/contract-query"
import { resolveContractSelection } from "@/server/queries/contracts"
import {
  createSavedView,
  deleteSavedView,
} from "@/server/queries/saved-views"
import type { Selection } from "@/server/queries/types"

/**
 * Every action starts with `requireFirmAccess`. None of them takes a firmId
 * from the client: the slug is the only thing trusted from the caller, and the
 * scope travels in the returned context.
 */

export type RenewalPreflightRow = {
  contractId: string
  employeeId: string
  employeeName: string
  matricule: string
  type: string
  usedDays: number
  projectedDays: number
  /** Days the renewal would add. */
  additionalDays: number
  blocked: boolean
  reason: string | null
}

export type RenewalPreflight = {
  durationDays: number
  allowed: RenewalPreflightRow[]
  blocked: RenewalPreflightRow[]
}

/**
 * §6 — the bulk renewal pre-flight.
 *
 * Evaluates the ceiling per employee and reports which renewals are blocked,
 * with reasons, **before** the user commits. Nothing is written here.
 *
 * The test is against `projectedDays`, not days already worked: a renewal is
 * judged on where it would land. An employee at 600 days worked but already
 * contracted to 700 cannot take another 90.
 */
export async function previewBulkRenewal(
  firmSlug: string,
  selection: Selection<ContractQuery>,
  durationDays: number
): Promise<RenewalPreflight> {
  const ctx = await requireFirmAccess(firmSlug, "MANAGER")
  const ids = await resolveContractSelection(normaliseSelection(selection), ctx)

  if (ids.length === 0) {
    return { durationDays, allowed: [], blocked: [] }
  }

  const contracts = await db.contract.findMany({
    where: { id: { in: ids }, firmId: ctx.firmId },
    select: {
      id: true,
      type: true,
      status: true,
      endDate: true,
      employee: {
        select: { id: true, firstName: true, lastName: true, matricule: true },
      },
    },
  })

  // One query for the whole ceiling history of every employee involved,
  // firm-scoped: days worked for another group firm do not count (§6).
  const employeeIds = [...new Set(contracts.map((row) => row.employee.id))]
  const history = await db.contract.findMany({
    where: { firmId: ctx.firmId, employeeId: { in: employeeIds } },
    select: { employeeId: true, startDate: true, endDate: true, type: true },
  })

  const byEmployee = new Map<string, typeof history>()
  for (const row of history) {
    const list = byEmployee.get(row.employeeId) ?? []
    list.push(row)
    byEmployee.set(row.employeeId, list)
  }

  const now = new Date()
  const allowed: RenewalPreflightRow[] = []
  const blocked: RenewalPreflightRow[] = []

  for (const contract of contracts) {
    const periods = byEmployee.get(contract.employee.id) ?? []
    const ceiling = computeCeiling(periods, contract.type, now)

    const row: RenewalPreflightRow = {
      contractId: contract.id,
      employeeId: contract.employee.id,
      employeeName: `${contract.employee.firstName} ${contract.employee.lastName}`,
      matricule: contract.employee.matricule,
      type: contract.type,
      usedDays: ceiling.usedDays,
      projectedDays: ceiling.projectedDays,
      additionalDays: durationDays,
      blocked: false,
      reason: null,
    }

    if (contract.status === "TERMINATED") {
      blocked.push({ ...row, blocked: true, reason: "Contrat résilié." })
      continue
    }

    if (contract.status === "RENEWED") {
      blocked.push({
        ...row,
        blocked: true,
        reason: "Contrat déjà renouvelé.",
      })
      continue
    }

    if (renewalWouldBreach(ceiling, durationDays)) {
      const over = ceiling.projectedDays + durationDays - INTERIM_CEILING_DAYS
      blocked.push({
        ...row,
        blocked: true,
        reason: `Dépasserait le plafond de ${over} jour${over > 1 ? "s" : ""}. Requalification en CDI à envisager.`,
      })
      continue
    }

    allowed.push(row)
  }

  return { durationDays, allowed, blocked }
}

/**
 * Applies the renewal. Re-runs the pre-flight rather than trusting the
 * client's version of it: the preview may be minutes old, and nothing that was
 * blocked when previewed may slip through here.
 *
 * Never silently skips (§6) — the result says exactly what was refused.
 */
export async function runBulkRenewal(
  firmSlug: string,
  selection: Selection<ContractQuery>,
  durationDays: number
): Promise<{ renewed: number; refused: RenewalPreflightRow[] }> {
  const ctx = await requireFirmAccess(firmSlug, "MANAGER")
  const preflight = await previewBulkRenewal(firmSlug, selection, durationDays)

  if (preflight.allowed.length === 0) {
    return { renewed: 0, refused: preflight.blocked }
  }

  const sources = await db.contract.findMany({
    where: {
      id: { in: preflight.allowed.map((row) => row.contractId) },
      firmId: ctx.firmId,
    },
  })

  const now = new Date()

  await db.$transaction(async (tx) => {
    for (const source of sources) {
      const start = source.endDate ? addDays(source.endDate, 1) : now
      await tx.contract.create({
        data: {
          firmId: source.firmId,
          employeeId: source.employeeId,
          clientId: source.clientId,
          clientFirmId: source.clientFirmId,
          type: source.type,
          status: "ACTIVE",
          startDate: start,
          endDate: addDays(start, durationDays - 1),
          renewedFromId: source.id,
          alertThreshold: source.alertThreshold,
          isAutoRenewal: source.isAutoRenewal,
          position: source.position,
          salary: source.salary,
          workingHours: source.workingHours,
          // A renewal is a new contract and needs its own visa.
          isVise: false,
          isActive: true,
        },
      })

      await tx.contract.update({
        where: { id: source.id },
        data: { status: "RENEWED", isActive: false, renewalDate: now },
      })

      await tx.auditLog.create({
        data: {
          firmId: ctx.firmId,
          actorId: ctx.userId,
          action: "contract.renew",
          entity: "Contract",
          entityId: source.id,
          metadata: { durationDays, employeeId: source.employeeId },
        },
      })
    }
  })

  revalidatePath(`/${firmSlug}/hr/contracts`)

  return { renewed: preflight.allowed.length, refused: preflight.blocked }
}

/* -------------------------------------------------------------------------- */

export async function saveContractView(
  firmSlug: string,
  name: string,
  query: ContractQuery
): Promise<void> {
  const ctx = await requireFirmAccess(firmSlug)
  const parsed = contractQuerySchema.parse(query)

  await createSavedView(ctx, {
    name,
    resource: "contracts",
    // Page number is deliberately not stored: a saved view is a filter, not a
    // position in a result set.
    query: { ...parsed, page: 1 },
  })

  revalidatePath(`/${firmSlug}/hr/contracts`)
}

export async function removeContractView(
  firmSlug: string,
  id: string
): Promise<void> {
  const ctx = await requireFirmAccess(firmSlug)
  await deleteSavedView(ctx, id)
  revalidatePath(`/${firmSlug}/hr/contracts`)
}

/* -------------------------------------------------------------------------- */

/**
 * A selection arriving from the client is re-validated before it reaches the
 * resolver, so a hand-crafted query cannot smuggle in a filter shape the
 * schema would reject.
 */
function normaliseSelection(
  selection: Selection<ContractQuery>
): Selection<ContractQuery> {
  if ("ids" in selection) return { ids: selection.ids }
  return {
    query: contractQuerySchema.parse(selection.query),
    except: selection.except ?? [],
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

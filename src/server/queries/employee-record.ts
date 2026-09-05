import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { computeCeiling, type CeilingResult } from "@/server/domain/interim-ceiling"

/**
 * Everything the employee record shows, in one place.
 *
 * The record is five tabs over one person, so it is one query set rather than
 * five screens each fetching for themselves. Tenancy and the caller's client
 * scope are predicates on the root lookup: an id belonging to another firm, or
 * to a client this caller is not assigned, is simply not found.
 */

export type EmployeeRecord = NonNullable<Awaited<ReturnType<typeof getEmployeeRecord>>>

export async function getEmployeeRecord(employeeId: string, ctx: FirmContext) {
  const employee = await db.employee.findFirst({
    where: {
      id: employeeId,
      firmId: ctx.firmId,
      ...(ctx.assignedClientIds
        ? { assignedClientId: { in: ctx.assignedClientIds } }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      matricule: true,
      photoUrl: true,
      jobTitle: true,
      category: true,
      status: true,
      hireDate: true,
      phone: true,
      email: true,
      address: true,
      dateOfBirth: true,
      placeOfBirth: true,
      gender: true,
      maritalStatus: true,
      nationality: true,
      cni: true,
      fatherName: true,
      motherName: true,
      netSalary: true,
      // Needed by the edit wizard, which writes every field it shows: a form
      // that renders a blank because the query did not select the column would
      // clear the value on save.
      contractEndDate: true,
      createdAt: true,
      updatedAt: true,
      assignedClient: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  })

  if (!employee) return null

  const [contracts, leaves, balances, documents, transfers] = await Promise.all([
    // The whole history in this firm, newest first — the renewal chain is
    // rebuilt from `renewedFromId` rather than fetched link by link.
    db.contract.findMany({
      where: { employeeId, firmId: ctx.firmId },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        renewalDate: true,
        renewedFromId: true,
        salary: true,
        position: true,
        isVise: true,
        alertThreshold: true,
        notes: true,
        terminationReason: true,
        client: { select: { id: true, name: true } },
      },
    }),

    db.leaveRequest.findMany({
      where: { employeeId, firmId: ctx.firmId },
      orderBy: { startDate: "desc" },
      take: 40,
      select: {
        id: true,
        leaveType: true,
        status: true,
        startDate: true,
        endDate: true,
        totalDays: true,
        isPaid: true,
        reason: true,
        requestedAt: true,
        reviewedAt: true,
        rejectionReason: true,
      },
    }),

    db.leaveBalance.findMany({
      where: { employeeId },
      orderBy: [{ year: "desc" }, { leaveType: "asc" }],
      select: {
        id: true,
        year: true,
        leaveType: true,
        totalDays: true,
        usedDays: true,
        remainingDays: true,
        carriedOver: true,
      },
    }),

    db.employeeDocument.findMany({
      where: { employeeId, firmId: ctx.firmId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        documentType: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        expiryDate: true,
        isVerified: true,
        verifiedAt: true,
        createdAt: true,
        description: true,
        // `fileUrl` and `storageKey` are deliberately NOT selected: §3.7
        // forbids a raw storage URL reaching the HTML. Bytes are served
        // through /api/files/[documentId].
      },
    }),

    // Parcours (§5.5, Q5): the group history, from transfers only — never from
    // fuzzy-matching a CNI across tenants.
    db.employeeTransfer.findMany({
      where: { employeeId },
      orderBy: { effectiveDate: "desc" },
      select: {
        id: true,
        status: true,
        transferDate: true,
        effectiveDate: true,
        reason: true,
        newMatricule: true,
        fromFirm: { select: { id: true, name: true, slug: true } },
        toFirm: { select: { id: true, name: true, slug: true } },
      },
    }),
  ])

  const current =
    contracts.find((contract) => contract.status === "ACTIVE") ?? contracts[0] ?? null

  const ceiling: CeilingResult = computeCeiling(
    contracts.map((contract) => ({
      startDate: contract.startDate,
      endDate: contract.endDate,
      type: contract.type,
    })),
    current?.type ?? null
  )

  return {
    employee,
    contracts,
    current,
    ceiling,
    chains: buildChains(contracts),
    leaves,
    balances,
    documents,
    transfers,
    parcours: buildParcours(contracts, transfers, ctx),
  }
}

type ContractLite = {
  id: string
  renewedFromId: string | null
  startDate: Date
  endDate: Date | null
  type: string
  status: string
}

/**
 * Renewal chains (§5.5 "Contrats").
 *
 * Contracts link backwards through `renewedFromId`. A chain is a run of them;
 * an employee usually has one, but a gap in service starts a new one. Returned
 * oldest-first inside each chain, newest chain first, with the cumulative day
 * count at each step so the timeline can show how the total was reached.
 */
function buildChains<T extends ContractLite>(contracts: T[]) {
  const byId = new Map(contracts.map((contract) => [contract.id, contract]))
  const isRenewed = new Set(
    contracts.map((contract) => contract.renewedFromId).filter(Boolean) as string[]
  )

  // A chain head is a contract nothing renews into.
  const heads = contracts.filter((contract) => !isRenewed.has(contract.id))

  const chains = heads.map((head) => {
    const chain: T[] = []
    let cursor: T | undefined = head
    while (cursor) {
      chain.unshift(cursor)
      cursor = cursor.renewedFromId
        ? (byId.get(cursor.renewedFromId) as T | undefined)
        : undefined
    }

    let cumulative = 0
    const steps = chain.map((contract) => {
      const end = contract.endDate ?? new Date()
      const days = Math.max(
        0,
        Math.round((end.getTime() - contract.startDate.getTime()) / 86_400_000) + 1
      )
      if (contract.type === "INTERIM") cumulative += days
      return { contract, days, cumulative }
    })

    return { id: head.id, steps }
  })

  return chains.sort(
    (a, b) =>
      (b.steps.at(-1)?.contract.startDate.getTime() ?? 0) -
      (a.steps.at(-1)?.contract.startDate.getTime() ?? 0)
  )
}

export type ParcoursEntry = {
  firmId: string
  firmName: string
  firmSlug: string | null
  matricule: string | null
  current: boolean
  from: Date | null
  to: Date | null
  contractCount: number
  /** Cumulative interim days *in that firm*. The ceiling is per employer. */
  note: string
}

/**
 * The group history.
 *
 * `Employee` is per-firm and a transfer *moves* the row (see DATA_MODEL §5), so
 * the only durable trace of a past employer is the transfer record plus the
 * contracts that stayed behind under their original `firmId`. That is what is
 * reconstructed here — no CNI matching, no cross-tenant joins.
 */
function buildParcours(
  contracts: { id: string; startDate: Date; endDate: Date | null }[],
  transfers: {
    status: string
    effectiveDate: Date
    newMatricule: string | null
    fromFirm: { id: string; name: string; slug: string }
    toFirm: { id: string; name: string; slug: string }
  }[],
  ctx: FirmContext
): ParcoursEntry[] {
  const entries = new Map<string, ParcoursEntry>()

  entries.set(ctx.firmId, {
    firmId: ctx.firmId,
    firmName: ctx.firm.name,
    firmSlug: ctx.firm.slug,
    matricule: null,
    current: true,
    from: contracts.at(-1)?.startDate ?? null,
    to: null,
    contractCount: contracts.length,
    note: "Employeur actuel. Le plafond de 730 jours se compte ici.",
  })

  for (const transfer of transfers) {
    const completed = transfer.status === "COMPLETED"
    const other =
      transfer.fromFirm.id === ctx.firmId ? transfer.toFirm : transfer.fromFirm

    if (other.id === ctx.firmId) continue

    const existing = entries.get(other.id)
    entries.set(other.id, {
      firmId: other.id,
      firmName: other.name,
      firmSlug: other.slug,
      matricule: transfer.newMatricule ?? existing?.matricule ?? null,
      current: false,
      from: existing?.from ?? null,
      to: completed ? transfer.effectiveDate : null,
      contractCount: existing?.contractCount ?? 0,
      note: completed
        ? "Transfert effectif. Les jours effectués là-bas ne comptent pas dans ce plafond."
        : `Transfert ${transferLabel(transfer.status)}.`,
    })
  }

  return [...entries.values()].sort((a, b) => Number(b.current) - Number(a.current))
}

function transferLabel(status: string): string {
  return (
    {
      PENDING: "en attente",
      APPROVED: "approuvé, non finalisé",
      REJECTED: "refusé",
      CANCELLED: "annulé",
      COMPLETED: "effectif",
    }[status] ?? status.toLowerCase()
  )
}

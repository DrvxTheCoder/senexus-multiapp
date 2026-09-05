import type { Metadata } from "next"

import { AdminPageHeader } from "@/app/admin/admin-page-header"
import { UsersTable } from "@/app/admin/users/users-table"
import { db } from "@/lib/db"
import { getSession, requireHoldingAccess } from "@/server/auth/require-firm-access"

export const metadata: Metadata = { title: "Utilisateurs" }

export type AdminUser = {
  id: string
  name: string | null
  email: string
  image: string | null
  verified: boolean
  createdAt: Date
  /** One row per firm. The console edits them as a single role for the set. */
  memberships: { firmId: string; firmName: string; role: string }[]
  linkedEmployee: { id: string; label: string } | null
}

export type AdminFirmOption = {
  id: string
  name: string
  clients: { id: string; name: string; status: string }[]
}

/** userId → firmId → assigned client ids. Drives the RESPONSABLE scope. */
export type AssignmentMap = Record<string, Record<string, string[]>>

export default async function AdminUsersPage() {
  await requireHoldingAccess()
  const session = await getSession()

  const [users, firms, employees] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        emailVerified: true,
        createdAt: true,
        userFirms: {
          select: { firmId: true, role: true, firm: { select: { name: true } } },
        },
        employees: {
          select: { id: true, firstName: true, lastName: true, matricule: true },
          take: 1,
        },
        clientAssignments: { select: { firmId: true, clientId: true } },
      },
    }),
    db.firm.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        clients: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, status: true },
        },
      },
    }),
    // Only employees not already linked to an account can be linked to a new
    // one; `Employee.userId` is a single reference.
    db.employee.findMany({
      where: { userId: null },
      orderBy: [{ lastName: "asc" }],
      take: 500,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        matricule: true,
        firm: { select: { name: true } },
      },
    }),
  ])

  const rows: AdminUser[] = users.map((user) => {
    const employee = user.employees[0]
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      verified: user.emailVerified !== null,
      createdAt: user.createdAt,
      memberships: user.userFirms.map((membership) => ({
        firmId: membership.firmId,
        firmName: membership.firm.name,
        role: membership.role,
      })),
      linkedEmployee: employee
        ? {
            id: employee.id,
            label: `${employee.firstName} ${employee.lastName} (${employee.matricule})`,
          }
        : null,
    }
  })

  const assignments: AssignmentMap = {}
  for (const user of users) {
    const byFirm: Record<string, string[]> = {}
    for (const assignment of user.clientAssignments) {
      ;(byFirm[assignment.firmId] ??= []).push(assignment.clientId)
    }
    assignments[user.id] = byFirm
  }

  return (
    <>
      <AdminPageHeader
        title="Utilisateurs"
        description="Comptes, rôles et clients assignés."
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <UsersTable
            users={rows}
            assignments={assignments}
            firms={firms}
            employees={employees.map((employee) => ({
              id: employee.id,
              label: `${employee.firstName} ${employee.lastName} · ${employee.matricule} · ${employee.firm.name}`,
            }))}
            currentUserId={session?.user?.id ?? ""}
          />
        </div>
      </div>
    </>
  )
}

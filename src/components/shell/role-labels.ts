import type { FirmRole } from "@prisma/client"

/**
 * One French label per role, shared by the sidebar chip, the admin user table
 * and the user wizard — so a role cannot read "Personnel" in one place and
 * "Collaborateur" in another.
 */
export const ROLE_LABELS: Record<FirmRole, string> = {
  OWNER: "Propriétaire",
  ADMIN: "Administrateur",
  MANAGER: "Manager",
  RESPONSABLE: "Responsable client",
  STAFF: "Personnel",
  VIEWER: "Observateur",
}

/** Order used in pickers: most privileged first. */
export const ROLE_ORDER: FirmRole[] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "RESPONSABLE",
  "STAFF",
  "VIEWER",
]

export const ROLE_DESCRIPTIONS: Record<FirmRole, string> = {
  OWNER: "Accès total, y compris l'administration du groupe.",
  ADMIN: "Administration du groupe et de toutes les entreprises.",
  MANAGER: "Création et modification des employés, contrats et congés.",
  RESPONSABLE: "Accès limité aux clients qui lui sont assignés.",
  STAFF: "Consultation et saisie courante.",
  VIEWER: "Consultation seule.",
}

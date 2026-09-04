import "server-only"

import { PrismaClient } from "@prisma/client"

/**
 * The database is shared with the legacy application and its schema is frozen.
 * This client is read/write, but no migration is ever run from this project.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db
}

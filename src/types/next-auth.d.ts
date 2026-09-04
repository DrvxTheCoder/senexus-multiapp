import type { DefaultSession } from "next-auth"
import type { FirmMembership } from "@/types/auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      memberships: FirmMembership[]
      holdingIds: string[]
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    memberships?: FirmMembership[]
    holdingIds?: string[]
    /** Epoch ms of the last membership refresh. See MEMBERSHIP_TTL_MS. */
    membershipsAt?: number
  }
}

export {}

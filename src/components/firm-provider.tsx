"use client"

import * as React from "react"
import type { FirmRole } from "@prisma/client"


export type FirmContextValue = {
  id: string
  slug: string
  name: string
  logo: string | null
  /** Normalised hex, or null when the firm has no usable brand colour. */
  themeHex: string | null
  modules: string[]
  role: FirmRole
  /** Every firm the caller belongs to, for the firm switcher, with its mark. */
  memberships: {
    firmId: string
    firmSlug: string
    firmName: string
    role: string
    logo: string | null
    themeColor: string | null
  }[]
  user: { id: string; name: string | null; email: string }
}

const FirmContext = React.createContext<FirmContextValue | null>(null)

/**
 * §3.1 — the firm is resolved once, server-side, in the layout. This provider
 * only carries that already-resolved value down to the client components that
 * need it. It never fetches, and nothing looks a firm up by slug again.
 */
export function FirmProvider({
  value,
  children,
}: {
  value: FirmContextValue
  children: React.ReactNode
}) {
  return <FirmContext.Provider value={value}>{children}</FirmContext.Provider>
}

export function useFirm(): FirmContextValue {
  const value = React.useContext(FirmContext)
  if (!value) {
    throw new Error("useFirm must be used inside a FirmProvider.")
  }
  return value
}

/** Convenience for building links that stay inside the current firm. */
export function useFirmPath(): (path: string) => string {
  const { slug } = useFirm()
  return React.useCallback(
    (path: string) => `/${slug}${path.startsWith("/") ? path : `/${path}`}`,
    [slug]
  )
}

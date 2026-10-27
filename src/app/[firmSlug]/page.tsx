import { redirect } from "next/navigation"

import { firmHomeHref } from "@/lib/firm-home"
import { requireFirmPage } from "@/server/auth/firm-page"

export default async function FirmIndexPage({
  params,
}: PageProps<"/[firmSlug]">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug)
  redirect(firmHomeHref(ctx.firm))
}

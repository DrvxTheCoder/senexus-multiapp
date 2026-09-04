import { redirect } from "next/navigation"

export default async function FirmIndexPage({
  params,
}: PageProps<"/[firmSlug]">) {
  const { firmSlug } = await params
  redirect(`/${firmSlug}/dashboard`)
}

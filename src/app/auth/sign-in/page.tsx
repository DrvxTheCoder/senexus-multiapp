import type { Metadata } from "next"
import Image from "next/image"
import { redirect } from "next/navigation"

import { SignInForm } from "@/app/auth/sign-in/sign-in-form"
import { Card, CardContent } from "@/components/ui/card"
import { getSession } from "@/server/auth/require-firm-access"

export const metadata: Metadata = { title: "Connexion" }

/**
 * The sign-in screen.
 *
 * Two panels in one card: the form on the left, the group's cover on the right.
 * The cover is decorative — it carries the campaign line as burnt-in type, so
 * it is `alt=""` and hidden below `md`, where a 294KB portrait image would push
 * the form off a phone screen for nothing.
 */
export default async function SignInPage({
  searchParams,
}: PageProps<"/auth/sign-in">) {
  const { callbackUrl } = await searchParams
  const session = await getSession()

  if (session?.user) {
    redirect(typeof callbackUrl === "string" ? callbackUrl : "/")
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-paper p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
              <div className="w-full p-1 bg-muted/10 border rounded-2xl ">
                <Card className="overflow-hidden border-line p-0 shadow-none">
                {/* A floor on the height, so the cover has room to read as a
                    photograph rather than a letterbox crop of one. */}
                <CardContent className="grid p-0 md:min-h-120 md:grid-cols-2">
                  <div className="relative hidden bg-brand md:block"> 
                    <Image
                      src="/img/site-bg-cover.jpg"
                      alt=""
                      aria-hidden
                      fill
                      sizes="(min-width: 768px) 50vw, 0px"
                      priority
                      className="object-cover object-center"
                    />
                  </div>
                  <div className="flex flex-col justify-center p-6 md:p-10">
                    <SignInForm
                      callbackUrl={
                        typeof callbackUrl === "string" ? callbackUrl : undefined
                      }
                    />
                  </div>
                </CardContent>
              </Card>
              </div>

        <p className="mt-4 px-6 text-center text-[11.5px] leading-relaxed text-ink-3">
          Accès réservé aux collaborateurs du groupe. Toute connexion est
          enregistrée.
        </p>
      </div>
    </main>
  )
}

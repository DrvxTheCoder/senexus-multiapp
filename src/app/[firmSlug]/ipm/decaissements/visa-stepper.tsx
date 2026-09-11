"use client"

import { useRouter } from "next/navigation"

import { useAction } from "@/components/forms/use-action"
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format"
import { visaDisbursement } from "@/server/actions/ipm-disbursements"

export type VisaState = {
  id: string
  number: string
  approvedByName: string | null
  approvedAt: Date | null
  accountingByName: string | null
  accountingAt: Date | null
  receivedAt: Date | null
  status: string
}

/**
 * Les trois visas — plan §4.9.
 *
 * A stepper rather than three buttons, because the three visas are an ordered
 * sequence and the old rendering hid that: it showed whichever single button
 * happened to be next, so nobody could see where a bon stood or who had
 * already signed. Here all three are visible at once, with the name and the
 * date on each completed step.
 *
 * Only the next step is actionable. The server enforces the ordering anyway —
 * comptabilité refuses before direction, remise refuses before comptabilité —
 * but showing a button that is going to be refused is a worse interface than
 * not showing it.
 *
 * **VISA RÉCEPTION is different in kind** and the wording says so: the payee
 * signs the paper on collection. What this records is that the document was
 * handed over and when, not an approval by a user of this application.
 */
export function VisaStepper({
  firmSlug,
  disbursement,
  canWrite,
}: {
  firmSlug: string
  disbursement: VisaState
  canWrite: boolean
}) {
  const router = useRouter()
  const { run, pending } = useAction(visaDisbursement, {
    success: "Visa apposé.",
    onSuccess: () => router.refresh(),
  })

  const steps = [
    {
      step: 1,
      title: "Visa direction",
      who: disbursement.approvedByName,
      on: disbursement.approvedAt,
      visa: "DIRECTION" as const,
      cta: "Viser",
    },
    {
      step: 2,
      title: "Visa comptabilité",
      who: disbursement.accountingByName,
      on: disbursement.accountingAt,
      visa: "COMPTABILITE" as const,
      cta: "Viser",
    },
    {
      step: 3,
      title: "Remise au bénéficiaire",
      who: null,
      on: disbursement.receivedAt,
      visa: "RECEPTION" as const,
      cta: "Marquer remis",
    },
  ]

  const done = steps.filter((entry) => entry.on !== null).length
  const activeStep = Math.min(done + 1, steps.length)
  const cancelled = disbursement.status === "CANCELLED"

  return (
    <div className="space-y-3">
      <Stepper value={activeStep} orientation="horizontal">
        <StepperNav>
          {steps.map((entry, index) => (
            <StepperItem
              key={entry.step}
              step={entry.step}
              completed={entry.on !== null}
              disabled={cancelled}
            >
              <StepperTrigger>
                <StepperIndicator>{entry.step}</StepperIndicator>
                <div className="text-left">
                  <StepperTitle>{entry.title}</StepperTitle>
                  <span className="mt-px block text-[11.5px] text-ink-3">
                    {entry.on
                      ? [entry.who, formatDate(entry.on)]
                          .filter(Boolean)
                          .join(" · ")
                      : "En attente"}
                  </span>
                </div>
              </StepperTrigger>
              {index < steps.length - 1 ? <StepperSeparator /> : null}
            </StepperItem>
          ))}
        </StepperNav>
      </Stepper>

      {cancelled ? (
        <p className="text-[12.5px] text-ink-3">Ce bon est annulé.</p>
      ) : done === steps.length ? (
        <p className="text-[12.5px] text-ok">
          Bon entièrement visé et remis au bénéficiaire.
        </p>
      ) : canWrite ? (
        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              void run({
                firmSlug,
                disbursementId: disbursement.id,
                visa: steps[done].visa,
              })
            }
          >
            {steps[done].cta} — {steps[done].title.toLowerCase()}
          </Button>
          <span className="text-[11.5px] text-ink-3">
            {steps[done].visa === "RECEPTION"
              ? "Le bénéficiaire signe le bon papier à la remise ; cette action enregistre la date."
              : "Le visa est enregistré à votre nom, jamais au nom d'un tiers."}
          </span>
        </div>
      ) : null}
    </div>
  )
}

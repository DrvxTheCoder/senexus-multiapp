import type { Metadata } from "next"

import { formatRate } from "@/server/domain/ipm/rates"
import { RELATION_LABELS } from "@/server/domain/ipm/coverage"
import {
  verificationSecret,
  verifyToken,
} from "@/server/domain/ipm/verification-token"
import { verifyBeneficiary } from "@/server/queries/ipm/cards"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Vérification — IPM Tawfeikh",
  // A verification page has no business in a search index, and a QR that has
  // been photographed should not become a discoverable page.
  robots: { index: false, follow: false },
}

/**
 * Page publique de vérification — plan §6.
 *
 * Deliberately outside `/[firmSlug]`: a pharmacist at a counter has no
 * account and no firm. The token is the only credential, which is why it is
 * HMAC-signed and expires rather than being a matricule anyone could type.
 *
 * ## What this page does not show, and why
 *
 * §6 asks for "validité, nom, photo, ayants droit actifs, taux" here, and two
 * paragraphs earlier requires that the photo, the date of birth and the
 * matricule be served **only through an authenticated route**. Both cannot be
 * true of a page with no authentication.
 *
 * Resolved in favour of the security rule. No photo, no date of birth, no
 * address, no contact details: a face plus a birth date on an open URL is an
 * identity kit, and verification does not need one. What is shown is what
 * makes the check meaningful — is this card valid, whose is it, at what rate,
 * and is the person presenting it on it. Ayants droit appear by first name
 * only: enough to confirm the child at the counter, not enough to enumerate a
 * family from a scanned QR.
 *
 * This is a decision the institution can revisit. It should not be reversed by
 * accident, which is why it is written down here rather than implied.
 */
export default async function VerificationPage({
  params,
}: PageProps<"/v/[token]">) {
  const { token } = await params

  const verified = verifyToken(token, verificationSecret())

  if (!verified.valid) {
    return (
      <Shell>
        <Verdict ok={false} title="Code non valide" />
        <p className="mt-3 text-[13px] text-ink-3">
          {verified.reason === "EXPIRED"
            ? "Ce code a expiré. Demandez une carte à jour au participant."
            : "Ce code n'a pas été émis par l'IPM Tawfeikh, ou il a été altéré."}
        </p>
      </Shell>
    )
  }

  const result = await verifyBeneficiary(
    verified.payload.kind,
    verified.payload.id
  )

  if (!result) {
    return (
      <Shell>
        <Verdict ok={false} title="Bénéficiaire introuvable" />
        <p className="mt-3 text-[13px] text-ink-3">
          Cette carte ne correspond à aucun dossier actif.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <Verdict
        ok={result.valid}
        title={result.valid ? "Couverture valide" : "Couverture non valide"}
      />

      {!result.valid && result.reason ? (
        <p className="mt-3 text-[13px] text-ink-3">{result.reason}</p>
      ) : null}

      <dl className="mt-5 space-y-3 text-[13px]">
        <Row label="Titulaire" value={result.holderName} />
        <Row
          label="Qualité"
          value={
            result.quality === "MEMBER"
              ? "Participant"
              : (RELATION_LABELS[
                  result.quality as keyof typeof RELATION_LABELS
                ] ?? result.quality)
          }
        />
        <Row label="Matricule" value={result.matricule} mono />
        <Row label="Employeur" value={result.employerName} />
        <Row label="Formule" value={result.planLabel} />
      </dl>

      {result.valid && result.rates.length ? (
        <section className="mt-5">
          <h2 className="text-[11.5px] tracking-wide text-ink-3 uppercase">
            Taux de prise en charge
          </h2>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {result.rates.map((rate) => (
              <li key={rate.category} className="flex justify-between">
                <span className="text-ink-3">{rate.category}</span>
                <span className="font-medium tabular-nums">
                  {formatRate(rate.rate)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.valid && result.dependentFirstNames.length ? (
        <section className="mt-5">
          <h2 className="text-[11.5px] tracking-wide text-ink-3 uppercase">
            Ayants droit couverts
          </h2>
          {/* First names only. Enough to confirm the person at the counter is
              on the card; not a family directory for whoever scans the QR. */}
          <p className="mt-2 text-[13px]">
            {result.dependentFirstNames.join(" · ")}
          </p>
        </section>
      ) : null}

      <p className="mt-6 border-t border-line pt-3 text-[11.5px] text-ink-3">
        Vérifié le{" "}
        {result.checkedAt.toLocaleString("fr-FR", {
          dateStyle: "long",
          timeStyle: "short",
        })}
        . Cette page ne communique ni photo ni date de naissance.
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <div className="rounded-panel border border-line bg-surface p-6">
        <p className="text-[11.5px] font-semibold tracking-wide text-brand uppercase">
          IPM Tawfeikh
        </p>
        {children}
      </div>
    </main>
  )
}

function Verdict({ ok, title }: { ok: boolean; title: string }) {
  return (
    <div className="mt-3 flex items-center gap-2.5">
      <span
        aria-hidden
        className={`grid size-8 shrink-0 place-items-center rounded-full text-[15px] font-semibold ${
          ok ? "bg-ok/15 text-ok" : "bg-alert/15 text-alert"
        }`}
      >
        {ok ? "✓" : "!"}
      </span>
      <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.018em]">
        {title}
      </h1>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-3">{label}</dt>
      <dd className={`text-right font-medium ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  )
}

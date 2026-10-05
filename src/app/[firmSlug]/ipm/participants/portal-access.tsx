"use client"

import * as React from "react"
import Link from "next/link"

import { useAction } from "@/components/forms/use-action"
import { Panel } from "@/components/panel"
import { StatusPill } from "@/components/primitives"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDate, formatDateTime, formatNumber } from "@/lib/format"
import {
  MEMBER_PORTAL_LABELS,
  MEMBER_PORTAL_TONES,
  type MemberQuery,
} from "@/lib/queries/ipm/member-query"
import {
  grantPortalAccessBulk,
  grantPortalAccessOne,
  issuePortalAccessCode,
  restorePortalAccess,
  suspendPortalAccess,
} from "@/server/actions/ipm-portal-access"
import type { PortalGrantResult } from "@/server/ipm/portal-access"
import type { MemberRecord } from "@/server/queries/ipm/member-record"
import type { AccessRequestRow } from "@/server/queries/ipm/members"

/**
 * Accès au portail participant — the list's bulk dialog and the fiche's panel.
 * The rules (actif, numéro valide, un numéro par participant) live in
 * `grantPortalAccess`; this side only says what happened.
 */

export type PortalSelection =
  | { memberIds: string[] }
  | {
      matching: Pick<
        MemberQuery,
        "search" | "status" | "employerId" | "withDependents" | "portal"
      >
      excludeIds: string[]
    }

/** Already open is not a problem to fix: counted, not listed. */
const ALREADY = new Set(["ALREADY_INVITED", "ALREADY_ACTIVE"])

export function BulkPortalAccessDialog({
  firmSlug,
  count,
  selection,
  onClose,
  onDone,
}: {
  firmSlug: string
  count: number
  selection: PortalSelection
  onClose: () => void
  /** Called once accounts were written, so the list can drop its selection. */
  onDone: () => void
}) {
  const [result, setResult] = React.useState<PortalGrantResult | null>(null)

  const grant = useAction(grantPortalAccessBulk, {
    loading: "Ouverture des accès…",
    success: (data) =>
      `${formatNumber(data.granted.length)} accès ouvert${data.granted.length > 1 ? "s" : ""}.`,
    onSuccess: (data) => {
      setResult(data)
      onDone()
    },
  })

  const plural = count > 1 ? "s" : ""
  const already =
    result?.skipped.filter((entry) => ALREADY.has(entry.reason)) ?? []
  const problems =
    result?.skipped.filter((entry) => !ALREADY.has(entry.reason)) ?? []

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(620px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            Ouvrir le portail à {formatNumber(count)} participant{plural}
          </DialogTitle>
          <DialogDescription>
            Chaque participant reçoit un accès « Invité » et se connecte avec le
            numéro de téléphone de sa fiche. Seuls les participants actifs, avec
            un numéro valide qui n&apos;appartient à aucun autre participant,
            sont retenus ; les autres sont écartés et listés ici.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="rounded-md bg-ok-tint px-2.5 py-1.5 text-[12.5px] text-ok">
              {formatNumber(result.granted.length)} accès ouvert
              {result.granted.length > 1 ? "s" : ""}.
            </p>
            {already.length > 0 ? (
              <p className="rounded-md bg-sub px-2.5 py-1.5 text-[12.5px] text-ink-2">
                {formatNumber(already.length)} avai
                {already.length > 1 ? "ent" : "t"} déjà un accès.
              </p>
            ) : null}
            {problems.length > 0 ? (
              <div className="rounded-md border border-line">
                <p className="border-b border-line bg-signal-tint px-2.5 py-1.5 text-[12.5px] text-signal">
                  {formatNumber(problems.length)} écarté
                  {problems.length > 1 ? "s" : ""} :
                </p>
                <ul className="max-h-64 divide-y divide-line overflow-y-auto text-[12.5px]">
                  {problems.map((entry) => (
                    <li
                      key={entry.memberId}
                      className="flex gap-3 px-2.5 py-1.5"
                    >
                      <span className="w-44 shrink-0 truncate">
                        {entry.name}{" "}
                        <span className="text-ink-3">{entry.matricule}</span>
                      </span>
                      <span className="text-ink-2">{entry.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <DialogFooter>
              <Button onClick={onClose}>Fermer</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {grant.error ? (
              <p className="rounded-md bg-alert-tint px-2.5 py-1.5 text-[12.5px] text-alert">
                {grant.error}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button
                disabled={grant.pending}
                onClick={() => grant.run({ firmSlug, ...selection })}
              >
                {grant.pending ? "Ouverture…" : "Ouvrir l'accès"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function PortalAccessPanel({
  firmSlug,
  record,
  canWrite,
}: {
  firmSlug: string
  record: MemberRecord
  canWrite: boolean
}) {
  const scope = { firmSlug, memberId: record.id }
  const { portal } = record
  const [issuing, setIssuing] = React.useState(false)

  const grant = useAction(grantPortalAccessOne, {
    success: "Accès au portail ouvert.",
  })
  const suspend = useAction(suspendPortalAccess, {
    success: "Accès au portail suspendu.",
  })
  const restore = useAction(restorePortalAccess, {
    success: "Accès au portail rétabli.",
  })

  const tools = !canWrite ? null : !portal ? (
    <Button size="sm" disabled={grant.pending} onClick={() => grant.run(scope)}>
      Ouvrir l&apos;accès
    </Button>
  ) : portal.status === "LOCKED" ? (
    <Button
      size="sm"
      variant="outline"
      disabled={restore.pending}
      onClick={() => restore.run(scope)}
    >
      Rétablir l&apos;accès
    </Button>
  ) : (
    <>
      <Button
        size="sm"
        variant={portal.accessRequestedAt ? "default" : "outline"}
        onClick={() => setIssuing(true)}
      >
        Générer un code d&apos;accès
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-alert"
        disabled={suspend.pending}
        onClick={() => suspend.run(scope)}
      >
        Suspendre l&apos;accès
      </Button>
    </>
  )

  return (
    <>
      <Panel
        titleAs="h2"
        title={
          <span className="flex items-center gap-2.5">
            Portail participant
            <StatusPill tone={MEMBER_PORTAL_TONES[portal?.status ?? "NONE"]}>
              {MEMBER_PORTAL_LABELS[portal?.status ?? "NONE"]}
            </StatusPill>
          </span>
        }
        description={
          portal
            ? undefined
            : record.person.phone
              ? `Pas encore d'accès. Le participant se connectera avec le ${record.person.phone}.`
              : "Pas encore d'accès, et aucun numéro de téléphone sur la fiche : ajoutez-en un d'abord."
        }
        tools={tools}
        // Without an account the header says it all; an empty padded body would
        // only add a strip of blank panel.
        padded={portal !== null}
      >
        {portal ? (
          <div className="space-y-2.5">
            {portal.accessRequestedAt ? (
              <p className="rounded-md bg-signal-tint px-2.5 py-1.5 text-[12.5px] text-signal">
                Le participant n&apos;arrive pas à se connecter et demande un
                code d&apos;accès depuis le{" "}
                {formatDateTime(portal.accessRequestedAt)}.
              </p>
            ) : null}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-5">
              <PortalFact label="Identifiant">{portal.phone}</PortalFact>
              <PortalFact label="Accès ouvert le">
                {formatDate(portal.invitedAt)}
              </PortalFact>
              <PortalFact label="Première connexion">
                {portal.activatedAt ? formatDate(portal.activatedAt) : "Jamais"}
              </PortalFact>
              <PortalFact label="Dernière connexion">
                {formatDate(portal.lastLoginAt)}
              </PortalFact>
              <PortalFact label="Code d'accès">
                {portal.accessCodeExpiresAt
                  ? `Valable jusqu'au ${formatDateTime(portal.accessCodeExpiresAt)}`
                  : "Aucun"}
              </PortalFact>
            </dl>
          </div>
        ) : null}
      </Panel>

      {issuing && portal ? (
        <AccessCodeDialog
          firmSlug={firmSlug}
          memberId={record.id}
          name={`${record.person.lastName.toUpperCase()} ${record.person.firstName}`}
          replacesCode={portal.accessCodeExpiresAt !== null}
          onClose={() => setIssuing(false)}
        />
      ) : null}
    </>
  )
}

/**
 * Issues a code and shows it — once. Nothing stores it in clear, so closing
 * this dialog is the last time anyone sees it; a lost code is replaced, not
 * recovered.
 */
export function AccessCodeDialog({
  firmSlug,
  memberId,
  name,
  replacesCode,
  onClose,
}: {
  firmSlug: string
  memberId: string
  name: string
  replacesCode: boolean
  onClose: () => void
}) {
  const [issued, setIssued] = React.useState<{
    code: string
    phone: string
    expiresAt: Date
  } | null>(null)
  const [copied, setCopied] = React.useState(false)

  const issue = useAction(issuePortalAccessCode, {
    success: "Code d'accès généré.",
    onSuccess: setIssued,
  })

  const copy = async () => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.code)
      setCopied(true)
    } catch {
      // Clipboard refused (insecure origin, permissions): the code is on screen.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(480px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Code d&apos;accès — {name}</DialogTitle>
          <DialogDescription>
            Un code à usage unique, valable 24 heures, que le participant saisit
            sur le portail à la place du code reçu par SMS. Communiquez-le-lui
            directement, par téléphone ou au guichet.
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-sub px-3 py-2.5">
              <span className="font-mono text-[26px] font-semibold tracking-[0.3em] tabular-nums">
                {issued.code.slice(0, 3)} {issued.code.slice(3)}
              </span>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? "Copié" : "Copier"}
              </Button>
            </div>
            <p className="text-[12.5px] text-ink-2">
              Identifiant : <b className="tabular-nums">{issued.phone}</b> ·
              valable jusqu&apos;au {formatDateTime(issued.expiresAt)}. Ce code
              ne sera plus affiché après fermeture.
            </p>
            <DialogFooter>
              <Button onClick={onClose}>Fermer</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {replacesCode ? (
              <p className="rounded-md bg-signal-tint px-2.5 py-1.5 text-[12.5px] text-signal">
                Un code est déjà en cours de validité : le nouveau le remplace.
              </p>
            ) : null}
            {issue.error ? (
              <p className="rounded-md bg-alert-tint px-2.5 py-1.5 text-[12.5px] text-alert">
                {issue.error}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button
                disabled={issue.pending}
                onClick={() => issue.run({ firmSlug, memberId })}
              >
                {issue.pending ? "Génération…" : "Générer le code"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The participants who asked for a code from the login screen. Above the list,
 * and only when there is someone waiting: a request is a person stuck at the
 * counter or at home, not a statistic.
 */
export function AccessRequestsPanel({
  firmSlug,
  requests,
  canWrite,
}: {
  firmSlug: string
  requests: AccessRequestRow[]
  canWrite: boolean
}) {
  const [answering, setAnswering] = React.useState<AccessRequestRow | null>(
    null
  )
  if (requests.length === 0) return null

  return (
    <>
      <Panel
        title={`Demandes de code d'accès · ${requests.length}`}
        description="Ces participants n'arrivent pas à se connecter au portail. Générez un code et communiquez-le-leur."
        padded={false}
        className="mb-3.5"
      >
        <ul className="divide-y divide-line border-t border-line text-[13px]">
          {requests.map((request) => (
            <li
              key={request.memberId}
              className="flex items-center gap-3 px-3.75 py-2"
            >
              <Link
                href={`/${firmSlug}/ipm/participants/${request.memberId}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {request.lastName.toUpperCase()} {request.firstName}{" "}
                <span className="text-ink-3">{request.matricule}</span>
              </Link>
              <span className="text-ink-2 tabular-nums">{request.phone}</span>
              <span className="w-40 text-right text-ink-3 tabular-nums">
                {formatDateTime(request.requestedAt)}
              </span>
              {canWrite ? (
                <Button size="sm" onClick={() => setAnswering(request)}>
                  Générer un code
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>

      {answering ? (
        <AccessCodeDialog
          firmSlug={firmSlug}
          memberId={answering.memberId}
          name={`${answering.lastName.toUpperCase()} ${answering.firstName}`}
          replacesCode={false}
          onClose={() => setAnswering(null)}
        />
      ) : null}
    </>
  )
}

function PortalFact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="mt-px truncate tabular-nums">{children}</dd>
    </div>
  )
}

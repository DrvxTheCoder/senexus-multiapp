"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { TextControl } from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import { useAction } from "@/components/forms/use-action"
import { useActionForm } from "@/components/forms/use-action-form"
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
import { formatDate, formatDateTime } from "@/lib/format"
import { providerCredentialsSchema } from "@/lib/forms/ipm-schemas"
import {
  createProviderCredentials,
  resetProviderPassword,
  setProviderAccountActive,
} from "@/server/actions/ipm-pharmacy"
import type { ProviderAccessRecord } from "@/server/queries/ipm/providers"

/**
 * Accès prestataire au portail — one login per pharmacy: its code
 * prestataire and a password. The gestionnaire creates it, resets it and
 * switches it off; there is no self-service reset. A new or reset password is
 * temporary, shown once, and must be changed at the first login.
 */

type Issued = { username: string; temporaryPassword: string }

export function ProviderAccessPanel({
  firmSlug,
  record,
  canWrite,
}: {
  firmSlug: string
  record: ProviderAccessRecord
  canWrite: boolean
}) {
  const scope = { firmSlug, providerId: record.id }
  const { account } = record
  const [creating, setCreating] = React.useState(false)
  const [confirmReset, setConfirmReset] = React.useState(false)
  const [issued, setIssued] = React.useState<Issued | null>(null)

  const reset = useAction(resetProviderPassword, {
    success: "Mot de passe réinitialisé.",
    onSuccess: (data) => {
      setConfirmReset(false)
      setIssued(data)
    },
  })
  const toggle = useAction(setProviderAccountActive, {
    success: (data) => (data.active ? "Accès réactivé." : "Accès désactivé."),
  })

  const locked = account?.lockedUntil && new Date(account.lockedUntil) > new Date()
  const state = !account
    ? { label: "Aucun accès", tone: "muted" as const }
    : !account.isActive
      ? { label: "Désactivé", tone: "muted" as const }
      : locked
        ? { label: "Verrouillé", tone: "alert" as const }
        : account.mustChangePassword
          ? { label: "Mot de passe provisoire", tone: "signal" as const }
          : { label: "Actif", tone: "ok" as const }

  const tools = !canWrite ? null : !account ? (
    <Button size="sm" onClick={() => setCreating(true)}>
      Créer l&apos;accès
    </Button>
  ) : (
    <>
      <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)}>
        Réinitialiser le mot de passe
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={account.isActive ? "text-alert" : undefined}
        disabled={toggle.pending}
        onClick={() => toggle.run({ ...scope, active: !account.isActive })}
      >
        {account.isActive ? "Désactiver" : "Réactiver"}
      </Button>
    </>
  )

  return (
    <>
      <Panel
        titleAs="h2"
        title={
          <span className="flex items-center gap-2.5">
            Accès au portail prestataire
            <StatusPill tone={state.tone}>{state.label}</StatusPill>
          </span>
        }
        description={
          account
            ? "La pharmacie scanne le QR du bon, saisit le montant global et valide."
            : "Sans accès, la pharmacie ne peut pas valider les bons : saisissez alors les montants depuis la liste des bons."
        }
        tools={tools}
        padded={account !== null}
      >
        {account ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-4">
            <Fact label="Code prestataire">
              <span className="mono">{account.username}</span>
            </Fact>
            <Fact label="Accès créé le">{formatDate(account.createdAt)}</Fact>
            <Fact label="Dernière connexion">
              {account.lastLoginAt ? formatDateTime(account.lastLoginAt) : "Jamais"}
            </Fact>
            <Fact label="Verrouillage">
              {locked ? `Jusqu'à ${formatDateTime(account.lockedUntil!)}` : "Aucun"}
            </Fact>
          </dl>
        ) : null}
      </Panel>

      {creating ? (
        <CreateAccessDialog
          firmSlug={firmSlug}
          providerId={record.id}
          defaultCode={record.legacyCode ?? ""}
          onClose={() => setCreating(false)}
          onIssued={(data) => {
            setCreating(false)
            setIssued(data)
          }}
        />
      ) : null}

      {confirmReset && account ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmReset(false)}>
          <DialogContent className="w-[min(480px,calc(100%-2rem))] max-w-none sm:max-w-none">
            <DialogHeader>
              <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
              <DialogDescription>
                Un mot de passe provisoire remplace l&apos;actuel. Les sessions ouvertes
                de la pharmacie sont fermées et le verrouillage est levé.
              </DialogDescription>
            </DialogHeader>
            {reset.error ? <FormMessage>{reset.error}</FormMessage> : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmReset(false)}>
                Annuler
              </Button>
              <Button disabled={reset.pending} onClick={() => reset.run(scope)}>
                {reset.pending ? "Réinitialisation…" : "Réinitialiser"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {issued ? (
        <TemporaryPasswordDialog issued={issued} onClose={() => setIssued(null)} />
      ) : null}
    </>
  )
}

function CreateAccessDialog({
  firmSlug,
  providerId,
  defaultCode,
  onClose,
  onIssued,
}: {
  firmSlug: string
  providerId: string
  defaultCode: string
  onClose: () => void
  onIssued: (issued: Issued) => void
}) {
  const form = useForm({
    resolver: zodResolver(providerCredentialsSchema) as never,
    defaultValues: { firmSlug, providerId, code: defaultCode } as never,
  })
  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      createProviderCredentials(values as never)) as never,
    { success: "Accès créé.", onSuccess: (data) => onIssued(data as Issued) }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(480px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Créer l&apos;accès au portail</DialogTitle>
          <DialogDescription>
            La pharmacie se connecte avec son code prestataire et un mot de passe provisoire,
            qu&apos;elle devra changer à la première connexion.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <TextControl
            form={form}
            name={"code" as never}
            label="Code prestataire"
            required
            mono
            hint="Unique. Saisi en majuscules à la connexion."
          />
          <FormMessage tone={tone}>{message}</FormMessage>
          <DialogFooter>
            <SubmitButton pending={pending}>Créer l&apos;accès</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The password, shown once. Only its hash is stored, so closing this dialog is
 * the last time anyone sees it; a lost one is reset, not recovered.
 */
function TemporaryPasswordDialog({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.temporaryPassword)
      setCopied(true)
    } catch {
      // Clipboard refused: the password is on screen.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(480px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Mot de passe provisoire</DialogTitle>
          <DialogDescription>
            Transmettez-le à la pharmacie. Il ne sera plus affiché : en cas de perte,
            réinitialisez-le.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-ink-3">Code prestataire</dt>
            <dd className="mono">{issued.username}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink-3">Mot de passe</dt>
            <dd className="mono rounded-md bg-sub px-2 py-1 text-[15px] tracking-wide">
              {issued.temporaryPassword}
            </dd>
          </div>
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            {copied ? "Copié" : "Copier"}
          </Button>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="mt-px truncate">{children}</dd>
    </div>
  )
}

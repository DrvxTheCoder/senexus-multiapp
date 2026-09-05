"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  KeyIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"

import type {
  AdminFirmOption,
  AdminUser,
  AssignmentMap,
} from "@/app/admin/users/page"
import {
  Field,
  FormMessage,
  SubmitButton,
  fieldProps,
  inputClass,
  selectClass,
} from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import { Panel } from "@/components/panel"
import { Avatar, EmptyState, StatusPill } from "@/components/primitives"
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER } from "@/components/shell/role-labels"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  clientAssignmentFormSchema,
  createUserSchema,
  passwordPairSchema,
  userBaseSchema,
  type PasswordPairInput,
} from "@/lib/forms/admin-schemas"
import { formatDateProse, formatNumber, initials } from "@/lib/format"
import {
  createUser,
  deleteUser,
  resetUserPassword,
  setClientAssignments,
  updateUser,
} from "@/server/actions/admin"

type Dialogs =
  | { kind: "create" }
  | { kind: "edit"; user: AdminUser }
  | { kind: "password"; user: AdminUser }
  | { kind: "clients"; user: AdminUser }
  | { kind: "delete"; user: AdminUser }
  | null

export function UsersTable({
  users,
  assignments,
  firms,
  employees,
  currentUserId,
}: {
  users: AdminUser[]
  assignments: AssignmentMap
  firms: AdminFirmOption[]
  employees: { id: string; label: string }[]
  currentUserId: string
}) {
  const [dialog, setDialog] = React.useState<Dialogs>(null)

  return (
    <>
      <Panel
        title="Comptes"
        description="Un rôle par utilisateur, appliqué à toutes ses entreprises."
        stats={[{ label: "Utilisateurs", value: formatNumber(users.length) }]}
        tools={
          <button
            type="button"
            onClick={() => setDialog({ kind: "create" })}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} />
            Ajouter un utilisateur
          </button>
        }
        padded={false}
        footer={{
          summary:
            "Les rôles Propriétaire et Administrateur donnent accès à toutes les entreprises et à cette console.",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {["Utilisateur", "Rôle", "Entreprises", "Employé lié", "Créé le", ""].map(
                  (header, index) => (
                    <th
                      key={header || index}
                      scope="col"
                      className="h-[33px] border-y border-line bg-sub px-2.5 text-left text-[11.5px] font-medium whitespace-nowrap text-ink-3 first:pl-[15px] last:pr-[15px]"
                    >
                      {header}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const role = user.memberships[0]?.role
                const scoped = role === "RESPONSABLE"
                const assignedCount = Object.values(
                  assignments[user.id] ?? {}
                ).reduce((sum, ids) => sum + ids.length, 0)

                return (
                  <tr key={user.id} className="hover:bg-brand-wash">
                    <td className="h-row border-b border-line px-2.5 pl-[15px]">
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={initials(user.name ?? user.email)} />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium">
                            {user.name ?? "—"}
                            {user.id === currentUserId ? (
                              <span className="ml-1.5 text-[11px] font-normal text-ink-3">
                                (vous)
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate text-[11.5px] text-ink-3">
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="h-row border-b border-line px-2.5">
                      {role ? (
                        <StatusPill tone={scoped ? "signal" : "muted"}>
                          {ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}
                        </StatusPill>
                      ) : (
                        <span className="text-[12px] text-ink-3">aucun</span>
                      )}
                    </td>
                    <td className="h-row border-b border-line px-2.5 text-[12.5px] text-ink-2">
                      {user.memberships.length === 0 ? (
                        <span className="text-signal">aucune</span>
                      ) : user.memberships.length === firms.length ? (
                        "toutes"
                      ) : (
                        user.memberships.map((m) => m.firmName).join(", ")
                      )}
                      {scoped ? (
                        <div className="text-[11px] text-ink-3">
                          {assignedCount === 0
                            ? "aucun client assigné — ne voit rien"
                            : `${formatNumber(assignedCount)} client${assignedCount > 1 ? "s" : ""} assigné${assignedCount > 1 ? "s" : ""}`}
                        </div>
                      ) : null}
                    </td>
                    <td className="h-row border-b border-line px-2.5 text-[12.5px] text-ink-2">
                      {user.linkedEmployee?.label ?? "—"}
                    </td>
                    <td className="h-row border-b border-line px-2.5 text-[12.5px] text-ink-2">
                      {formatDateProse(user.createdAt)}
                    </td>
                    <td className="h-row border-b border-line px-2.5 pr-[15px]">
                      <span className="flex justify-end gap-1">
                        <IconButton
                          label={`Modifier ${user.email}`}
                          icon={PencilEdit02Icon}
                          onClick={() => setDialog({ kind: "edit", user })}
                        />
                        <IconButton
                          label={`Réinitialiser le mot de passe de ${user.email}`}
                          icon={KeyIcon}
                          onClick={() => setDialog({ kind: "password", user })}
                        />
                        {user.memberships.length > 0 ? (
                          <IconButton
                            label={`Clients assignés à ${user.email}`}
                            icon={UserGroupIcon}
                            onClick={() => setDialog({ kind: "clients", user })}
                          />
                        ) : null}
                        <IconButton
                          label={`Supprimer ${user.email}`}
                          icon={Delete02Icon}
                          destructive
                          disabled={user.id === currentUserId}
                          onClick={() => setDialog({ kind: "delete", user })}
                        />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <UserWizard
          key={dialog.kind === "edit" ? dialog.user.id : "create"}
          user={dialog.kind === "edit" ? dialog.user : null}
          firms={firms}
          employees={employees}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "password" ? (
        <ResetPasswordDialog
          key={dialog.user.id}
          user={dialog.user}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "clients" ? (
        <ClientAssignmentsDialog
          key={dialog.user.id}
          user={dialog.user}
          firms={firms}
          assigned={assignments[dialog.user.id] ?? {}}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <DeleteUserDialog
          key={dialog.user.id}
          user={dialog.user}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function IconButton({
  label,
  icon,
  onClick,
  destructive,
  disabled,
}: {
  label: string
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"]
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={`rounded-md p-1.5 text-ink-3 hover:bg-sunken disabled:opacity-30 disabled:hover:bg-transparent ${
        destructive ? "hover:text-alert" : "hover:text-ink"
      }`}
    >
      <HugeiconsIcon icon={icon} size={15} />
    </button>
  )
}

/* ==========================================================================
 * The wizard
 * ========================================================================== */

type WizardValues = {
  name: string
  email: string
  image?: string
  role: (typeof ROLE_ORDER)[number]
  firmIds: string[]
  employeeId?: string
  password?: string
  confirmPassword?: string
}

/**
 * Two steps, as in the legacy console: who the person is, then what they can
 * reach. Split because the second step is where the consequential choices are
 * and they deserve their own screen.
 */
function UserWizard({
  user,
  firms,
  employees,
  onClose,
}: {
  user: AdminUser | null
  firms: AdminFirmOption[]
  employees: { id: string; label: string }[]
  onClose: () => void
}) {
  const router = useRouter()
  const isEdit = user !== null
  const [step, setStep] = React.useState(1)

  const form = useForm<WizardValues>({
    resolver: zodResolver(
      // `updateUserSchema` is `userBaseSchema` plus an id the wizard does not
      // collect; creation adds the password pair.
      isEdit ? userBaseSchema : createUserSchema
    ),
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      image: user?.image ?? "",
      role: (user?.memberships[0]?.role as WizardValues["role"]) ?? "STAFF",
      firmIds: user?.memberships.map((m) => m.firmId) ?? [],
      employeeId: user?.linkedEmployee?.id ?? "",
      password: "",
      confirmPassword: "",
    },
  })

  const role = form.watch("role")
  const firmIds = form.watch("firmIds") ?? []

  // OWNER and ADMIN are members of every firm — the console is cross-tenant, so
  // partial membership would be a lie. The legacy form did this silently in an
  // effect; here it is stated, and the checkboxes are replaced by an
  // explanation rather than left enabled but ignored.
  const allFirms = role === "OWNER" || role === "ADMIN"

  const { submit, pending, message, tone } = useActionForm<WizardValues, void>(
    form,
    async (values) => {
      const payload = {
        ...values,
        firmIds: allFirms ? firms.map((firm) => firm.id) : values.firmIds,
        employeeId: values.employeeId || undefined,
        image: values.image || undefined,
      }
      const result = isEdit
        ? await updateUser({ ...payload, id: user.id })
        : await createUser(payload as Required<WizardValues>)
      return result.ok ? { ok: true, data: undefined } : result
    },
    {
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  async function next() {
    const valid = await form.trigger(["name", "email"])
    if (valid) setStep(2)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier l'utilisateur" : "Ajouter un utilisateur"}
          </DialogTitle>
          <DialogDescription>
            Étape {step} sur 2 —{" "}
            {step === 1 ? "détails personnels" : "accès et rôle"}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex gap-2 border-y border-line py-2.5 text-[12.5px]">
          {["Détails personnels", "Administration"].map((label, index) => {
            const number = index + 1
            const active = step === number
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={`grid size-5 place-items-center rounded-full text-[11px] font-medium ${
                    active
                      ? "bg-ink text-paper"
                      : step > number
                        ? "bg-ok-tint text-ok"
                        : "bg-sunken text-ink-3"
                  }`}
                >
                  {number}
                </span>
                <span className={active ? "font-medium" : "text-ink-3"}>
                  {label}
                </span>
                {index === 0 ? (
                  <span aria-hidden className="mx-1 text-ink-3">
                    ·
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>

        <form onSubmit={submit} className="space-y-3">
          {step === 1 ? (
            <>
              <Field
                label="Nom"
                htmlFor="name"
                required
                error={form.formState.errors.name?.message}
              >
                <input
                  {...fieldProps("name", form.formState.errors.name?.message)}
                  {...form.register("name")}
                  className={inputClass}
                  placeholder="Jean Dupont"
                  autoFocus
                />
              </Field>

              <Field
                label="Email"
                htmlFor="email"
                required
                hint="Sert d'identifiant de connexion."
                error={form.formState.errors.email?.message}
              >
                <input
                  type="email"
                  {...fieldProps("email", form.formState.errors.email?.message)}
                  {...form.register("email")}
                  className={inputClass}
                  placeholder="jean.dupont@senexus.app"
                />
              </Field>

              <Field
                label="Photo"
                htmlFor="image"
                hint="URL d'une image déjà hébergée."
                error={form.formState.errors.image?.message}
              >
                <input
                  {...fieldProps("image", form.formState.errors.image?.message)}
                  {...form.register("image")}
                  className={inputClass}
                  placeholder="https://…"
                />
              </Field>
            </>
          ) : (
            <>
              <Field
                label="Rôle"
                htmlFor="role"
                required
                hint={ROLE_DESCRIPTIONS[role]}
                error={form.formState.errors.role?.message}
              >
                <select
                  {...fieldProps("role", form.formState.errors.role?.message)}
                  {...form.register("role")}
                  className={selectClass}
                >
                  {ROLE_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Entreprises"
                htmlFor="firmIds"
                required
                error={form.formState.errors.firmIds?.message}
              >
                {allFirms ? (
                  <p className="rounded-md bg-sub px-2.5 py-2 text-[12.5px] text-ink-2">
                    Ce rôle donne accès à <b>toutes les entreprises</b> ainsi
                    qu&apos;à la console d&apos;administration.
                  </p>
                ) : (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-[7px] border border-line p-2">
                    {firms.map((firm) => (
                      <label
                        key={firm.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-sub"
                      >
                        <input
                          type="checkbox"
                          value={firm.id}
                          checked={firmIds.includes(firm.id)}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...firmIds, firm.id]
                              : firmIds.filter((id) => id !== firm.id)
                            form.setValue("firmIds", next, {
                              shouldValidate: true,
                            })
                          }}
                          className="size-3.5 accent-[var(--sx-brand)]"
                        />
                        {firm.name}
                      </label>
                    ))}
                  </div>
                )}
              </Field>

              {role === "RESPONSABLE" ? (
                <p className="rounded-md bg-signal-tint px-2.5 py-2 text-[12.5px] text-signal">
                  Un responsable ne voit que les clients qui lui sont assignés.
                  Après création, utilisez l&apos;icône « clients assignés » —
                  sans assignation, il ne verra rien.
                </p>
              ) : null}

              <Field
                label="Employé lié"
                htmlFor="employeeId"
                hint="Rattache ce compte à une fiche employé existante."
              >
                <select
                  {...fieldProps("employeeId")}
                  {...form.register("employeeId")}
                  className={selectClass}
                >
                  <option value="">Aucun</option>
                  {user?.linkedEmployee ? (
                    <option value={user.linkedEmployee.id}>
                      {user.linkedEmployee.label}
                    </option>
                  ) : null}
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.label}
                    </option>
                  ))}
                </select>
              </Field>

              {!isEdit ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Mot de passe"
                    htmlFor="password"
                    required
                    hint="Au moins 8 caractères."
                    error={form.formState.errors.password?.message}
                  >
                    <input
                      type="password"
                      autoComplete="new-password"
                      {...fieldProps(
                        "password",
                        form.formState.errors.password?.message
                      )}
                      {...form.register("password")}
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label="Confirmer"
                    htmlFor="confirmPassword"
                    required
                    error={form.formState.errors.confirmPassword?.message}
                  >
                    <input
                      type="password"
                      autoComplete="new-password"
                      {...fieldProps(
                        "confirmPassword",
                        form.formState.errors.confirmPassword?.message
                      )}
                      {...form.register("confirmPassword")}
                      className={inputClass}
                    />
                  </Field>
                </div>
              ) : null}
            </>
          )}

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            {step === 2 ? (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="mr-auto h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
              >
                Précédent
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              Annuler
            </button>
            {step === 1 ? (
              <button
                type="button"
                onClick={next}
                className="h-9 rounded-[7px] bg-ink px-3 text-[13px] font-medium text-paper hover:opacity-90"
              >
                Suivant
              </button>
            ) : (
              <SubmitButton pending={pending}>
                {isEdit ? "Enregistrer" : "Créer"}
              </SubmitButton>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ==========================================================================
 * Password reset
 * ========================================================================== */

function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: AdminUser
  onClose: () => void
}) {
  // `resetPasswordSchema` carries the id the action needs and a refinement;
  // zod refuses `.omit()` on a refined object, so the dialog parses the pair
  // schema built from the same field and the same refinement.
  const form = useForm<PasswordPairInput>({
    resolver: zodResolver(passwordPairSchema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    async (values) => resetUserPassword({ ...values, id: user.id }),
    { success: "Mot de passe réinitialisé." }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
          <DialogDescription>
            Pour {user.name ?? user.email}. Communiquez-le par un canal sûr.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <Field
            label="Nouveau mot de passe"
            htmlFor="password"
            required
            hint="Au moins 8 caractères."
            error={form.formState.errors.password?.message}
          >
            <input
              type="password"
              autoComplete="new-password"
              {...fieldProps("password", form.formState.errors.password?.message)}
              {...form.register("password")}
              className={inputClass}
              autoFocus
            />
          </Field>
          <Field
            label="Confirmer"
            htmlFor="confirmPassword"
            required
            error={form.formState.errors.confirmPassword?.message}
          >
            <input
              type="password"
              autoComplete="new-password"
              {...fieldProps(
                "confirmPassword",
                form.formState.errors.confirmPassword?.message
              )}
              {...form.register("confirmPassword")}
              className={inputClass}
            />
          </Field>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              Fermer
            </button>
            <SubmitButton pending={pending}>Réinitialiser</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ==========================================================================
 * Client assignments
 * ========================================================================== */

function ClientAssignmentsDialog({
  user,
  firms,
  assigned,
  onClose,
}: {
  user: AdminUser
  firms: AdminFirmOption[]
  assigned: Record<string, string[]>
  onClose: () => void
}) {
  const router = useRouter()
  const memberFirms = firms.filter((firm) =>
    user.memberships.some((membership) => membership.firmId === firm.id)
  )

  const [firmId, setFirmId] = React.useState(memberFirms[0]?.id ?? "")
  const firm = memberFirms.find((entry) => entry.id === firmId)

  const form = useForm<{ clientIds: string[] }>({
    resolver: zodResolver(clientAssignmentFormSchema),
    defaultValues: { clientIds: assigned[firmId] ?? [] },
  })

  // Switching firm swaps which assignment set is being edited.
  const [lastFirm, setLastFirm] = React.useState(firmId)
  if (lastFirm !== firmId) {
    setLastFirm(firmId)
    form.reset({ clientIds: assigned[firmId] ?? [] })
  }

  const selected = form.watch("clientIds") ?? []

  const { submit, pending, message, tone } = useActionForm(
    form,
    async (values) =>
      setClientAssignments({
        userId: user.id,
        firmId,
        clientIds: values.clientIds,
      }),
    {
      success: "Assignations enregistrées.",
      onSuccess: () => router.refresh(),
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clients assignés</DialogTitle>
          <DialogDescription>
            Pour {user.name ?? user.email}. Un responsable ne voit que les
            employés, contrats et documents de ces clients.
          </DialogDescription>
        </DialogHeader>

        {memberFirms.length > 1 ? (
          <div className="flex flex-wrap gap-1.5 border-b border-line pb-2.5">
            {memberFirms.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFirmId(entry.id)}
                className={`h-7 rounded-full px-2.5 text-[12.5px] ${
                  entry.id === firmId
                    ? "bg-ink text-paper"
                    : "border border-line text-ink-2 hover:bg-sub"
                }`}
              >
                {entry.name}
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-3">
          {!firm || firm.clients.length === 0 ? (
            <EmptyState
              title="Aucun client"
              description="Cette entreprise n'a pas encore de client à assigner."
            />
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-[7px] border border-line p-2">
              {firm.clients.map((client) => (
                <label
                  key={client.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-sub"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(client.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...selected, client.id]
                        : selected.filter((id) => id !== client.id)
                      form.setValue("clientIds", next, { shouldValidate: true })
                    }}
                    className="size-3.5 accent-[var(--sx-brand)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{client.name}</span>
                  {client.status !== "ACTIVE" ? (
                    <StatusPill tone="muted">{client.status}</StatusPill>
                  ) : null}
                </label>
              ))}
            </div>
          )}

          <p className="text-[11.5px] text-ink-3">
            {selected.length === 0
              ? "Aucun client sélectionné : cet utilisateur ne verra aucune donnée dans cette entreprise."
              : `${formatNumber(selected.length)} client${selected.length > 1 ? "s" : ""} sélectionné${selected.length > 1 ? "s" : ""}.`}
          </p>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              Fermer
            </button>
            <SubmitButton pending={pending}>Enregistrer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ==========================================================================
 * Delete
 * ========================================================================== */

function DeleteUserDialog({
  user,
  onClose,
}: {
  user: AdminUser
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function confirm() {
    setPending(true)
    const result = await deleteUser({ id: user.id })
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer {user.name ?? user.email}</DialogTitle>
          <DialogDescription>
            Le compte est supprimé définitivement. Les employés et documents
            liés sont conservés.
          </DialogDescription>
        </DialogHeader>

        <FormMessage>{error}</FormMessage>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="h-9 rounded-[7px] bg-alert px-3 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {pending ? "Suppression…" : "Supprimer"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

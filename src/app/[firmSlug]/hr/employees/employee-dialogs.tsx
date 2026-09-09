"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  CheckboxControl,
  DateControl,
  FieldGrid,
  SelectControl,
  TextControl,
  TextareaControl,
} from "@/components/forms/controls"
import {
  Field,
  FormMessage,
  SubmitButton,
  fieldProps,
  inputClass,
} from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CONTRACT_TYPES,
  EMPLOYEE_STATUSES,
  GENDERS,
  createEmployeeSchema,
  deleteEmployeeSchema,
  updateEmployeeSchema,
} from "@/lib/forms/hr-schemas"
import {
  createEmployee,
  deleteEmployee,
  updateEmployee,
} from "@/server/actions/employees"

/**
 * The employee wizard.
 *
 * Two steps, because the form is twenty fields and they divide cleanly:
 * *informations personnelles* is who the person is, *informations
 * professionnelles* is what they do here. Step one is validated before step two
 * appears, so a missing name is caught where it was typed rather than after
 * scrolling past a page of employment detail.
 *
 * On creation this writes an employee **and their first contract**, in one
 * transaction — see `createEmployee`. The dialog says so, because a form that
 * silently creates a second record is a surprise the first time somebody looks
 * at the contracts list.
 */

export type EmployeeOption = { id: string; name: string }

export type EmployeeDefaults = {
  id: string
  firstName: string
  lastName: string
  matricule: string
  dateOfBirth: string
  placeOfBirth: string
  gender: string
  maritalStatus: string
  nationality: string
  cni: string
  fatherName: string
  motherName: string
  phone: string
  email: string
  address: string
  hireDate: string
  jobTitle: string
  category: string
  departmentId: string
  assignedClientId: string
  status: string
  netSalary: string
  contractEndDate: string
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Actif" },
  { value: "ON_LEAVE", label: "En congé" },
  { value: "INACTIVE", label: "Inactif" },
  { value: "SUSPENDED", label: "Suspendu" },
  { value: "TERMINATED", label: "Sorti" },
] satisfies { value: (typeof EMPLOYEE_STATUSES)[number]; label: string }[]

const GENDER_OPTIONS = [
  { value: "MALE", label: "Masculin" },
  { value: "FEMALE", label: "Féminin" },
  { value: "OTHER", label: "Autre" },
] satisfies { value: (typeof GENDERS)[number]; label: string }[]

export const CONTRACT_TYPE_OPTIONS = [
  { value: "INTERIM", label: "Intérim" },
  { value: "CDD", label: "CDD" },
  { value: "CDI", label: "CDI" },
  { value: "STAGE", label: "Stage" },
  { value: "PRESTATION", label: "Prestation" },
] satisfies { value: (typeof CONTRACT_TYPES)[number]; label: string }[]

type CreateValues = ReturnType<typeof createEmployeeDefaults>

function createEmployeeDefaults(firmSlug: string) {
  return {
    firmSlug,
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    placeOfBirth: "",
    gender: "" as "" | "MALE" | "FEMALE" | "OTHER",
    maritalStatus: "",
    nationality: "Sénégalaise",
    cni: "",
    fatherName: "",
    motherName: "",
    phone: "",
    email: "",
    address: "",
    photoUrl: "",
    hireDate: new Date().toISOString().slice(0, 10),
    jobTitle: "",
    category: "",
    departmentId: "",
    assignedClientId: "",
    status: "ACTIVE" as (typeof EMPLOYEE_STATUSES)[number],
    netSalary: "",
    contractEndDate: "",
    matricule: "",
    contractType: "INTERIM" as (typeof CONTRACT_TYPES)[number],
  }
}

const STEP_ONE_FIELDS = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "placeOfBirth",
  "gender",
  "maritalStatus",
  "nationality",
  "cni",
  "fatherName",
  "motherName",
  "phone",
  "email",
  "address",
] as const

export function EmployeeDialog({
  firmSlug,
  employee,
  clients,
  departments,
  onClose,
}: {
  firmSlug: string
  /** `null` creates; a record edits. */
  employee: EmployeeDefaults | null
  clients: EmployeeOption[]
  departments: EmployeeOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const isEdit = employee !== null
  const [step, setStep] = React.useState<1 | 2>(1)

  const form = useForm<CreateValues>({
    resolver: zodResolver(
      isEdit ? updateEmployeeSchema : createEmployeeSchema
    ) as never,
    defaultValues: employee
      ? ({
          ...createEmployeeDefaults(firmSlug),
          ...employee,
          gender: employee.gender as "" | "MALE" | "FEMALE" | "OTHER",
          status: employee.status as (typeof EMPLOYEE_STATUSES)[number],
          syncActiveContract: true,
        } as never)
      : (createEmployeeDefaults(firmSlug) as never),
  })

  const { submit, pending, message, tone } = useActionForm<CreateValues, unknown>(
    form,
    async (values) => {
      if (isEdit) {
        const result = await updateEmployee({ ...values, id: employee.id })
        return result.ok ? { ok: true, data: result.data } : result
      }
      const result = await createEmployee(values)
      return result.ok ? { ok: true, data: result.data } : result
    },
    {
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  async function next() {
    const valid = await form.trigger(STEP_ONE_FIELDS as unknown as never)
    if (valid) setStep(2)
  }

  const clientOptions = clients.map((client) => ({
    value: client.id,
    label: client.name,
  }))
  const departmentOptions = departments.map((department) => ({
    value: department.id,
    label: department.name,
  }))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] w-[min(760px,calc(100%-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier l'employé" : "Nouvel employé"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Le matricule ne change pas : il identifie la personne dans cette entreprise."
              : "Le matricule est attribué automatiquement, et un premier contrat est créé avec la fiche."}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2 text-[12px]">
          {[
            { n: 1 as const, label: "Informations personnelles" },
            { n: 2 as const, label: "Informations professionnelles" },
          ].map((item) => (
            <li
              key={item.n}
              aria-current={step === item.n ? "step" : undefined}
              className={
                step === item.n
                  ? "rounded-full bg-brand-tint px-2.5 py-1 font-medium text-brand"
                  : "rounded-full bg-sub px-2.5 py-1 text-ink-3"
              }
            >
              {item.n}. {item.label}
            </li>
          ))}
        </ol>

        <form onSubmit={submit} className="space-y-3">
          <div className={step === 1 ? "space-y-3" : "hidden"}>
            <FieldGrid>
              <TextControl
                form={form}
                name="firstName"
                label="Prénom"
                required
                autoFocus
              />
              <TextControl form={form} name="lastName" label="Nom" required />
              <DateControl form={form} name="dateOfBirth" label="Date de naissance" />
              <TextControl form={form} name="placeOfBirth" label="Lieu de naissance" />
              <SelectControl
                form={form}
                name="gender"
                label="Sexe"
                options={GENDER_OPTIONS}
                placeholder="Non précisé"
              />
              <TextControl
                form={form}
                name="maritalStatus"
                label="Situation matrimoniale"
              />
              <TextControl form={form} name="nationality" label="Nationalité" />
              <TextControl form={form} name="cni" label="N° CNI" mono />
              <TextControl form={form} name="fatherName" label="Nom du père" />
              <TextControl form={form} name="motherName" label="Nom de la mère" />
              <TextControl form={form} name="phone" label="Téléphone" type="tel" />
              <TextControl form={form} name="email" label="Email" type="email" />
            </FieldGrid>
            <TextareaControl form={form} name="address" label="Adresse" rows={2} />
          </div>

          <div className={step === 2 ? "space-y-3" : "hidden"}>
            <FieldGrid>
              <DateControl
                form={form}
                name="hireDate"
                label="Date d'embauche"
                required
              />
              <SelectControl
                form={form}
                name="status"
                label="Statut"
                options={STATUS_OPTIONS}
                required
              />
              <TextControl form={form} name="jobTitle" label="Poste" />
              <TextControl form={form} name="category" label="Catégorie" />
              <SelectControl
                form={form}
                name="departmentId"
                label="Service"
                options={departmentOptions}
                placeholder="Aucun"
              />
              <SelectControl
                form={form}
                name="assignedClientId"
                label="Client affecté"
                options={clientOptions}
                placeholder="Aucun"
                hint="Détermine qui, parmi les responsables, voit cette fiche."
              />
              <TextControl
                form={form}
                name="netSalary"
                label="Salaire net (FCFA)"
                hint="Sans décimales."
              />
              <DateControl
                form={form}
                name="contractEndDate"
                label="Fin de contrat"
              />
            </FieldGrid>

            {isEdit ? (
              <CheckboxControl
                form={form}
                name={"syncActiveContract" as never}
                label="Répercuter poste, salaire, client et échéance sur le contrat actif"
                hint="Sans cela, la fiche et le contrat divergent — ce que faisait l'ancienne application, en silence."
              />
            ) : (
              <SelectControl
                form={form}
                name="contractType"
                label="Type du premier contrat"
                options={CONTRACT_TYPE_OPTIONS}
                required
                hint="Créé dans la même transaction que la fiche."
              />
            )}
          </div>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            {step === 2 ? (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="mr-auto h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
              >
                Retour
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
                Continuer
              </button>
            ) : (
              <SubmitButton pending={pending}>
                {isEdit ? "Enregistrer" : "Créer l'employé"}
              </SubmitButton>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

export function DeleteEmployeeDialog({
  firmSlug,
  employee,
  onClose,
}: {
  firmSlug: string
  employee: { id: string; matricule: string; name: string }
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm<{ firmSlug: string; id: string; confirmMatricule: string }>({
    resolver: zodResolver(deleteEmployeeSchema),
    defaultValues: { firmSlug, id: employee.id, confirmMatricule: "" },
  })

  const { submit, pending, message, tone } = useActionForm(form, deleteEmployee, {
    success: "Employé supprimé.",
    onSuccess: () => {
      onClose()
      router.refresh()
    },
  })

  const error = form.formState.errors.confirmMatricule?.message

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer {employee.name}</DialogTitle>
          <DialogDescription>
            Contrats, pièces, congés et soldes de cet employé partent avec la
            fiche. L&apos;historique de transfert vers d&apos;autres filiales est
            conservé.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <Field
            label={`Saisissez ${employee.matricule} pour confirmer`}
            htmlFor="confirmMatricule"
            required
            error={error}
          >
            <input
              {...fieldProps("confirmMatricule", error)}
              {...form.register("confirmMatricule")}
              className={`${inputClass} mono`}
              autoComplete="off"
              autoFocus
            />
          </Field>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              Annuler
            </button>
            <SubmitButton pending={pending} className="bg-alert">
              Supprimer définitivement
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

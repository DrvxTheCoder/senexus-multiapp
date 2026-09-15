"use client"

import * as React from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Edit02Icon,
  PlusSignIcon,
  UserMinus01Icon,
} from "@hugeicons/core-free-icons"

import {
  ContributionDialog,
  DependentDialog,
  TerminateMemberDialog,
  MemberDialog,
  type DependentDefaults,
  type MemberDefaults,
} from "@/app/[firmSlug]/ipm/participants/member-dialogs"
import {
  CardDownloads,
  CardFaces,
} from "@/app/[firmSlug]/ipm/cartes/card-faces"
import { PersonPhoto } from "@/app/[firmSlug]/ipm/participants/person-photo"
import { Panel, StatTiles, type StatTileProps } from "@/components/panel"
import {
  Avatar,
  EmptyState,
  StatusPill,
  TwoFacts,
  type PillTone,
} from "@/components/primitives"
import {
  formatCurrency,
  formatDate,
  formatSeniority,
  initials,
} from "@/lib/format"
import {
  MEMBER_STATUS_LABELS,
  MEMBER_STATUS_TONES,
} from "@/lib/queries/ipm/member-query"
import { CARD_STATE_LABELS, type CardState } from "@/server/domain/ipm/card"
import { RELATION_LABELS } from "@/server/domain/ipm/coverage"
import { formatRate } from "@/server/domain/ipm/rates"
import type { MemberRecord } from "@/server/queries/ipm/member-record"

const dateInput = (value: Date | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : ""

/** One mapping for the card's state — the tile above and the pill below. */
const CARD_TONE: Record<CardState, PillTone> = {
  CURRENT: "ok",
  STALE: "alert",
  MISSING: "signal",
  REVOKED: "muted",
}

/** A tile has no "muted": a state nobody has to act on is just ink. */
const cardTileTone = (state: CardState): StatTileProps["tone"] => {
  const tone = CARD_TONE[state]
  return tone === "ok" || tone === "signal" || tone === "alert" ? tone : "default"
}

/**
 * La fiche participant.
 *
 * Three things this screen refuses to round off, because each is a decision
 * somebody has to make rather than a number to glance at:
 *
 *   - a catégorie with no barème says "barème manquant", not 0 %;
 *   - the cotisation is a history, with the current period marked, not a
 *     single figure that quietly replaced its predecessor;
 *   - an ayant droit who is not covered says why, in words.
 */
export function MemberRecordView({
  firmSlug,
  record,
  employers,
  canWrite,
}: {
  firmSlug: string
  record: MemberRecord
  employers: { id: string; name: string; planCode: string | null }[]
  canWrite: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const [terminating, setTerminating] = React.useState(false)
  const [contributing, setContributing] = React.useState(false)
  const [dependent, setDependent] = React.useState<
    DependentDefaults | null | "new"
  >(null)

  const defaults: MemberDefaults = {
    id: record.id,
    employerId: record.employer.id,
    jobTitle: record.jobTitle ?? "",
    affiliationDate: dateInput(record.affiliationDate),
    terminationDate: dateInput(record.terminationDate),
    status: record.status,
    legacyCode: record.legacyCode ?? "",
    person: {
      firstName: record.person.firstName,
      lastName: record.person.lastName,
      birthDate: dateInput(record.person.birthDate),
      birthPlace: record.person.birthPlace ?? "",
      gender: record.person.gender ?? "",
      nationalId: record.person.nationalId ?? "",
      phone: record.person.phone ?? "",
      email: record.person.email ?? "",
      address: record.person.address ?? "",
    },
  }

  const activeDependents = record.dependents.filter(
    (entry) => entry.status === "ACTIVE"
  )
  // Not the same figure: an ayant droit can be actif and still refused — a
  // child past the age limit, a coverage window that has closed.
  const coveredDependents = activeDependents.filter((entry) => entry.covered)
    .length

  return (
    <div className="space-y-3.5">
      <Panel
        titleAs="h2"
        title={
          <span className="flex items-center gap-2.5">
            <Avatar
              initials={initials(record.person.firstName, record.person.lastName)}
              size={30}
            />
            <span className="font-extrabold text-lg">
              {record.person.lastName.toUpperCase()} {record.person.firstName}
            </span>
            <StatusPill
              tone={
                MEMBER_STATUS_TONES[
                  record.status as keyof typeof MEMBER_STATUS_TONES
                ] ?? "muted"
              }
            >
              {MEMBER_STATUS_LABELS[
                record.status as keyof typeof MEMBER_STATUS_LABELS
              ] ?? record.status}
            </StatusPill>
          </span>
        }
        description={
          record.legacyCode
            ? `Matricule ${record.matricule} · WebLamps ${record.legacyCode}`
            : `Matricule ${record.matricule}`
        }
        tools={
          canWrite ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex h-8 items-center gap-1.5 rounded-[7px] border border-line px-2.5 text-[13px] hover:bg-sub"
              >
                <HugeiconsIcon icon={Edit02Icon} size={13} aria-hidden />
                Modifier
              </button>
              {record.status !== "TERMINATED" ? (
                <button
                  type="button"
                  onClick={() => setTerminating(true)}
                  className="flex h-8 items-center gap-1.5 rounded-[7px] border border-line px-2.5 text-[13px] text-alert hover:bg-sub"
                >
                  <HugeiconsIcon icon={UserMinus01Icon} size={13} aria-hidden />
                  Radier
                </button>
              ) : null}
            </div>
          ) : null
        }
      >
        {/* The photo sits with the identity it belongs to, and is shown in the
            card's own circular crop so what is approved here is what prints. */}
        <div className="mb-4 flex flex-wrap items-start gap-5 border-b border-line pb-4">
          <PersonPhoto
            firmSlug={firmSlug}
            subject="member"
            subjectId={record.id}
            photoUrl={record.person.photoUrl}
            name={`${record.person.firstName} ${record.person.lastName}`}
            canWrite={canWrite}
          />
          {/* The four figures someone opens this record to check, at the size
              they are worth. Each carries what it is measured against on its
              second line: a cotisation without its start date, or a count of
              ayants droit without the total, is a number you have to scroll to
              interpret. */}
          <StatTiles
            className="min-w-70 flex-1"
            stats={[
              {
                label: "Cotisation mensuelle",
                value: record.currentContribution
                  ? formatCurrency(record.currentContribution.monthlyAmount)
                  : "Aucune",
                hint: record.currentContribution
                  ? `Depuis le ${formatDate(record.currentContribution.validFrom)}`
                  : "Aucune période ouverte",
                tone: record.currentContribution ? "default" : "alert",
              },
              {
                label: "Ayants droit couverts",
                value: coveredDependents,
                // Ochre when some ayant droit is registered but refused: the
                // refusal has a reason, printed in the table below.
                tone:
                  coveredDependents < activeDependents.length
                    ? "signal"
                    : "default",
                hint: activeDependents.length
                  ? `sur ${activeDependents.length} actif${activeDependents.length > 1 ? "s" : ""}`
                  : "Aucun enregistré",
              },
              record.terminationDate
                ? {
                    label: "Radié le",
                    value: formatDate(record.terminationDate),
                    hint: `Affilié le ${formatDate(record.affiliationDate)}`,
                    tone: "alert" as const,
                  }
                : {
                    label: "Affilié le",
                    value: formatDate(record.affiliationDate),
                    hint: formatSeniority(record.affiliationDate, record.asOf),
                  },
              {
                label: "Carte de tiers payant",
                value: CARD_STATE_LABELS[record.card.state],
                tone: cardTileTone(record.card.state),
                hint: record.card.version
                  ? `v${record.card.version} · ${formatDate(record.card.generatedAt)}`
                  : undefined,
              },
            ]}
          />
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-3">
          <Fact label="Employeur">
            <Link
              href={`/${firmSlug}/ipm/employeurs`}
              className="text-brand hover:underline"
            >
              {record.employer.name}
            </Link>
          </Fact>
          <Fact label="Formule">
            {record.employer.planName ?? "Taux propre à l'employeur"}
          </Fact>
          <Fact label="Fonction">{record.jobTitle ?? "—"}</Fact>
          <Fact label="Date de naissance">
            {formatDate(record.person.birthDate) || "—"}
          </Fact>
          <Fact label="Lieu de naissance">{record.person.birthPlace ?? "—"}</Fact>
          <Fact label="CNI">{record.person.nationalId ?? "—"}</Fact>
          <Fact label="Téléphone">{record.person.phone ?? "—"}</Fact>
          <Fact label="Email">{record.person.email ?? "—"}</Fact>
          <Fact label="Contrat de travail">
            {record.employment ? (
              <Link
                href={`/${record.employment.firmSlug}/hr/employees/${record.employment.id}`}
                className="text-brand hover:underline"
              >
                {record.employment.matricule}
              </Link>
            ) : (
              "Employeur externe"
            )}
          </Fact>
        </dl>
      </Panel>

      {/* ---- barème ------------------------------------------------------ */}
      <Panel
        titleAs="h2"
        title="Taux de prise en charge"
        description="Résolus dans l'ordre : dérogation employeur, puis formule."
        padded={false}
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
              <th className="px-[15px] py-2 font-medium">Catégorie</th>
              <th className="px-[15px] py-2 font-medium">Taux</th>
              <th className="px-[15px] py-2 font-medium">Origine</th>
              <th className="px-[15px] py-2 font-medium">Carence</th>
              <th className="px-[15px] py-2 font-medium">Plafond annuel</th>
            </tr>
          </thead>
          <tbody>
            {record.rates.map((rate) => (
              <tr key={rate.categoryId} className="border-b border-line">
                <td className="px-[15px] py-2.5">{rate.categoryLabel}</td>
                <td className="px-[15px] py-2.5 tabular-nums">
                  {rate.rate === null ? (
                    // Never 0 %. Nobody has entered this barème yet, which is
                    // a different statement from "rien n'est couvert".
                    <span className="text-alert">Barème manquant</span>
                  ) : (
                    formatRate(rate.rate)
                  )}
                </td>
                <td className="px-[15px] py-2.5 text-ink-3">
                  {rate.source === "EMPLOYER"
                    ? "Dérogation employeur"
                    : rate.source === "PLAN"
                      ? "Formule"
                      : "—"}
                </td>
                <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                  {rate.waitingPeriodDays ? `${rate.waitingPeriodDays} j` : "—"}
                </td>
                <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                  {rate.ceilingAnnual ? formatCurrency(rate.ceilingAnnual) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      
      <div className="flex flex-row gap-3.5 w-full">
        {/* ---- ayants droit ------------------------------------------------ */}
        <Panel
        titleAs="h2"
        title="Ayants droit"
        // description={`Un enfant est couvert jusqu'à ${record.employer.ageMajority} ans chez cet employeur.`}
        padded={false}
        tools={
          canWrite ? (
            <button
              type="button"
              onClick={() => setDependent("new")}
              className="flex h-8 items-center gap-1.5 rounded-[7px] bg-brand px-2.5 text-[13px] font-medium text-brand-contrast hover:opacity-90"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
              Ajouter
            </button>
          ) : null
        }
        className="flex-2 h-full"
      >
        {record.dependents.length === 0 ? (
          <EmptyState
            title="Aucun ayant droit"
            description="La cotisation couvre le participant et sa famille ; ajoutez-la ici."
          />
        ) : (
          <table className="w-full text-[13px] h-full">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-3.75 py-2 font-medium">Rang</th>
                <th className="px-3.75 py-2 font-medium">Photo</th>
                <th className="px-3.75 py-2 font-medium">Nom</th>
                <th className="px-3.75 py-2 font-medium">Lien</th>
                <th className="px-3.75 py-2 font-medium">Naissance</th>
                <th className="px-3.75 py-2 font-medium">Couverture</th>
                {canWrite ? <th className="px-3.75 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {record.dependents.map((entry) => (
                <tr key={entry.id} className="border-b border-line">
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {entry.rank}
                  </td>
                  <td className="px-[15px] py-2.5">
                    {/* Each ayant droit gets their own box on the back of the
                        card, so each needs their own photo. */}
                    <PersonPhoto
                      firmSlug={firmSlug}
                      subject="dependent"
                      subjectId={entry.id}
                      photoUrl={entry.photoUrl}
                      name={`${entry.firstName} ${entry.lastName}`}
                      size={40}
                      canWrite={canWrite}
                    />
                  </td>
                  <td className="px-[15px] py-2.5">
                    <TwoFacts
                      primary={`${entry.lastName.toUpperCase()} ${entry.firstName}`}
                      secondary={entry.matricule}
                    />
                  </td>
                  <td className="px-[15px] py-2.5">
                    {RELATION_LABELS[
                      entry.relation as keyof typeof RELATION_LABELS
                    ] ?? entry.relation}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {entry.birthDate ? (
                      formatDate(entry.birthDate)
                    ) : (
                      <span className="text-signal">Non renseignée</span>
                    )}
                  </td>
                  <td className="px-[15px] py-2.5">
                    {entry.covered ? (
                      <StatusPill tone="ok">Couvert</StatusPill>
                    ) : (
                      // The reason, not just a refusal — WebLamps answers
                      // OK/KO and leaves the counter guessing.
                      <span className="text-[12.5px] text-ink-3">
                        {entry.refusalMessage}
                      </span>
                    )}
                  </td>
                  {canWrite ? (
                    <td className="px-[15px] py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setDependent({
                            id: entry.id,
                            relation: entry.relation,
                            // Seeded from the record, not blanked: the action
                            // writes both fields back, so an empty default
                            // saves over a real marriage date or sexe.
                            marriageDate: dateInput(entry.marriageDate),
                            coverageStart: dateInput(entry.coverageStart),
                            coverageEnd: dateInput(entry.coverageEnd),
                            status: entry.status,
                            person: {
                              firstName: entry.firstName,
                              lastName: entry.lastName,
                              birthDate: dateInput(entry.birthDate),
                              gender: entry.gender ?? "",
                            },
                          })
                        }
                        className="text-ink-3 hover:text-ink"
                        aria-label={`Modifier ${entry.firstName}`}
                      >
                        <HugeiconsIcon icon={Edit02Icon} size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

        {/* ---- carte -------------------------------------------------------- */}
        <Panel
          titleAs="h2"
          title="Carte de tiers payant"
          description={
            record.card.state === "STALE"
              ? "Le contenu imprimé a changé depuis la dernière génération."
              : "Aperçu à 150 ppi ; fichiers d'impression en CMJN 300 ppi."
          }
          tools={
            <div className="flex items-center gap-2">
              <CardDownloads firmSlug={firmSlug} memberId={record.id} />
              {/* <Link
                href={`/${firmSlug}/ipm/cartes`}
                className="flex h-8 items-center rounded-[7px] border border-line px-2.5 text-[13px] hover:bg-sub"
              >
                Toutes les cartes
              </Link> */}
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <StatusPill tone={CARD_TONE[record.card.state]}>
              {CARD_STATE_LABELS[record.card.state]}
            </StatusPill>
            {record.card.version ? (
              <span className="text-ink-3">
                v{record.card.version} · {formatDate(record.card.generatedAt)}
              </span>
            ) : null}
            {record.dependents.filter((entry) => entry.status === "ACTIVE").length >
            9 ? (
              <span className="text-[12.5px] text-signal">
                Le verso affiche 9 ayants droit et mentionne le reste.
              </span>
            ) : null}
          </div>

          {/* The card itself, on the record it belongs to. The photo above and
              the ayants droit below are what it prints, so seeing all three on
              one screen is how an operator checks a card before printing it. */}
          <CardFaces
            firmSlug={firmSlug}
            memberId={record.id}
            version={record.card.hash}
            className="mt-3.5 flex flex-wrap gap-4"
          />
        </Panel>
      </div>

      {/* ---- cotisations ------------------------------------------------- */}
      <Panel
        titleAs="h2"
        title="Cotisations"
        description="Une modification ouvre une période ; elle n'écrase pas la précédente."
        padded={false}
        tools={
          canWrite ? (
            <button
              type="button"
              onClick={() => setContributing(true)}
              className="flex h-8 items-center gap-1.5 rounded-[7px] border border-line px-2.5 text-[13px] hover:bg-sub"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
              Nouvelle période
            </button>
          ) : null
        }
        footer={
          record.contributionOverlaps > 0
            ? {
                summary: (
                  <span className="text-alert">
                    {record.contributionOverlaps} chevauchement
                    {record.contributionOverlaps > 1 ? "s" : ""} détecté dans
                    l&apos;historique — le montant affiché peut être faux.
                  </span>
                ),
              }
            : undefined
        }
      >
        {record.contributions.length === 0 ? (
          <EmptyState
            title="Aucune cotisation"
            description="Ce participant n'est rattaché à aucun montant : rien ne sera facturé."
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Période</th>
                <th className="px-[15px] py-2 font-medium">Montant</th>
                <th className="px-[15px] py-2 font-medium">Formule</th>
                <th className="px-[15px] py-2 font-medium">Motif</th>
                <th className="px-[15px] py-2 font-medium">Saisi par</th>
              </tr>
            </thead>
            <tbody>
              {record.contributions.map((entry) => (
                <tr
                  key={entry.id}
                  className={`border-b border-line ${entry.current ? "bg-brand-tint/40" : ""}`}
                >
                  <td className="px-[15px] py-2.5 tabular-nums">
                    {formatDate(entry.validFrom)} —{" "}
                    {entry.validTo ? (
                      formatDate(entry.validTo)
                    ) : (
                      <span className="font-medium">en cours</span>
                    )}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums">
                    {formatCurrency(entry.monthlyAmount)}
                  </td>
                  <td className="px-[15px] py-2.5 text-ink-3">
                    {entry.planCode ?? "—"}
                  </td>
                  <td className="px-[15px] py-2.5 text-ink-3">
                    {entry.reason ?? "—"}
                  </td>
                  <td className="px-[15px] py-2.5 text-ink-3">
                    {entry.authorName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {editing ? (
        <MemberDialog
          firmSlug={firmSlug}
          employers={employers}
          member={defaults}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {terminating ? (
        <TerminateMemberDialog
          firmSlug={firmSlug}
          memberId={record.id}
          memberName={`${record.person.firstName} ${record.person.lastName}`}
          dependentCount={activeDependents.length}
          onClose={() => setTerminating(false)}
        />
      ) : null}

      {contributing ? (
        <ContributionDialog
          firmSlug={firmSlug}
          memberId={record.id}
          currentAmount={record.currentContribution?.monthlyAmount ?? null}
          onClose={() => setContributing(false)}
        />
      ) : null}

      {dependent !== null ? (
        <DependentDialog
          firmSlug={firmSlug}
          memberId={record.id}
          dependent={dependent === "new" ? null : dependent}
          ageMajority={record.employer.ageMajority}
          onClose={() => setDependent(null)}
        />
      ) : null}
    </div>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="mt-px truncate">{children}</dd>
    </div>
  )
}

import "server-only"

import * as React from "react"
import { Document, Page, Text, View } from "@react-pdf/renderer"

import {
  Band,
  BlankRows,
  Boxed,
  COPY_DESTINATION,
  FieldGroup,
  FieldLine,
  Footer,
  InlineLabel,
  Letterhead,
  Notice,
  SectionBar,
  TableFrame,
  TableHeader,
  TableRow,
  TotalsBlock,
  TitleRow,
  VerificationMark,
  VisaRow,
  type Column,
  type CopyKind,
} from "@/server/pdf/chrome"
import type { FittedImage } from "@/server/pdf/images"
import {
  RULE,
  TYPE,
  baseStyles,
  fcfa,
  percent,
  shortDate,
} from "@/server/pdf/theme"
import type { VoucherDocument } from "@/server/queries/ipm/documents"

/**
 * Les bons de prise en charge.
 *
 * Four documents on one template, because they are four states of the same
 * object: a bon is an instruction to a counterparty to serve a beneficiary and
 * bill the institution. What changes between a bon de pharmacie and une lettre
 * de garantie hospitalisation is the title, what the counterparty is called,
 * how long it is valid and what the table asks them to fill in. Everything
 * else — the en-tête, the identity block, the visas, the footer — is the same
 * paper, and the reference documents' habit of redrawing it slightly
 * differently each time is the thing this replaces.
 *
 * Each bon prints in **three copies**: the original that is attached to the
 * provider's invoice, the provider's own, and the participant's. That is how
 * the institution works today and the copies are what makes the reconciliation
 * possible; they are pages of one PDF rather than three files, so a counter
 * cannot print two of the three.
 *
 * ## Deliberate departures from the reference documents
 *
 * - **The totals are printed, not left blank.** Every bon is priced at
 *   issuance — `totalAmount`, `insurerShare`, `memberShare` and the frozen
 *   `appliedRate` are all on the row — and the one question a pharmacist
 *   actually has at the counter is what the participant owes. The originals
 *   leave that box empty and the answer is worked out by hand, wrongly.
 * - **The expiry is a date.** "Valable pour une durée d'un mois" requires the
 *   reader to know when it was issued and to do arithmetic; the date is also
 *   printed, and the validity comes from `VOUCHER_VALIDITY_DAYS` rather than
 *   from a sentence baked into the artwork.
 * - **The settlement term comes from the agreement.** The original hard-codes
 *   60 days; `provider.paymentTermDays` is the field that actually governs it.
 * - **A cancelled bon says so, loudly,** instead of printing identically to a
 *   live one. Its QR has already been rotated to an expired token, so the page
 *   and the code now agree.
 * - **PRESCRIPTEUR is absent.** The reference forms carry it, but the data
 *   model has one counterparty per bon and filling the box with the provider's
 *   own code — which is what the legacy system does on three of the four
 *   samples — states something untrue. An empty box is better than a wrong
 *   one; a real prescriber field is a schema change, noted rather than faked.
 */

export type VoucherType = VoucherDocument["type"]

type Spec = {
  title: string
  /** What the receiving party is called on this particular form. */
  counterparty: string
  /** The strip under the title. First line is set bold. */
  band: (document: VoucherDocument) => string[]
  columns: Column[]
  /**
   * Rows the table always has, priced lines included.
   *
   * A minimum rather than a count of blanks: a bon with three articles and a
   * bon with one must be the same height, or a counter handling both cannot
   * tell at a glance whether a form has been added to. The remainder is left
   * ruled and empty for the counterparty to write in — on a lettre de
   * garantie those blank rows *are* the document.
   */
  minRows: number
  /** The paragraph some of these forms carry above the signatures. */
  legal?: (document: VoucherDocument) => string[]
}

const PHARMACY_COLUMNS: Column[] = [
  { key: "code", header: "Code pdt.", flex: 1.1 },
  { key: "label", header: "Désignation", flex: 3.4 },
  { key: "qty", header: "Qté", flex: 0.6, align: "right" },
  { key: "unit", header: "Prix unit.", flex: 1.1, align: "right" },
  { key: "amount", header: "Montant", flex: 1.2, align: "right" },
]

const OPTICAL_COLUMNS: Column[] = [
  { key: "code", header: "Réf.", flex: 1 },
  { key: "label", header: "Dénomination", flex: 3.5 },
  { key: "qty", header: "Qté", flex: 0.6, align: "right" },
  { key: "unit", header: "Prix unit.", flex: 1.1, align: "right" },
  { key: "amount", header: "Total", flex: 1.2, align: "right" },
]

const ACT_COLUMNS: Column[] = [
  { key: "date", header: "Date", flex: 1 },
  { key: "label", header: "Nature de l'acte", flex: 3.4 },
  { key: "code", header: "Code acte", flex: 1.1 },
  { key: "unit", header: "Honoraire", flex: 1.2, align: "right" },
  { key: "amount", header: "Montant", flex: 1.2, align: "right" },
]

const SPECS: Record<VoucherType, Spec> = {
  PHARMACY: {
    title: "Bon de commande pharmacie",
    counterparty: "Fournisseur",
    band: (document) => [
      `Bon de commande valable jusqu'au ${shortDate(document.expiryDate)}`,
      "Au vu de l'ordonnance visée par le Gérant avec la mention : BON À SERVIR",
    ],
    columns: PHARMACY_COLUMNS,
    minRows: 8,
  },

  OPTICAL: {
    title: "Bon de commande optique",
    counterparty: "Fournisseur",
    band: (document) => [
      `Bon de commande valable jusqu'au ${shortDate(document.expiryDate)}`,
      "À présenter avec l'ordonnance de l'ophtalmologiste.",
    ],
    columns: OPTICAL_COLUMNS,
    minRows: 8,
  },

  GUARANTEE: {
    title: "Lettre de garantie",
    counterparty: "Prestataire",
    band: (document) => [
      `Valable jusqu'au ${shortDate(document.expiryDate)}`,
      "Les actes réalisés sont portés au tableau ci-dessous et facturés à l'IPM.",
    ],
    columns: ACT_COLUMNS,
    // A clinic writes the acts onto this form in ink, so the blank rows are
    // the document rather than padding.
    minRows: 12,
    legal: (document) => [
      `Je soussigné, Gérant de ${document.firm.name}, certifie que les frais engagés ` +
        `au titre de la prestation ci-dessus, pour le bénéficiaire mentionné, seront réglés ` +
        `par l'institution dans un délai de ${document.provider.paymentTermDays} jours à compter ` +
        `de la présentation de la facture en trois exemplaires.`,
    ],
  },

  HOSPITALIZATION: {
    title: "Lettre de garantie hospitalisation",
    counterparty: "Structure de soins",
    band: (document) => [
      `Valable jusqu'au ${shortDate(document.expiryDate)}`,
      "Hospitalisations · Accouchements · Séances de kinésithérapie.",
    ],
    columns: ACT_COLUMNS,
    minRows: 12,
    legal: (document) => [
      `Je soussigné, Gérant de ${document.firm.name}, certifie que les frais engagés ` +
        `au titre de « ${document.service.type} » pour le bénéficiaire mentionné seront réglés ` +
        `par l'institution dans un délai de ${document.provider.paymentTermDays} jours à compter ` +
        `de la présentation de la facture en trois exemplaires.`,
      "La durée de séjour prise en charge pour un accouchement est fixée à cinq (5) jours au maximum.",
    ],
  },
}

export type VoucherAssets = {
  letterhead: FittedImage | null
  stamp: FittedImage | null
  /** Data URI produced by `qrImage`. */
  qr: string | null
  /** The signature of whoever issued the bon, when they have uploaded one. */
  issuerSignature: FittedImage | null
}

const COPIES: CopyKind[] = ["ORIGINAL", "PROVIDER", "MEMBER"]

export function VoucherPdf({
  document,
  assets,
  printedBy,
  printedAt = new Date(),
}: {
  document: VoucherDocument
  assets: VoucherAssets
  printedBy: string | null
  printedAt?: Date
}) {
  const spec = SPECS[document.type]

  return (
    <Document
      title={`${spec.title} ${document.number}`}
      author={document.firm.name}
      subject={`${document.beneficiary.name} — ${document.provider.name}`}
      creator={document.firm.name}
      producer={document.firm.name}
    >
      {COPIES.map((copy) => (
        <VoucherPage
          key={copy}
          copy={copy}
          spec={spec}
          document={document}
          assets={assets}
          printedBy={printedBy}
          printedAt={printedAt}
        />
      ))}
    </Document>
  )
}

function VoucherPage({
  copy,
  spec,
  document,
  assets,
  printedBy,
  printedAt,
}: {
  copy: CopyKind
  spec: Spec
  document: VoucherDocument
  assets: VoucherAssets
  printedBy: string | null
  printedAt: Date
}) {
  const { colors, styles } = baseStyles(document.firm.themeColor)
  const cancelled = document.status === "CANCELLED"
  const isOrder = document.type === "PHARMACY" || document.type === "OPTICAL"

  const rows = document.lines.map((line) =>
    isOrder
      ? [
          line.code ?? "",
          line.label,
          String(line.quantity),
          line.unitPrice ? fcfa(line.unitPrice) : "",
          line.amount ? fcfa(line.amount) : "",
        ]
      : [
          shortDate(document.issueDate),
          line.label,
          line.code ?? "",
          line.unitPrice ? fcfa(line.unitPrice) : "",
          line.amount ? fcfa(line.amount) : "",
        ]
  )

  return (
    <Page size="A4" style={styles.page}>
      <Letterhead
        letterhead={assets.letterhead}
        firmName={document.firm.name}
        palette={colors}
        meta={{
          createdAt: document.createdAt,
          createdBy: document.issuedBy,
          printedAt,
          printedBy,
        }}
      />

      <TitleRow
        copy={copy}
        title={spec.title}
        number={document.number}
        palette={colors}
      />

      <Band lines={spec.band(document)} palette={colors} />

      {cancelled ? (
        <Notice palette={colors}>
          {`Bon annulé le ${shortDate(document.cancelledAt)}${
            document.cancelReason ? ` — ${document.cancelReason}` : ""
          }. Ce document ne vaut plus prise en charge.`}
        </Notice>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      <FieldGroup palette={colors}>
        <FieldLine label="Participant" palette={colors}>
          <Boxed palette={colors} flex={1} strong>
            {document.member.name}
          </Boxed>
        </FieldLine>

        <FieldLine label="Matricule" palette={colors}>
          <Boxed palette={colors} width={110}>
            {document.member.legacyCode ?? document.member.matricule}
          </Boxed>
          <Boxed palette={colors} flex={1} tone="accent" align="center">
            {document.member.employerName}
          </Boxed>
        </FieldLine>

        <FieldLine label="Bénéficiaire" palette={colors}>
          <Boxed palette={colors} flex={1}>
            {document.beneficiary.name}
          </Boxed>
          <Boxed palette={colors} width={90} align="center">
            {document.beneficiary.kind}
          </Boxed>
          <InlineLabel palette={colors}>Âge</InlineLabel>
          <Boxed palette={colors} width={34} align="center">
            {document.beneficiary.age === null
              ? "—"
              : String(document.beneficiary.age)}
          </Boxed>
          <Text style={{ ...styles.label, marginLeft: -2 }}>an(s)</Text>
        </FieldLine>

        <FieldLine label="Prestation" palette={colors} marginBottom={0}>
          <Boxed palette={colors} flex={1.4} strong>
            {document.service.type}
          </Boxed>
          <Boxed palette={colors} flex={1} tone="muted">
            {document.service.category}
          </Boxed>
        </FieldLine>
      </FieldGroup>

      {/* ---------------------------------------------------------------- */}

      <SectionBar palette={colors} marginTop={2}>
        {spec.counterparty}
      </SectionBar>

      <FieldGroup palette={colors}>
        <FieldLine label="Établissement" palette={colors}>
          <Boxed palette={colors} width={62} align="center">
            {document.provider.code ?? "—"}
          </Boxed>
          <Boxed palette={colors} flex={1} tone="accent" align="center">
            {document.provider.name}
          </Boxed>
        </FieldLine>

        <FieldLine label="Adresse" palette={colors} marginBottom={0}>
          <Boxed palette={colors} flex={1}>
            {document.provider.address}
          </Boxed>
          <InlineLabel palette={colors}>Tél</InlineLabel>
          <Boxed palette={colors} width={96} align="center">
            {document.provider.phone}
          </Boxed>
        </FieldLine>
      </FieldGroup>

      {/* ---------------------------------------------------------------- */}

      <TableFrame palette={colors}>
        <TableHeader columns={spec.columns} palette={colors} />
        {rows.map((cells, index) => (
          <TableRow
            key={document.lines[index].label + index}
            columns={spec.columns}
            cells={cells}
            palette={colors}
            zebra={index % 2 === 1}
          />
        ))}
        <BlankRows
          columns={spec.columns}
          count={Math.max(0, spec.minRows - rows.length)}
          palette={colors}
        />
      </TableFrame>

      <TotalsBlock
        palette={colors}
        rows={[
          { label: "Montant total", value: fcfa(document.totalAmount) },
          {
            label: `Part IPM (${percent(document.appliedRate)})`,
            value: fcfa(document.insurerShare),
            strong: true,
          },
          {
            label: "Reste à charge participant",
            value: fcfa(document.memberShare),
          },
        ]}
      />

      {/* ---------------------------------------------------------------- */}

      {spec.legal ? (
        <View style={{ marginTop: 8 }}>
          {spec.legal(document).map((paragraph, index) => (
            <Text
              key={index}
              style={{
                ...styles.legal,
                marginBottom: 4,
                fontWeight: index === 0 ? 400 : 600,
              }}
            >
              {paragraph}
            </Text>
          ))}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: 6,
        }}
      >
        <View style={{ flex: 1, marginRight: 10 }}>
          <VisaRow
            palette={colors}
            height={54}
            visas={[
              {
                title: "Le participant",
                hint: "Signature à la remise",
              },
              {
                title: `Pour ${document.firm.name}`,
                name: document.issuedBy,
                signature: cancelled ? null : assets.issuerSignature,
                stamp: cancelled ? null : assets.stamp,
              },
            ]}
          />
        </View>

        {assets.qr ? (
          <VerificationMark src={assets.qr} palette={colors} />
        ) : null}
      </View>

      <Text
        style={{
          fontSize: TYPE.meta,
          color: colors.ink3,
          marginTop: 6,
          borderTopWidth: RULE.hair,
          borderTopColor: colors.hair,
          borderTopStyle: "solid",
          paddingTop: 3,
        }}
      >
        {`Émis le ${shortDate(document.issueDate)} · valable jusqu'au ${shortDate(document.expiryDate)} · ` +
          `taux appliqué ${percent(document.appliedRate)} · toute rature annule ce bon.`}
      </Text>

      <Footer
        destination={COPY_DESTINATION[copy]}
        reference={`${spec.title} ${document.number}`}
        palette={colors}
      />
    </Page>
  )
}

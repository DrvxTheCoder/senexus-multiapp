import "server-only"

import * as React from "react"
import { Document, Page, Text, View } from "@react-pdf/renderer"

import {
  Band,
  Boxed,
  FieldGroup,
  FieldLine,
  Footer,
  Letterhead,
  Notice,
  SectionBar,
  TableFrame,
  TableHeader,
  TableRow,
  TotalsBlock,
  TitleRow,
  VisaRow,
  type Column,
  type Visa,
} from "@/server/pdf/chrome"
import { InvoicePage } from "@/server/pdf/templates/provider-invoice"
import type { FittedImage } from "@/server/pdf/images"
import { amountInWords } from "@/server/domain/ipm/amount-in-words"
import { RULE, TYPE, baseStyles, fcfa, shortDate } from "@/server/pdf/theme"
import type { DisbursementDocument } from "@/server/queries/ipm/documents"

/**
 * Le bon de décaissement.
 *
 * The document the institution's money leaves on, and the one place in this
 * application where a signature is printed rather than merely recorded.
 *
 * ## Les trois visas
 *
 * They are three different facts and the template treats them as such:
 *
 *   - **VISA DIRECTION GÉNÉRALE** — the approval. `approvedById` and
 *     `approvedAt`, and the signature image belongs to that user, taken from
 *     their own account. There is no field anywhere that lets one person
 *     record another's approval, and this page cannot print one either: the
 *     signature comes from the row, and the row is only ever written with
 *     `ctx.userId`. See `actions/ipm-disbursements.ts`.
 *   - **VISA RÉCEPTION** — the payee signing on collection. **Deliberately
 *     blank**, always. No user of this application can stand for the person
 *     receiving the money, so the box is ruled and dated and left for a pen.
 *     Printing anything else there would be forgery with extra steps.
 *   - **VISA COMPTABILITÉ** — the posting. Same construction as the first.
 *
 * An unsigned box prints as an unsigned box. A bon awaiting approval must look
 * like a bon awaiting approval, or the row of visas means nothing.
 *
 * ## L'annexe
 *
 * A bon settles invoices, and a signatory approving a payment should be able
 * to see what they are paying for without going to find it. Every attached
 * invoice that has a detail — which is every invoice the institution generated
 * itself — is **printed into this same PDF**, after the bon, with its own
 * pagination and a note saying which bon it belongs to.
 *
 * An invoice received on paper has no lines to reproduce, so it is listed in
 * the table and not annexed. The page says which are which rather than leaving
 * the reader to notice.
 */

const COLUMNS: Column[] = [
  { key: "kind", header: "Pièce", flex: 1.3 },
  { key: "label", header: "Libellé", flex: 5.2 },
  { key: "amount", header: "Montant", flex: 1.5, align: "right" },
]

const SOURCE_LABELS: Record<string, string> = {
  INVOICE: "Facture",
  REIMBURSEMENT: "Remboursement",
}

const PAYEE_LABELS: Record<string, string> = {
  PROVIDER: "Prestataire",
  MEMBER: "Participant",
  SUPPLIER: "Fournisseur",
}

const METHOD_LABELS: Record<string, string> = {
  CHEQUE: "Chèque",
  TRANSFER: "Virement",
  CASH: "Espèces",
  ORANGE_MONEY: "Orange Money",
}

const JOURNAL_LABELS: Record<string, string> = {
  B1: "B1 — Banque",
  "02": "02 — Caisse",
  OM: "OM — Orange Money",
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "En attente de visa",
  APPROVED: "Visé par la direction",
  POSTED: "Comptabilisé",
  PAID: "Réglé",
  CANCELLED: "Annulé",
}

export type DisbursementAssets = {
  letterhead: FittedImage | null
  stamp: FittedImage | null
  /** Keyed by the same order the visas appear in. Absent when unsigned. */
  approvedSignature: FittedImage | null
  accountingSignature: FittedImage | null
}

export function DisbursementPdf({
  document,
  assets,
  printedBy,
  printedAt = new Date(),
}: {
  document: DisbursementDocument
  assets: DisbursementAssets
  printedBy: string | null
  printedAt?: Date
}) {
  // Only the invoices the institution can actually reproduce. A received
  // invoice is a scan in somebody's drawer; claiming it as an annexe here
  // would promise a page that is not in the file.
  const annexes = document.invoices.filter((invoice) => invoice.lines.length > 0)

  return (
    <Document
      title={`Bon de décaissement ${document.number}`}
      author={document.firm.name}
      subject={`${document.payeeName} — ${fcfa(document.amount)}`}
      creator={document.firm.name}
      producer={document.firm.name}
    >
      <DisbursementPage
        document={document}
        assets={assets}
        annexeCount={annexes.length}
        printedBy={printedBy}
        printedAt={printedAt}
      />

      {annexes.map((invoice) => (
        <InvoicePage
          key={invoice.id}
          document={invoice}
          assets={{
            letterhead: assets.letterhead,
            stamp: assets.stamp,
            checkerSignature: null,
          }}
          printedBy={printedBy}
          printedAt={printedAt}
          annexe={{ of: document.number }}
        />
      ))}
    </Document>
  )
}

function DisbursementPage({
  document,
  assets,
  annexeCount,
  printedBy,
  printedAt,
}: {
  document: DisbursementDocument
  assets: DisbursementAssets
  annexeCount: number
  printedBy: string | null
  printedAt: Date
}) {
  const { colors, styles } = baseStyles(document.firm.themeColor)
  const cancelled = document.status === "CANCELLED"

  const visas: Visa[] = [
    {
      title: "Visa direction générale",
      name: document.approvedBy?.name ?? null,
      at: document.approvedAt,
      signature: cancelled ? null : assets.approvedSignature,
      stamp: cancelled || !document.approvedAt ? null : assets.stamp,
      hint: "En attente",
    },
    {
      // Never filled from a user row — see the module comment.
      title: "Visa réception",
      name: null,
      at: document.receivedAt,
      hint: document.receivedAt
        ? "Reçu par le bénéficiaire"
        : "Signature du bénéficiaire à la remise",
    },
    {
      title: "Visa comptabilité",
      name: document.accountingBy?.name ?? null,
      at: document.accountingAt,
      signature: cancelled ? null : assets.accountingSignature,
      hint: "En attente",
    },
  ]

  const rows = [
    ...document.lines.map((line) => [
      SOURCE_LABELS[line.sourceType] ?? line.sourceType,
      line.label,
      fcfa(line.amount),
    ]),
  ]

  return (
    <Page size="A4" style={styles.page}>
      <Letterhead
        letterhead={assets.letterhead}
        firmName={document.firm.name}
        palette={colors}
        meta={{
          createdAt: document.createdAt,
          createdBy: document.enteredBy?.name ?? null,
          printedAt,
          printedBy,
        }}
      />

      <TitleRow
        copy={null}
        title="Bon de décaissement"
        number={document.number}
        palette={colors}
      />

      <Band
        palette={colors}
        lines={[
          `Journal ${JOURNAL_LABELS[document.journalCode] ?? document.journalCode} · ${
            STATUS_LABELS[document.status] ?? document.status
          }`,
          "Ce bon ne vaut règlement qu'après apposition des trois visas ci-dessous.",
        ]}
      />

      {cancelled ? (
        <Notice palette={colors}>
          Bon annulé. Aucun règlement ne doit être effectué sur cette pièce.
        </Notice>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      <FieldGroup palette={colors}>
        <FieldLine label="Bénéficiaire" palette={colors}>
          <Boxed palette={colors} flex={1} tone="accent" align="center">
            {document.payeeName}
          </Boxed>
          <Boxed palette={colors} width={86} align="center">
            {PAYEE_LABELS[document.payeeType] ?? document.payeeType}
          </Boxed>
        </FieldLine>

        <FieldLine label="Motif" palette={colors}>
          <Boxed palette={colors} flex={1}>
            {document.motif}
          </Boxed>
        </FieldLine>

        <FieldLine label="Règlement" palette={colors} marginBottom={0}>
          <Boxed palette={colors} width={110} align="center">
            {METHOD_LABELS[document.paymentMethod] ?? document.paymentMethod}
          </Boxed>
          <Boxed palette={colors} flex={1}>
            {document.paymentReference}
          </Boxed>
          <Boxed palette={colors} width={86} align="center">
            {shortDate(document.date)}
          </Boxed>
        </FieldLine>
      </FieldGroup>

      {/* ---------------------------------------------------------------- */}

      <SectionBar palette={colors} marginTop={2}>
        Pièces réglées
      </SectionBar>

      <TableFrame palette={colors}>
        <View fixed>
          <TableHeader columns={COLUMNS} palette={colors} />
        </View>
        {rows.map((cells, index) => (
          <TableRow
            key={`${cells[0]}-${index}`}
            columns={COLUMNS}
            cells={cells}
            palette={colors}
            zebra={index % 2 === 1}
          />
        ))}
      </TableFrame>

      <View
        style={{ flexDirection: "row", alignItems: "flex-start" }}
        wrap={false}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.label}>Arrêté le présent bon à la somme de</Text>
          {/* Generated from the figure, never stored beside it: an amount and
              its words that can disagree is a document that can be disputed. */}
          <Text
            style={{
              ...styles.legal,
              fontWeight: 700,
              fontSize: 8.4,
              marginTop: 3,
            }}
          >
            {amountInWords(Math.round(document.amount))}
          </Text>

          {annexeCount > 0 ? (
            <Text style={{ ...styles.meta, marginTop: 6, lineHeight: 1.5 }}>
              {`${annexeCount} facture${annexeCount > 1 ? "s" : ""} détaillée${
                annexeCount > 1 ? "s" : ""
              } en annexe du présent bon.`}
            </Text>
          ) : null}
          {document.invoices.length > annexeCount ? (
            <Text style={{ ...styles.meta, lineHeight: 1.5 }}>
              {`${document.invoices.length - annexeCount} facture${
                document.invoices.length - annexeCount > 1 ? "s" : ""
              } reçue${
                document.invoices.length - annexeCount > 1 ? "s" : ""
              } du prestataire, pièce originale jointe séparément.`}
            </Text>
          ) : null}
        </View>

        <TotalsBlock
          palette={colors}
          width={236}
          rows={[
            {
              label: "Net à décaisser",
              value: fcfa(document.amount),
              strong: true,
            },
          ]}
        />
      </View>

      {/* ---------------------------------------------------------------- */}

      <VisaRow palette={colors} visas={visas} height={66} />

      <Text
        style={{
          ...styles.meta,
          marginTop: 8,
          borderTopWidth: RULE.hair,
          borderTopColor: colors.hair,
          borderTopStyle: "solid",
          paddingTop: 3,
          fontSize: TYPE.meta,
        }}
      >
        {`Saisi par ${document.enteredBy?.name ?? "—"} le ${shortDate(document.createdAt)}. ` +
          `Le visa réception est manuscrit : il est apposé par le bénéficiaire au moment de la remise.`}
      </Text>

      <Footer
        destination="Original — comptabilité"
        reference={`Bon de décaissement ${document.number}`}
        palette={colors}
      />
    </Page>
  )
}

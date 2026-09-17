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
} from "@/server/pdf/chrome"
import type { FittedImage } from "@/server/pdf/images"
import { amountInWords } from "@/server/domain/ipm/amount-in-words"
import { RULE, TYPE, baseStyles, fcfa, shortDate } from "@/server/pdf/theme"
import type { ProviderInvoiceDocument } from "@/server/queries/ipm/documents"

/**
 * La facture prestataire.
 *
 * Two documents wearing one template, and the difference between them is the
 * whole point of the feature:
 *
 * - **RECEIVED** — the provider sent a paper invoice, somebody typed the
 *   total, and the institution's job is to find the écart between what is
 *   claimed and what the bons actually came to. It has a claimed figure, a
 *   matched figure, and usually no detail at all.
 * - **GENERATED** — the institution edited the invoice itself, from the
 *   consommation constatée. It has a line per bon, and its total *is* the sum
 *   of those lines, so there is no écart to find: the two numbers come from
 *   one source. This is the document that is sent to the prestataire, and the
 *   one that rides along as the annexe of a bon de décaissement.
 *
 * The same page prints both because a clerk comparing the two should not also
 * have to translate between two layouts. What changes is what the header calls
 * it, whether the écart block appears, and whether there is a table.
 *
 * ## Pagination
 *
 * A month at a busy clinic is hundreds of bons, so the table pages. The header
 * row is `fixed`, so every sheet carries its own column headings — a
 * continuation page of unlabelled numbers is unusable, and it is the first
 * thing that breaks when a form designed for one page meets real data.
 */

const COLUMNS: Column[] = [
  { key: "date", header: "Date", flex: 1.15 },
  { key: "voucher", header: "Bon n°", flex: 1.4 },
  { key: "beneficiary", header: "Bénéficiaire", flex: 2.9 },
  { key: "matricule", header: "Matricule", flex: 1.15 },
  { key: "category", header: "Catégorie", flex: 1.7 },
  { key: "total", header: "Montant", flex: 1.4, align: "right" },
  { key: "share", header: "Part IPM", flex: 1.4, align: "right" },
]

export type InvoiceAssets = {
  letterhead: FittedImage | null
  stamp: FittedImage | null
  /** The signature of whoever checked the invoice, when they have one. */
  checkerSignature: FittedImage | null
}

export function ProviderInvoicePdf({
  document,
  assets,
  printedBy,
  printedAt = new Date(),
}: {
  document: ProviderInvoiceDocument
  assets: InvoiceAssets
  printedBy: string | null
  printedAt?: Date
}) {
  return (
    <Document
      title={`Facture ${document.number} — ${document.provider.name}`}
      author={document.firm.name}
      subject={`Période du ${shortDate(document.periodFrom)} au ${shortDate(document.periodTo)}`}
      creator={document.firm.name}
      producer={document.firm.name}
    >
      <InvoicePage
        document={document}
        assets={assets}
        printedBy={printedBy}
        printedAt={printedAt}
      />
    </Document>
  )
}

/**
 * The invoice as a page, so a bon de décaissement can carry it.
 *
 * `annexe` changes two things and nothing else: the title says what it is
 * attached to, and the visa row is dropped — a document already signed as part
 * of the bon it is annexed to must not present a second empty signature block
 * for somebody to sign again.
 */
export function InvoicePage({
  document,
  assets,
  printedBy,
  printedAt,
  annexe,
}: {
  document: ProviderInvoiceDocument
  assets: InvoiceAssets
  printedBy: string | null
  printedAt: Date
  annexe?: { of: string }
}) {
  const { colors, styles } = baseStyles(document.firm.themeColor)
  const generated = document.origin === "GENERATED"

  // What the institution owes: its own share, never the gross. The gross is
  // printed too, because the participant's share is what the provider already
  // collected at the counter and the provider needs to see the arithmetic.
  const netPayable = document.totalAmount
  const grossCare = document.lines.reduce((sum, line) => sum + line.totalAmount, 0)
  const atCounter = document.lines.reduce((sum, line) => sum + line.memberShare, 0)
  const dueDate = new Date(document.receivedDate)
  dueDate.setDate(dueDate.getDate() + document.provider.paymentTermDays)

  return (
    <Page size="A4" style={styles.page}>
      <Letterhead
        letterhead={assets.letterhead}
        firmName={document.firm.name}
        palette={colors}
        meta={{
          createdAt: document.createdAt,
          createdBy: null,
          printedAt,
          printedBy,
        }}
      />

      <TitleRow
        copy={null}
        title={generated ? "Facture prestataire" : "Facture reçue"}
        number={document.number}
        palette={colors}
      />

      <Band
        palette={colors}
        lines={[
          `Période du ${shortDate(document.periodFrom)} au ${shortDate(document.periodTo)}`,
          generated
            ? "Établie par l'institution d'après la consommation constatée sur la période."
            : "Reçue du prestataire et rapprochée des bons émis sur la période.",
        ]}
      />

      {annexe ? (
        <Notice palette={colors} tone="muted">
          {`Annexe au bon de décaissement n° ${annexe.of}.`}
        </Notice>
      ) : null}

      {document.status === "REJECTED" ? (
        <Notice palette={colors}>
          {`Facture rejetée${document.rejectReason ? ` — ${document.rejectReason}` : ""}.`}
        </Notice>
      ) : null}

      <SectionBar palette={colors} marginTop={2}>
        Prestataire
      </SectionBar>

      <FieldGroup palette={colors}>
        <FieldLine label="Raison sociale" palette={colors}>
          <Boxed palette={colors} width={62} align="center">
            {document.provider.code ?? "—"}
          </Boxed>
          <Boxed palette={colors} flex={1} tone="accent" align="center">
            {document.provider.name}
          </Boxed>
        </FieldLine>

        <FieldLine label="Adresse" palette={colors}>
          <Boxed palette={colors} flex={1}>
            {document.provider.address}
          </Boxed>
          <Boxed palette={colors} width={96} align="center">
            {document.provider.phone}
          </Boxed>
        </FieldLine>

        <FieldLine label="Compte" palette={colors} marginBottom={0}>
          <Boxed palette={colors} width={80} align="center">
            {document.provider.accountCode}
          </Boxed>
          <Boxed palette={colors} flex={1}>
            {document.provider.bankName
              ? `${document.provider.bankName}${
                  document.provider.bankAccount
                    ? ` — ${document.provider.bankAccount}`
                    : ""
                }`
              : null}
          </Boxed>
        </FieldLine>
      </FieldGroup>

      {/* ---------------------------------------------------------------- */}

      {document.lines.length > 0 ? (
        <TableFrame palette={colors}>
          {/* `fixed` repeats the headings on every continuation page. */}
          <View fixed>
            <TableHeader columns={COLUMNS} palette={colors} />
          </View>
          {document.lines.map((line, index) => (
            <TableRow
              key={line.voucherNumber}
              columns={COLUMNS}
              palette={colors}
              zebra={index % 2 === 1}
              cells={[
                shortDate(line.serviceDate),
                line.voucherNumber,
                line.beneficiaryName,
                line.memberMatricule,
                line.categoryLabel,
                fcfa(line.totalAmount),
                fcfa(line.insurerShare),
              ]}
            />
          ))}
        </TableFrame>
      ) : (
        <Notice palette={colors} tone="muted">
          Facture sans détail : le prestataire a transmis un montant global. Le
          rapprochement ci-dessous porte sur les bons réglés de la période.
        </Notice>
      )}

      <View style={{ flexDirection: "row", alignItems: "flex-start" }} wrap={false}>
        <View style={{ flex: 1, paddingRight: 12, paddingTop: 2 }}>
          <Text style={styles.label}>Arrêtée la présente facture à la somme de</Text>
          <Text
            style={{
              ...styles.legal,
              fontWeight: 700,
              marginTop: 3,
              marginBottom: 6,
            }}
          >
            {amountInWords(Math.round(netPayable))}
          </Text>

          <Text style={{ ...styles.meta, lineHeight: 1.5 }}>
            {`Règlement à ${document.provider.paymentTermDays} jours — échéance le ${shortDate(dueDate)}.`}
          </Text>
          {document.lines.length > 0 ? (
            <Text style={{ ...styles.meta, lineHeight: 1.5 }}>
              {`${document.lines.length} bon${document.lines.length > 1 ? "s" : ""} réglé${
                document.lines.length > 1 ? "s" : ""
              } sur la période, détaillés ci-dessus.`}
            </Text>
          ) : null}
        </View>

        <TotalsBlock
          palette={colors}
          width={252}
          rows={[
            ...(generated
              ? [
                  { label: "Montant des soins", value: fcfa(grossCare) },
                  // What the participant already paid at the counter. Printed
                  // because the difference between the gross and the net is
                  // the single thing a provider queries, and leaving them to
                  // derive it is how a facture comes back unpaid.
                  { label: "Réglé au comptoir", value: fcfa(atCounter) },
                ]
              : [
                  { label: "Montant réclamé", value: fcfa(document.totalAmount) },
                  {
                    label: "Bons rapprochés",
                    value: fcfa(document.matchedAmount),
                  },
                ]),
            {
              label: generated ? "Net à payer" : "Écart",
              value: fcfa(generated ? netPayable : document.variance),
              strong: true,
            },
          ]}
        />
      </View>

      {!generated && document.variance !== 0 ? (
        <Text
          style={{
            ...styles.meta,
            color: document.variance > 0 ? colors.alert : colors.ok,
            marginTop: 4,
            textAlign: "right",
          }}
        >
          {document.variance > 0
            ? "Le prestataire réclame plus que la somme des bons réglés sur la période."
            : "Le prestataire réclame moins que la somme des bons réglés sur la période."}
        </Text>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      {annexe ? null : (
        <VisaRow
          palette={colors}
          height={56}
          visas={[
            {
              title: "Le prestataire",
              hint: "Signature et cachet",
            },
            {
              title: "Contrôle IPM",
              name: document.checkedBy,
              at: document.checkedAt,
              signature: assets.checkerSignature,
            },
            {
              title: `Pour ${document.firm.name}`,
              stamp: assets.stamp,
            },
          ]}
        />
      )}

      {document.disbursementNumber ? (
        <Text
          style={{
            ...styles.meta,
            marginTop: 6,
            borderTopWidth: RULE.hair,
            borderTopColor: colors.hair,
            borderTopStyle: "solid",
            paddingTop: 3,
            fontSize: TYPE.meta,
          }}
        >
          {`Réglée par le bon de décaissement n° ${document.disbursementNumber}.`}
        </Text>
      ) : null}

      <Footer
        destination={annexe ? "Annexe — détail de la facture" : null}
        reference={`Facture ${document.number} · ${document.provider.name}`}
        palette={colors}
      />
    </Page>
  )
}

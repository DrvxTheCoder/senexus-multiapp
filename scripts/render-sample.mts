/**
 * Rend un exemplaire de chaque document, pour les regarder.
 *
 * Not a test — there is no assertion here. It exists because a form is a
 * visual artefact and the only way to know whether a box is in the right place
 * is to produce one. Run it, open `out/`, and look.
 *
 *   npx vite-node -c vitest.config.ts scripts/render-sample.mts
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { createElement as h } from "react"
import { renderToBuffer } from "@react-pdf/renderer"

import { registerDocumentFonts } from "@/server/pdf/fonts"
import { qrImage } from "@/server/pdf/images"
import { DisbursementPdf } from "@/server/pdf/templates/disbursement"
import { ProviderInvoicePdf } from "@/server/pdf/templates/provider-invoice"
import { VoucherPdf } from "@/server/pdf/templates/voucher"
import type {
  DisbursementDocument,
  ProviderInvoiceDocument,
  VoucherDocument,
} from "@/server/queries/ipm/documents"

registerDocumentFonts()
mkdirSync("out", { recursive: true })

const firm = {
  name: "IPM Tawfeikh",
  letterhead: null,
  stamp: null,
  themeColor: "#0b5d53",
}

/* ---- bons --------------------------------------------------------------- */

const voucher: VoucherDocument = {
  firm,
  number: "BPI005428",
  type: "PHARMACY",
  status: "ISSUED",
  issueDate: new Date("2026-09-09"),
  expiryDate: new Date("2026-10-09"),
  createdAt: new Date("2026-09-09T11:40:00"),
  settledAt: null,
  cancelledAt: null,
  cancelReason: null,
  member: {
    name: "MBEGUERE Sidy",
    matricule: "02846",
    legacyCode: "004-2846",
    employerName: "TOUBA GAZ BOUTEILLE",
    employerCode: "004",
  },
  beneficiary: { name: "MBEGUERE Sidy", kind: "Participant", age: 38 },
  provider: {
    name: "Pharmacie Albis",
    code: "06002",
    address: "Fass Mbao, Dakar",
    phone: "33 825 69 37",
    specialty: "Pharmacie",
    paymentTermDays: 60,
  },
  service: { category: "Pharmacie", type: "Médicaments prescrits" },
  totalAmount: 47500,
  insurerShare: 38000,
  memberShare: 9500,
  appliedRate: 0.8,
  lines: [
    { label: "AMOXICILLINE 500 mg, boîte de 12", quantity: 2, unitPrice: 3500, amount: 7000, code: "AMX500" },
    { label: "PARACETAMOL 1 g, boîte de 8", quantity: 1, unitPrice: 2500, amount: 2500, code: "PCM1G" },
    { label: "SIROP ANTITUSSIF 125 ml", quantity: 1, unitPrice: 38000, amount: 38000, code: null },
  ],
  qrToken: "m7kqfvo02846Gv7xQ2mNpL4sT8yB",
  issuedBy: "Rokhaya Diop",
}

const qr = await qrImage(`https://ipm.senexus.app/v/${voucher.qrToken}`)

const NUMBERS: Record<VoucherDocument["type"], string> = {
  PHARMACY: "BPI005428",
  OPTICAL: "BCI000208",
  GUARANTEE: "LGI009310",
  HOSPITALIZATION: "LHI000023",
}

for (const [type, name] of [
  ["PHARMACY", "pharmacie"],
  ["OPTICAL", "optique"],
  ["GUARANTEE", "garantie"],
  ["HOSPITALIZATION", "hospitalisation"],
] as const) {
  const buffer = await renderToBuffer(
    h(VoucherPdf, {
      document: { ...voucher, type, number: NUMBERS[type] },
      assets: { letterhead: null, stamp: null, qr, issuerSignature: null },
      printedBy: "moussa",
    }) as never
  )
  writeFileSync(`out/bon-${name}.pdf`, buffer)
  console.log(`out/bon-${name}.pdf`.padEnd(32), buffer.length)
}

/* ---- facture ------------------------------------------------------------ */

const names = [
  "CISS Rokhaya Marie", "GUENE Awa Laye", "NGALA Angelia Océane",
  "MBEGUERE Sidy", "DIALLO Fatoumata", "SOW Mamadou", "BA Aminata",
  "FALL Ibrahima", "NDIAYE Khady", "SARR Ousmane", "THIAM Bineta",
  "CAMARA Moussa", "GUEYE Astou", "DIOUF Cheikh", "SECK Mariama",
]

const invoice: ProviderInvoiceDocument = {
  firm,
  id: "inv1",
  number: "FACT-2026-00012",
  origin: "GENERATED",
  status: "APPROVED",
  receivedDate: new Date("2026-09-01"),
  periodFrom: new Date("2026-08-01"),
  periodTo: new Date("2026-08-31"),
  createdAt: new Date("2026-09-01T09:15:00"),
  provider: {
    name: "Clinique de l'Océan",
    code: "08006",
    address: "Corniche Ouest, Dakar",
    phone: "33 825 69 37",
    accountCode: "401006",
    bankName: "CBAO",
    bankAccount: "SN012 01001 000123456789 21",
    paymentTermDays: 60,
  },
  totalAmount: 0,
  matchedAmount: 0,
  variance: 0,
  lines: names.flatMap((name, index) =>
    Array.from({ length: 2 }, (_, k) => {
      const total = 12000 + index * 1500 + k * 4000
      const insurer = Math.round(total * 0.8)
      return {
        voucherNumber: `LGI0093${String(10 + index * 2 + k).padStart(2, "0")}`,
        serviceDate: new Date(2026, 7, 1 + ((index * 2 + k) % 28)),
        beneficiaryName: name,
        memberMatricule: `0${1700 + index}`,
        categoryLabel: k === 0 ? "Consultation" : "Pharmacie",
        totalAmount: total,
        insurerShare: insurer,
        memberShare: total - insurer,
      }
    })
  ),
  checkedBy: "Moussa Fall",
  checkedAt: new Date("2026-09-02T10:00:00"),
  rejectReason: null,
  disbursementNumber: null,
}
invoice.totalAmount = invoice.lines.reduce((sum, line) => sum + line.insurerShare, 0)
invoice.matchedAmount = invoice.totalAmount

const invoiceBuffer = await renderToBuffer(
  h(ProviderInvoicePdf, {
    document: invoice,
    assets: { letterhead: null, stamp: null, checkerSignature: null },
    printedBy: "moussa",
  }) as never
)
writeFileSync("out/facture-prestataire.pdf", invoiceBuffer)
console.log("out/facture-prestataire.pdf".padEnd(32), invoiceBuffer.length)

/* ---- bon de décaissement ------------------------------------------------ */

const disbursement: DisbursementDocument = {
  firm,
  id: "dec1",
  number: "0042",
  date: new Date("2026-09-05"),
  createdAt: new Date("2026-09-04T16:20:00"),
  journalCode: "B1",
  status: "POSTED",
  payeeType: "PROVIDER",
  payeeName: "Clinique de l'Océan",
  amount: invoice.totalAmount,
  motif: "Règlement des prestations du mois d'août 2026",
  paymentMethod: "TRANSFER",
  paymentReference: "VIR-2026-0912",
  enteredBy: { name: "Rokhaya Diop", signature: null },
  approvedBy: { name: "Abdoulaye Tawfeikh", signature: null },
  approvedAt: new Date("2026-09-05T09:30:00"),
  accountingBy: { name: "Moussa Fall", signature: null },
  accountingAt: new Date("2026-09-05T14:05:00"),
  receivedAt: null,
  lines: [
    {
      label: `Facture ${invoice.number} — ${invoice.provider.name}`,
      amount: invoice.totalAmount,
      sourceType: "INVOICE",
    },
  ],
  invoices: [{ ...invoice, disbursementNumber: "0042" }],
  reimbursements: [],
}

const disbursementBuffer = await renderToBuffer(
  h(DisbursementPdf, {
    document: disbursement,
    assets: {
      letterhead: null,
      stamp: null,
      approvedSignature: null,
      accountingSignature: null,
    },
    printedBy: "moussa",
  }) as never
)
writeFileSync("out/bon-decaissement.pdf", disbursementBuffer)
console.log("out/bon-decaissement.pdf".padEnd(32), disbursementBuffer.length)

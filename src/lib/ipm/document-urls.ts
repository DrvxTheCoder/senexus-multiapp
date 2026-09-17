/**
 * Où vivent les documents imprimables.
 *
 * Isomorphic, and one definition per document, because these paths have a trap
 * in them: the PDF routes sit under `/{firm}/api/ipm/…` while the **screen**
 * that links to them sits under `/{firm}/ipm/…`, one segment apart. Written by
 * hand at each call site, the `api` is exactly the segment that gets dropped —
 * and the failure is a 404 that renders as the application's own not-found
 * page, so it looks like a missing row rather than a wrong URL.
 *
 * The card route already follows this shape (`/{firm}/api/ipm/cards/…`); these
 * join it rather than inventing a second convention.
 */

const base = (firmSlug: string) => `/${firmSlug}/api/ipm`

/** Le bon de prise en charge, en trois exemplaires. */
export function voucherPdfUrl(firmSlug: string, voucherId: string): string {
  return `${base(firmSlug)}/bons/${voucherId}/pdf`
}

/** La facture prestataire — reçue ou éditée par l'institution. */
export function providerInvoicePdfUrl(
  firmSlug: string,
  invoiceId: string
): string {
  return `${base(firmSlug)}/factures/${invoiceId}/pdf`
}

/** Le bon de décaissement, factures éditées annexées. */
export function disbursementPdfUrl(
  firmSlug: string,
  disbursementId: string
): string {
  return `${base(firmSlug)}/decaissements/${disbursementId}/pdf`
}

/**
 * Alertes de seuil — plan §5, §4.8bis.
 *
 * The rule the plan is explicit about, and the one most likely to be "improved"
 * into something worse:
 *
 *   **Crossing a threshold raises an alert. It never blocks automatically.
 *   The decision stays human.**
 *
 * There is exactly one exception, and it is not a threshold: unpaid
 * contributions past the employer's own `suspensionDelayDays` do block
 * issuance, because that is a term of the agreement rather than a risk
 * signal. Everything in this file is advisory.
 *
 * Pure. The caller loads the figures, this decides what is worth saying.
 */

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL"

export type AlertKind =
  | "DEBT_CEILING"
  | "CONSUMPTION_CEILING"
  | "RATIO_BELOW_ONE"
  | "INVOICE_OVERDUE"
  | "LEDGER_UNOPENED"
  | "LEDGER_INCOHERENT"
  | "INVOICE_VARIANCE"
  | "CARD_STALE"

export type Alert = {
  kind: AlertKind
  severity: AlertSeverity
  title: string
  /** One sentence naming the consequence, not just the fact. */
  detail: string
  count: number
  /** Where to go and do something about it. */
  href: string | null
}

const money = (value: number) =>
  `${new Intl.NumberFormat("fr-FR").format(Math.round(value))} FCFA`

const plural = (count: number, one: string, many: string) =>
  count > 1 ? many : one

export type AlertInputs = {
  firmSlug: string
  membersOverDebtCeiling: { count: number; total: number }
  employersOverConsumptionCeiling: { count: number; names: string[] }
  employersRatioBelowOne: { count: number; worst: string | null }
  overdueInvoices: { count: number; total: number }
  unopenedLedgers: number
  incoherentLedgers: number
  invoicesWithVariance: { count: number; total: number }
  staleCards: number
}

/**
 * Builds the direction's alert list.
 *
 * Ordered by severity, then by how much money is behind it. An alert list
 * sorted by anything else — recency, alphabet — is a list people stop reading.
 */
export function buildAlerts(inputs: AlertInputs): Alert[] {
  const alerts: Alert[] = []
  const ipm = `/${inputs.firmSlug}/ipm`

  if (inputs.membersOverDebtCeiling.count > 0) {
    alerts.push({
      kind: "DEBT_CEILING",
      severity: "WARNING",
      title: `${inputs.membersOverDebtCeiling.count} ${plural(inputs.membersOverDebtCeiling.count, "participant au-delà", "participants au-delà")} du seuil d'endettement`,
      // Named as advisory on purpose: the plan says the decision is human.
      detail: `${money(inputs.membersOverDebtCeiling.total)} de solde négatif cumulé. Aucun blocage automatique : la décision revient à la direction.`,
      count: inputs.membersOverDebtCeiling.count,
      href: `${ipm}/cotisations`,
    })
  }

  if (inputs.employersOverConsumptionCeiling.count > 0) {
    alerts.push({
      kind: "CONSUMPTION_CEILING",
      severity: "WARNING",
      title: `${inputs.employersOverConsumptionCeiling.count} ${plural(inputs.employersOverConsumptionCeiling.count, "employeur dépasse", "employeurs dépassent")} son seuil de consommation`,
      // Names *and* the consequence. A list of employers on its own is a fact;
      // what makes it an alert is saying what it means and what it does not.
      detail: `${
        inputs.employersOverConsumptionCeiling.names.slice(0, 3).join(", ") ||
        "Seuil franchi sur la période en cours"
      } — consommation au-delà du plafond convenu. Aucun blocage automatique.`,
      count: inputs.employersOverConsumptionCeiling.count,
      href: `${ipm}/employeurs`,
    })
  }

  if (inputs.employersRatioBelowOne.count > 0) {
    alerts.push({
      kind: "RATIO_BELOW_ONE",
      severity: "WARNING",
      title: `${inputs.employersRatioBelowOne.count} ${plural(inputs.employersRatioBelowOne.count, "employeur consomme", "employeurs consomment")} plus qu'${plural(inputs.employersRatioBelowOne.count, "il ne cotise", "ils ne cotisent")}`,
      detail: inputs.employersRatioBelowOne.worst
        ? `Le plus déficitaire : ${inputs.employersRatioBelowOne.worst}.`
        : "Ratio cotisations / consommation inférieur à 1.",
      count: inputs.employersRatioBelowOne.count,
      href: `${ipm}/employeurs`,
    })
  }

  if (inputs.overdueInvoices.count > 0) {
    alerts.push({
      kind: "INVOICE_OVERDUE",
      severity: "CRITICAL",
      title: `${inputs.overdueInvoices.count} ${plural(inputs.overdueInvoices.count, "facture employeur échue", "factures employeur échues")}`,
      detail: `${money(inputs.overdueInvoices.total)} restant dû au-delà de l'échéance.`,
      count: inputs.overdueInvoices.count,
      href: `${ipm}/factures`,
    })
  }

  if (inputs.invoicesWithVariance.count > 0) {
    alerts.push({
      kind: "INVOICE_VARIANCE",
      severity: "CRITICAL",
      title: `${inputs.invoicesWithVariance.count} ${plural(inputs.invoicesWithVariance.count, "facture prestataire", "factures prestataires")} en écart`,
      detail: `${money(inputs.invoicesWithVariance.total)} réclamés au-delà des bons rapprochés.`,
      count: inputs.invoicesWithVariance.count,
      href: `${ipm}/decaissements`,
    })
  }

  if (inputs.unopenedLedgers > 0) {
    alerts.push({
      kind: "LEDGER_UNOPENED",
      severity: "CRITICAL",
      title: `${inputs.unopenedLedgers} ${plural(inputs.unopenedLedgers, "registre sans solde d'ouverture", "registres sans solde d'ouverture")}`,
      // The most consequential of the lot: every figure below depends on it.
      detail:
        "Tant qu'un solde d'ouverture n'est pas saisi, le solde de ces participants part de zéro et tous les chiffres qui en découlent sont faux.",
      count: inputs.unopenedLedgers,
      href: `${ipm}/cotisations`,
    })
  }

  if (inputs.incoherentLedgers > 0) {
    alerts.push({
      kind: "LEDGER_INCOHERENT",
      severity: "CRITICAL",
      title: `${inputs.incoherentLedgers} ${plural(inputs.incoherentLedgers, "solde en cache incohérent", "soldes en cache incohérents")}`,
      detail:
        "Le solde affiché ne correspond plus à la somme des écritures. Recalculez avant de lire un relevé.",
      count: inputs.incoherentLedgers,
      href: `${ipm}/cotisations`,
    })
  }

  if (inputs.staleCards > 0) {
    alerts.push({
      kind: "CARD_STALE",
      severity: "INFO",
      title: `${inputs.staleCards} ${plural(inputs.staleCards, "carte à regénérer", "cartes à regénérer")}`,
      detail:
        "Le contenu imprimé a changé depuis la dernière génération.",
      count: inputs.staleCards,
      href: `${ipm}/cartes`,
    })
  }

  const weight: Record<AlertSeverity, number> = {
    CRITICAL: 0,
    WARNING: 1,
    INFO: 2,
  }

  return alerts.sort(
    (a, b) => weight[a.severity] - weight[b.severity] || b.count - a.count
  )
}

/* ==========================================================================
 * Ratio
 * ========================================================================== */

/**
 * Cotisations ÷ consommation.
 *
 * Null when nothing was consumed — **not** infinity and not zero. A ratio with
 * no denominator is undefined, and rendering it as either number makes an
 * employer look like the best or the worst in the portfolio when the truth is
 * that they have no claims yet.
 */
export function contributionRatio(
  contributions: number,
  consumption: number
): number | null {
  if (consumption <= 0) return null
  return contributions / consumption
}

export function ratioTone(ratio: number | null): "ok" | "signal" | "alert" {
  if (ratio === null) return "signal"
  if (ratio < 1) return "alert"
  if (ratio < 1.2) return "signal"
  return "ok"
}

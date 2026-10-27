import { formatCurrency, formatCurrencyCompact, formatNumber } from "@/lib/format"

/**
 * How a chart prints its values, named rather than passed as a function: the
 * charts are client components and a server page cannot hand them a closure.
 * Kept out of `charts.tsx` so a server component can format the same way in
 * its captions — a function exported from a client module cannot be called on
 * the server.
 */
export type ChartFormat = "number" | "currency" | "compact" | "percent" | "ratio"

export function formatChartValue(value: number, format: ChartFormat = "number"): string {
  switch (format) {
    case "currency":
      return formatCurrency(value)
    case "compact":
      return formatCurrencyCompact(value)
    case "percent":
      return `${formatNumber(Math.round(value))} %`
    case "ratio":
      return value.toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    default:
      return formatNumber(value)
  }
}

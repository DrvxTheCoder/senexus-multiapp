/**
 * Per-firm brand colour, §4.2.
 *
 * `Firm.themeColor` is not trustworthy: the live data holds hex on one firm
 * (`#10b981`) and a colour *name* on another (`amber`), because the legacy
 * `firmSchema` validated names while the seed wrote hex. We standardise on hex,
 * validate at this boundary, and fall back to the brand token when the value is
 * anything else. The schema is not touched.
 *
 * The result is rendered as a <style> block by the firm layout, so the correct
 * brand is present in the first paint — no client provider, no flash of the
 * wrong colour on navigation.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Names the legacy validator allowed, mapped to the hex we standardise on. */
const NAMED_COLORS: Record<string, string> = {
  amber: "#b45309",
  blue: "#1d4ed8",
  cyan: "#0e7490",
  emerald: "#047857",
  green: "#15803d",
  indigo: "#4338ca",
  orange: "#c2410c",
  purple: "#7e22ce",
  red: "#b91c1c",
  rose: "#be123c",
  slate: "#334155",
  teal: "#0f766e",
  violet: "#6d28d9",
  zinc: "#3f3f46",
}

export type FirmTheme = {
  /** Normalised six-digit hex, or null when the column held nothing usable. */
  hex: string | null
  /** CSS custom property declarations, or null when the default brand applies. */
  css: string | null
}

function expand(hex: string): string {
  const raw = hex.replace("#", "")
  return raw.length === 3
    ? raw
        .split("")
        .map((c) => c + c)
        .join("")
    : raw
}

function srgbToOklch(hex: string): { l: number; c: number; h: number } {
  const raw = expand(hex)
  const toLinear = (value: number) => {
    const v = value / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const r = toLinear(parseInt(raw.slice(0, 2), 16))
  const g = toLinear(parseInt(raw.slice(2, 4), 16))
  const b = toLinear(parseInt(raw.slice(4, 6), 16))

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const chroma = Math.sqrt(A * A + B * B)
  let hue = (Math.atan2(B, A) * 180) / Math.PI
  if (hue < 0) hue += 360

  return { l: L, c: chroma, h: hue }
}

const round = (n: number, places: number) => Number(n.toFixed(places))

/** Normalises whatever the column holds into hex, or null. */
export function normaliseThemeColor(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null // the live data has an empty string on one firm

  if (HEX.test(trimmed)) {
    return `#${expand(trimmed)}`
  }

  return NAMED_COLORS[trimmed] ?? null
}

/**
 * Derives the full brand ramp from one hex so that tint, wash and hover states
 * stay in the same hue family, and picks a readable foreground for the brand
 * surface by lightness rather than by guesswork.
 */
export function buildFirmTheme(value: string | null): FirmTheme {
  const hex = normaliseThemeColor(value)
  if (!hex) return { hex: null, css: null }

  const { l, c, h } = srgbToOklch(hex)
  const L = round(l, 3)
  const C = round(c, 3)
  const H = round(h, 1)

  // Light theme ramp.
  const brand = `oklch(${L} ${C} ${H})`
  const brand2 = `oklch(${round(Math.min(l + 0.07, 0.98), 3)} ${C} ${H})`
  const brandTint = `oklch(${round(0.937, 3)} ${round(Math.min(c * 0.16, 0.03), 3)} ${H})`
  const brandWash = `oklch(${round(0.969, 3)} ${round(Math.min(c * 0.08, 0.016), 3)} ${H})`
  const contrast = l > 0.62 ? `oklch(0.224 0.016 ${H})` : "oklch(0.985 0 0)"

  // Dark theme: same hue, lifted so it reads on a dark ground.
  const darkBrand = `oklch(${round(Math.max(l, 0.62), 3)} ${round(c * 0.92, 3)} ${H})`
  const darkBrand2 = `oklch(${round(Math.max(l + 0.07, 0.7), 3)} ${round(c * 0.9, 3)} ${H})`
  const darkTint = `oklch(0.318 ${round(Math.min(c * 0.45, 0.05), 3)} ${H})`
  const darkWash = `oklch(0.262 ${round(Math.min(c * 0.28, 0.03), 3)} ${H})`
  const darkContrast = `oklch(0.163 0.016 ${H})`

  const css = [
    ":root{",
    `--sx-brand:${brand};`,
    `--sx-brand-2:${brand2};`,
    `--sx-brand-tint:${brandTint};`,
    `--sx-brand-wash:${brandWash};`,
    `--sx-brand-contrast:${contrast};`,
    "}",
    ".dark{",
    `--sx-brand:${darkBrand};`,
    `--sx-brand-2:${darkBrand2};`,
    `--sx-brand-tint:${darkTint};`,
    `--sx-brand-wash:${darkWash};`,
    `--sx-brand-contrast:${darkContrast};`,
    "}",
  ].join("")

  return { hex, css }
}

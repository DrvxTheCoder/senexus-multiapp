import { cn } from "@/lib/utils"

/**
 * A firm's mark: its uploaded logo, or its initials on the brand colour.
 *
 * Two details the live data forces:
 *
 * - `Firm.logo` is an empty string on at least one production row, not null,
 *   so emptiness is treated as absence rather than rendering a broken image.
 * - `themeColor` holds hex on some rows and a colour *name* on others; only a
 *   value that looks like hex is used as a background, otherwise the default
 *   brand token applies.
 *
 * A plain `<img>` rather than `next/image`: logos live on a self-hosted Zipline
 * instance whose host comes from an environment variable, so it cannot be put
 * in a build-time `remotePatterns` allow-list. These are 26px avatars, so the
 * optimiser would buy nothing anyway.
 */
export function FirmLogo({
  name,
  logo,
  themeColor,
  size = 26,
  radius = 7,
  className,
}: {
  name: string
  logo?: string | null
  themeColor?: string | null
  size?: number
  radius?: number
  className?: string
}) {
  const src = logo?.trim() ? logo.trim() : null

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()

  const isHex = Boolean(themeColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(themeColor.trim()))

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external host from env; see note above
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cn("shrink-0 border border-line object-cover", className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center font-semibold text-brand-contrast",
        className
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.max(9, size * 0.4),
        background: isHex ? (themeColor as string) : "var(--sx-brand)",
      }}
    >
      {initials}
    </span>
  )
}

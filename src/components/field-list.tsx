import * as React from "react"

import { cn } from "@/lib/utils"

export type Field = {
  label: string
  value: React.ReactNode
  /** Identifiers get the mono treatment (§4.3). */
  mono?: boolean
  /** A value the record needs but does not have — shown as a gap, not a dash. */
  missing?: boolean
}

/**
 * §4.6 — the label/value list used across record panels.
 *
 * A missing value that *matters* is rendered in ochre with what is absent
 * named, rather than an em dash: "Non renseignée" tells a records officer there
 * is work to do, where "—" reads as "not applicable".
 */
export function FieldList({ fields }: { fields: Field[] }) {
  return (
    <dl className="mt-1">
      {fields.map((field) => (
        <div
          key={field.label}
          className="grid grid-cols-[112px_1fr] gap-3 border-b border-line py-1.5 text-[13px] last:border-b-0"
        >
          <dt className="text-[12.5px] text-ink-3">{field.label}</dt>
          <dd
            className={cn(
              "min-w-0 break-words",
              field.mono && "mono",
              field.missing && "text-signal"
            )}
          >
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

"use client"

import { useState } from "react"

import { Field } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { HugeiconsIcon } from "@hugeicons/react"
import { MultiplicationSignIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons"

const items = [
  { label: "Select an option", value: null },
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Blueberry", value: "blueberry" },
  { label: "Grapes", value: "grapes" },
  { label: "Pineapple", value: "pineapple" },
  { label: "Strawberry", value: "strawberry" },
]

export function Pattern() {
  const [value, setValue] = useState<string | null>(null)

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setValue(null)
  }

  return (
    <Field className="max-w-xs">
      <Select value={value} onValueChange={setValue} items={items}>
        <SelectTrigger className="w-[200px] [&>svg:last-child]:hidden!">
          <SelectValue />
          {value ? (
            <div
              role="button"
              onClick={handleClear}
              className="text-muted-foreground hover:text-foreground flex size-4 items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none"
            >
              <HugeiconsIcon icon={MultiplicationSignIcon} strokeWidth={2} className="size-4" />
              <span className="sr-only">Clear selection</span>
            </div>
          ) : (
            <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="text-muted-foreground size-4" />
          )}
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {items.slice(1).map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
// @vitest-environment jsdom
import * as React from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ComboboxField, type ComboboxOption } from "@/components/forms/combobox-field"

/**
 * The searchable select, for fields whose list is a register rather than an
 * enumeration — participants, employers.
 *
 * What matters and is pinned here: the form still stores an **id string**, and
 * the second line (matricule, plan code) is searchable even though the name is
 * what reads. Both only exist once the popup opens, which no HTTP check can
 * reach.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver ??= ResizeObserverStub as never
  // Base UI positions its popup with these; jsdom has neither.
  Element.prototype.scrollIntoView ??= vi.fn() as never
})

afterEach(cleanup)

const MEMBERS: ComboboxOption[] = [
  { value: "m-1", label: "Fatou Diop", hint: "IPM0001" },
  { value: "m-2", label: "Abdou Touré", hint: "IPM0002" },
  { value: "m-3", label: "Awa Fall", hint: "IPM0042" },
]

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = React.useState(initial)
  return (
    <>
      <ComboboxField
        id="participant"
        label="Participant"
        value={value}
        onChange={setValue}
        options={MEMBERS}
        placeholder="Nom ou matricule"
        emptyLabel="Aucun participant."
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

const trigger = () => screen.getByRole("combobox", { name: /Participant/i })

/**
 * Opens the popup and returns its search box.
 *
 * The search input carries `role="combobox"` — the ARIA pattern makes the
 * *input* the combobox, so the trigger and the box share a role once open, and
 * the placeholder is what tells them apart.
 */
async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  // The popup mounts asynchronously; the options are the signal it is there.
  await screen.findByRole("listbox")
  return screen.getByPlaceholderText("Nom ou matricule")
}

describe("ComboboxField", () => {
  it("shows the placeholder until something is chosen", () => {
    render(<Harness />)
    expect(screen.getByText("Nom ou matricule")).toBeTruthy()
    expect(screen.getByTestId("value").textContent).toBe("")
  })

  it("stores the id, not the label", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(trigger())
    await user.click(await screen.findByRole("option", { name: /Abdou Touré/ }))

    await waitFor(() =>
      expect(screen.getByTestId("value").textContent).toBe("m-2")
    )
  })

  it("filters on the name", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(await openSearch(user), "Awa")

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
    expect(screen.getByRole("option", { name: /Awa Fall/ })).toBeTruthy()
  })

  it("filters on the matricule, which is the whole point of the hint", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(await openSearch(user), "IPM0042")

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
    expect(screen.getByRole("option", { name: /Awa Fall/ })).toBeTruthy()
  })

  it("matches on an accent the user did not type", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(await openSearch(user), "toure")

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
    expect(screen.getByRole("option", { name: /Abdou Touré/ })).toBeTruthy()
  })

  it("says so when nothing matches, rather than showing an empty box", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(await openSearch(user), "zzzz")

    expect(await screen.findByText("Aucun participant.")).toBeTruthy()
  })

  it("renders the selection it was given", () => {
    render(<Harness initial="m-3" />)
    expect(screen.getByText("Awa Fall")).toBeTruthy()
    expect(screen.getByText("IPM0042")).toBeTruthy()
  })
})

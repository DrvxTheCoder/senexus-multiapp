// @vitest-environment jsdom
import * as React from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { FirmsTable } from "@/app/admin/firms/firms-table"
import type { AdminFirm } from "@/app/admin/firms/page"

/**
 * Le dialogue entreprise, qui n'existe qu'après un clic.
 *
 * The form had grown to nine controls in one column — three of them drop zones
 * — and was split into two tabs. None of that is reachable by a build, a
 * typecheck or an HTTP probe: the dialog mounts in the browser, and the second
 * panel only exists once somebody presses its tab.
 *
 * What is pinned here is the part that would fail silently: that each field is
 * on the panel it is supposed to be on, that switching panels does **not**
 * discard what was typed on the other, and that an error on the panel that is
 * off screen is pointed at rather than hidden — which is the failure mode a
 * tabbed form invents, where the save button reads as broken.
 */

const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => "/admin/firms",
}))

const createFirm = vi.fn(async () => ({ ok: true as const, data: undefined }))
const updateFirm = vi.fn(async () => ({ ok: true as const, data: undefined }))

vi.mock("@/server/actions/admin", () => ({
  createFirm: (...args: unknown[]) => createFirm(...(args as [])),
  updateFirm: (...args: unknown[]) => updateFirm(...(args as [])),
  deleteFirm: vi.fn(),
}))

// Nothing here asserts on toasts; they would otherwise need a live Sonner
// portal in jsdom.
vi.mock("@/lib/toast", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
  SAVED: "Enregistré.",
}))

// The uploader never runs in these tests — no file is chosen — but the module
// imports a server action, which must not be pulled into jsdom.
vi.mock("@/components/forms/resolve-asset", () => ({
  resolveAssets: vi.fn(async () => ({
    ok: true,
    urls: { logo: null, letterhead: null, stamp: null },
  })),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver ??= ResizeObserverStub as never
  Element.prototype.scrollIntoView ??= vi.fn() as never
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const FIRM: AdminFirm = {
  id: "firm-1",
  name: "IPM Tawfeikh",
  slug: "ipm-tawfeikh",
  logo: null,
  letterhead: null,
  stamp: null,
  themeColor: "#0b5d53",
  matriculePrefix: "IT",
  prefixIsDefault: false,
  employees: 0,
  clients: 0,
  members: 4,
  modules: ["ipm"],
}

/**
 * The value of a labelled input.
 *
 * `toHaveValue` belongs to `@testing-library/jest-dom`, which this repository
 * does not install — one helper is cheaper than a matcher library pulled in
 * for six assertions.
 */
function valueOf(matcher: RegExp): string {
  return (screen.getByLabelText(matcher) as HTMLInputElement).value
}

async function openEditDialog() {
  const user = userEvent.setup()
  render(<FirmsTable firms={[FIRM]} />)
  await user.click(screen.getByRole("button", { name: /Modifier IPM Tawfeikh/ }))
  await screen.findByRole("dialog")
  return user
}

describe("the firm dialog's two panels", () => {
  it("opens on Identité, with the fields an operator edits every time", async () => {
    await openEditDialog()

    expect(valueOf(/^Nom/)).toBe("IPM Tawfeikh")
    expect(valueOf(/^Identifiant/)).toBe("ipm-tawfeikh")
    expect(valueOf(/Préfixe de matricule/)).toBe("IT")
    expect(valueOf(/Couleur de marque/)).toBe("#0b5d53")

    // The print assets are on the other panel and must not be mounted here.
    expect(screen.queryByLabelText(/En-tête des documents/)).toBeNull()
    expect(screen.queryByLabelText(/^Cachet/)).toBeNull()
  })

  it("shows the printed assets on the second panel, and only there", async () => {
    const user = await openEditDialog()
    await user.click(screen.getByRole("radio", { name: "Documents imprimés" }))

    expect(screen.getByLabelText(/En-tête des documents/)).toBeTruthy()
    expect(screen.getByLabelText(/^Cachet/)).toBeTruthy()
    expect(screen.queryByLabelText(/^Nom/)).toBeNull()
  })

  it("keeps what was typed on the panel that is not on screen", async () => {
    // The whole risk of splitting a form: react-hook-form keeps the values of
    // unmounted fields, and this is the assertion that says so out loud.
    const user = await openEditDialog()

    const name = screen.getByLabelText(/^Nom/)
    await user.clear(name)
    await user.type(name, "IPM Renommée")

    await user.click(screen.getByRole("radio", { name: "Documents imprimés" }))
    await user.click(screen.getByRole("radio", { name: "Identité" }))

    expect(valueOf(/^Nom/)).toBe("IPM Renommée")
  })

  it("submits both panels' values in one payload", async () => {
    const user = await openEditDialog()

    const prefix = screen.getByLabelText(/Préfixe de matricule/)
    await user.clear(prefix)
    await user.type(prefix, "TW")

    await user.click(screen.getByRole("radio", { name: "Documents imprimés" }))
    await user.click(screen.getByRole("button", { name: "Enregistrer" }))

    await waitFor(() => expect(updateFirm).toHaveBeenCalledTimes(1))
    expect(updateFirm).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "firm-1",
        name: "IPM Tawfeikh",
        slug: "ipm-tawfeikh",
        matriculePrefix: "TW",
      })
    )
  })

  it("names the panel holding an invalid field instead of hiding it", async () => {
    const user = await openEditDialog()

    // A name of one character fails the schema's `min(2)`.
    const name = screen.getByLabelText(/^Nom/)
    await user.clear(name)
    await user.type(name, "X")

    await user.click(screen.getByRole("radio", { name: "Documents imprimés" }))
    await user.click(screen.getByRole("button", { name: "Enregistrer" }))

    // Nothing was sent, and the operator is told where to look rather than
    // left with a button that appears to do nothing.
    await waitFor(() =>
      expect(screen.getByText(/Le champ à corriger est dans/)).toBeTruthy()
    )
    expect(updateFirm).not.toHaveBeenCalled()

    // And the pointer is a control, so it is one click away.
    await user.click(screen.getByRole("button", { name: "Identité" }))
    expect(valueOf(/^Nom/)).toBe("X")
  })

  it("stops pointing at a panel once its field is corrected", async () => {
    const user = await openEditDialog()

    const name = screen.getByLabelText(/^Nom/)
    await user.clear(name)
    await user.type(name, "X")
    await user.click(screen.getByRole("radio", { name: "Documents imprimés" }))
    await user.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() =>
      expect(screen.getByText(/Le champ à corriger est dans/)).toBeTruthy()
    )

    await user.click(screen.getByRole("button", { name: "Identité" }))
    await user.type(screen.getByLabelText(/^Nom/), "Y Corrigé")
    await user.click(screen.getByRole("button", { name: "Enregistrer" }))

    await waitFor(() => expect(updateFirm).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Le champ à corriger est dans/)).toBeNull()
  })
})

// @vitest-environment jsdom
import * as React from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * The import preview.
 *
 * The rule this pins: **choosing a file writes nothing.** The file is read in
 * the browser, validated with the same parser the server uses, and shown back;
 * the import action is not called until one of the two import buttons is
 * pressed. Everything here happens after a click, which is precisely what the
 * HTTP harness cannot reach.
 */

const importEmployees = vi.fn()
const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/connect-interim/hr/employees",
}))

vi.mock("@/server/actions/employees", () => ({
  importEmployees: (...args: unknown[]) => importEmployees(...args),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock") as never
  URL.revokeObjectURL = vi.fn() as never
})

import { ImportEmployeesDialog } from "@/app/[firmSlug]/hr/employees/import-dialog"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const CLIENTS = [{ id: "client-1", name: "Sococim Industries" }]

/**
 * Two rows that import, one blocked for want of a first name, one blocked for
 * an unreadable date, one that needs a term it does not have.
 */
const CSV = [
  "PRENOM,NOM,DATE ENTREE,TYPE CONTRAT,DATE SORTIE,CNI,EMPLOI,NATIONALITE,DATE DE NAISSANCE",
  "Fatou,Diop,05/03/2024,CDI,,1234567890,Technicienne,Sénégalaise,12/05/1990",
  "Abdou,Touré,02/11/2023,INTERIMAIRE,30/06/2024,2234567890,Chauffeur,Sénégalaise,03/08/1985",
  ",Sow,01/01/2024,CDI,,3234567890,Laveuse,Sénégalaise,01/01/1992",
  "Awa,Fall,pas une date,CDI,,4234567890,Réceptionniste,Sénégalaise,07/07/1995",
  "Moussa,Ba,01/02/2024,CDD,,5234567890,Magasinier,Sénégalaise,09/09/1988",
].join("\n")

function file(text = CSV, name = "employes.csv") {
  return new File([text], name, { type: "text/csv" })
}

/** The file input is visually hidden, so it is found by type rather than label. */
function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

describe("ImportEmployeesDialog", () => {
  it("starts on the drop zone and writes nothing", () => {
    render(
      <ImportEmployeesDialog
        firmSlug="connect-interim"
        clients={CLIENTS}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Glissez-déposez un fichier CSV/)).toBeTruthy()
    expect(importEmployees).not.toHaveBeenCalled()
  })

  it("refuses a dropped file that is not a CSV", async () => {
    render(
      <ImportEmployeesDialog
        firmSlug="connect-interim"
        clients={CLIENTS}
        onClose={() => {}}
      />
    )

    // Through the drop, not the picker: the picker carries `accept`, so the
    // browser filters for it. A drag-and-drop does not, which is exactly why
    // the guard exists.
    const zone = screen.getByText(/Glissez-déposez un fichier CSV/).closest("div")!
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [new File(["x"], "notes.txt", { type: "text/plain" })],
      },
    })

    expect(await screen.findByText(/fichier .csv est attendu/)).toBeTruthy()
    expect(importEmployees).not.toHaveBeenCalled()
  })

  it("previews the file, counts it, and still writes nothing", async () => {
    const user = userEvent.setup()
    render(
      <ImportEmployeesDialog
        firmSlug="connect-interim"
        clients={CLIENTS}
        onClose={() => {}}
      />
    )
    await user.upload(fileInput(), file())

    // Two clean rows, three blocked: no first name, unreadable date, and a CDD
    // with no term.
    expect(await screen.findByText("Prêtes")).toBeTruthy()
    const counters = screen.getByText("Lignes").closest("div")!.parentElement!
    expect(within(counters).getByText("5")).toBeTruthy()

    expect(screen.getByText("Fatou")).toBeTruthy()
    expect(screen.getByText("Touré")).toBeTruthy()
    expect(importEmployees).not.toHaveBeenCalled()
  })

  it("names the column and the reason for a blocked row", async () => {
    const user = userEvent.setup()
    render(
      <ImportEmployeesDialog
        firmSlug="connect-interim"
        clients={CLIENTS}
        onClose={() => {}}
      />
    )
    await user.upload(fileInput(), file())

    const details = await screen.findAllByText("détail")
    await user.click(details[0])

    expect(await screen.findByText("PRENOM")).toBeTruthy()
    expect(screen.getByText("Le prénom est obligatoire.")).toBeTruthy()
  })

  it("re-reads the file when the date convention is flipped", async () => {
    const user = userEvent.setup()
    render(
      <ImportEmployeesDialog
        firmSlug="connect-interim"
        clients={CLIENTS}
        onClose={() => {}}
      />
    )
    await user.upload(fileInput(), file())

    // 05/03/2024 is the one row the convention actually changes: 5 March
    // day-first, 3 May month-first. The count of blocked rows does not move,
    // because the parser recovers anything unambiguous — 30/06 can only be a
    // day-first date whatever the setting says.
    expect(await screen.findByText("2024-03-05")).toBeTruthy()

    await user.click(screen.getByLabelText(/Dates jour\/mois/i))

    await waitFor(() => expect(screen.getByText("2024-05-03")).toBeTruthy())
    expect(screen.queryByText("2024-03-05")).toBeNull()
    // Re-reading is not importing.
    expect(importEmployees).not.toHaveBeenCalled()
  })

  it("sends the file's text and the chosen lines, not parsed rows", async () => {
    importEmployees.mockResolvedValue({
      ok: true,
      data: {
        fileRows: 5,
        total: 2,
        excludedLines: [4, 5, 6],
        imported: 2,
        skipped: 0,
        failed: 0,
        unknownHeaders: [],
        rows: [],
      },
    })

    const user = userEvent.setup()
    render(
      <ImportEmployeesDialog
        firmSlug="connect-interim"
        clients={CLIENTS}
        onClose={() => {}}
      />
    )
    await user.upload(fileInput(), file())
    await screen.findByText("Prêtes")

    await user.click(screen.getByRole("button", { name: /Importer les 2 valides/ }))

    await waitFor(() => expect(importEmployees).toHaveBeenCalledTimes(1))
    const payload = importEmployees.mock.calls[0][0] as Record<string, unknown>
    expect(payload.csv).toBe(CSV)
    expect(payload.firmSlug).toBe("connect-interim")
    expect(payload.lines).toEqual([2, 3])
    // The rows themselves are never sent; the server re-reads the same bytes.
    expect(payload).not.toHaveProperty("rows")
  })

  it("accounts for the whole file in the report", async () => {
    importEmployees.mockResolvedValue({
      ok: true,
      data: {
        fileRows: 5,
        total: 2,
        excludedLines: [4, 5, 6],
        imported: 2,
        skipped: 0,
        failed: 0,
        unknownHeaders: [],
        rows: [],
      },
    })

    const user = userEvent.setup()
    render(
      <ImportEmployeesDialog
        firmSlug="connect-interim"
        clients={CLIENTS}
        onClose={() => {}}
      />
    )
    await user.upload(fileInput(), file())
    await screen.findByText("Prêtes")
    await user.click(screen.getByRole("button", { name: /Importer les 2 valides/ }))

    expect(await screen.findByText(/5 lignes dans le fichier/)).toBeTruthy()
    expect(screen.getByText(/3 non retenues/)).toBeTruthy()
  })

  it("surfaces a refusal from the server instead of claiming success", async () => {
    importEmployees.mockResolvedValue({
      ok: false,
      message: "Client introuvable dans cette entreprise.",
    })

    const user = userEvent.setup()
    render(
      <ImportEmployeesDialog
        firmSlug="connect-interim"
        clients={CLIENTS}
        onClose={() => {}}
      />
    )
    await user.upload(fileInput(), file())
    await screen.findByText("Prêtes")
    await user.click(screen.getByRole("button", { name: /Importer les 2 valides/ }))

    expect(
      await screen.findByText("Client introuvable dans cette entreprise.")
    ).toBeTruthy()
    // Still on the preview, so the selection is not lost.
    expect(screen.getByText("Prêtes")).toBeTruthy()
  })
})

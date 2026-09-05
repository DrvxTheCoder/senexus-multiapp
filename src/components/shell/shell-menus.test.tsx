// @vitest-environment jsdom
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * Smoke tests for the parts of the shell that only exist after a click.
 *
 * Every other check in this repository looks at server-rendered HTML or at a
 * server action over HTTP. A popover's content is neither: it mounts in the
 * browser when the trigger is pressed, so a build, a typecheck and an HTTP
 * probe can all pass while the menu throws the moment anyone opens it. That is
 * exactly what happened — Base UI's `GroupLabel` throws outside a `Menu.Group`,
 * and both this menu and the admin console's shipped with the label outside
 * one.
 *
 * These tests open the menus and assert what is inside them. They are not a
 * substitute for looking at the thing; they are the guard against it crashing.
 */

const push = vi.fn()
const setTheme = vi.fn()
const signOut = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin",
}))

vi.mock("next-auth/react", () => ({ signOut: (...args: unknown[]) => signOut(...args) }))

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme }),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// Base UI positions its popups with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never

import { FirmProvider } from "@/components/firm-provider"
import { AdminSidebar } from "@/app/admin/admin-sidebar"
import { DocumentPreviewDialog } from "@/components/document-preview"
import { UserMenu } from "@/components/shell/user-menu"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function withFirm(children: React.ReactNode, canAdminister = true) {
  return (
    <FirmProvider
      value={{
        id: "firm-1",
        slug: "connect-interim",
        name: "Connect Interim",
        logo: null,
        themeHex: "#0b5d53",
        modules: ["hr", "crm", "documents"],
        role: canAdminister ? "ADMIN" : "STAFF",
        memberships: [
          {
            firmId: "firm-1",
            firmSlug: "connect-interim",
            firmName: "Connect Interim",
            role: canAdminister ? "ADMIN" : "STAFF",
            logo: null,
            themeColor: "#0b5d53",
          },
          {
            firmId: "firm-2",
            firmSlug: "synergie-pro",
            firmName: "Synergie Pro",
            role: canAdminister ? "ADMIN" : "STAFF",
            logo: null,
            themeColor: "#2563eb",
          },
        ],
        user: { id: "u1", name: "Awa Ndiaye", email: "awa@senexus.sn" },
      }}
    >
      {children}
    </FirmProvider>
  )
}

describe("UserMenu", () => {
  it("opens without throwing and shows both labelled sections", async () => {
    const user = userEvent.setup()
    render(withFirm(<UserMenu collapsed={false} />))

    await user.click(screen.getByRole("button", { name: "Menu du compte" }))

    expect(await screen.findByText("Entreprises")).toBeTruthy()
    expect(screen.getByText("Compte")).toBeTruthy()
    expect(screen.getByText("Déconnexion")).toBeTruthy()
  })

  it("lists every firm the caller belongs to", async () => {
    const user = userEvent.setup()
    render(withFirm(<UserMenu collapsed={false} />))
    await user.click(screen.getByRole("button", { name: "Menu du compte" }))

    expect(await screen.findByText("Connect Interim")).toBeTruthy()
    expect(screen.getByText("Synergie Pro")).toBeTruthy()
  })

  it("offers the theme as three radios, and setting one does not close the menu", async () => {
    const user = userEvent.setup()
    render(withFirm(<UserMenu collapsed={false} />))
    await user.click(screen.getByRole("button", { name: "Menu du compte" }))

    const group = await screen.findByRole("group", { name: "Thème" })
    const radios = within(group).getAllByRole("menuitemradio")
    expect(radios).toHaveLength(3)

    await user.click(within(group).getByRole("menuitemradio", { name: "Sombre" }))
    expect(setTheme).toHaveBeenCalledWith("dark")
    // Still open: a setting is not a command.
    expect(screen.getByText("Entreprises")).toBeTruthy()
  })

  it("hides the administration entries from someone who is not an admin", async () => {
    const user = userEvent.setup()
    render(withFirm(<UserMenu collapsed={false} />, false))
    await user.click(screen.getByRole("button", { name: "Menu du compte" }))

    await screen.findByText("Entreprises")
    expect(screen.queryByText("Administration")).toBeNull()
    expect(screen.queryByText("Nouvelle entreprise")).toBeNull()
  })
})

describe("AdminSidebar", () => {
  it("opens its account menu without throwing", async () => {
    const user = userEvent.setup()
    render(<AdminSidebar user={{ name: "Awa Ndiaye", email: "awa@senexus.sn" }} />)

    await user.click(screen.getByRole("button", { name: "Menu du compte" }))

    expect(await screen.findByText("Thème")).toBeTruthy()
    expect(screen.getByText("Déconnexion")).toBeTruthy()
  })
})

describe("DocumentPreviewDialog", () => {
  const base = {
    id: "doc-1",
    fileName: "cni-abdou.pdf",
    documentType: "ID_CARD",
    fileSize: 240_000,
    expiryDate: null,
    isVerified: true,
  }

  it("renders nothing until a document is given", () => {
    render(
      <DocumentPreviewDialog
        document={null}
        firmSlug="connect-interim"
        onClose={() => {}}
      />
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("embeds a PDF and offers both ways out, through our own route", async () => {
    render(
      <DocumentPreviewDialog
        document={{ ...base, mimeType: "application/pdf" }}
        firmSlug="connect-interim"
        onClose={() => {}}
      />
    )

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Copie CNI")).toBeTruthy()

    const open = within(dialog).getAllByRole("link", {
      name: /Ouvrir dans un onglet/,
    })[0]
    expect(open.getAttribute("href")).toBe("/connect-interim/api/files/doc-1")

    const download = within(dialog).getAllByRole("link", { name: /Télécharger/ })[0]
    // `?download=1` is what makes the route answer `attachment` instead of
    // `inline`; without it the button would navigate rather than save.
    expect(download.getAttribute("href")).toBe(
      "/connect-interim/api/files/doc-1?download=1"
    )
  })

  it("falls back to the buttons for a type it cannot show", async () => {
    render(
      <DocumentPreviewDialog
        document={{
          ...base,
          fileName: "fiche.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }}
        firmSlug="connect-interim"
        onClose={() => {}}
      />
    )

    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText("Ce type de fichier n'a pas d'aperçu.")
    ).toBeTruthy()
  })

  it("treats a legacy row with no MIME type by its extension", async () => {
    render(
      <DocumentPreviewDialog
        document={{ ...base, fileName: "scan.JPG", mimeType: null }}
        firmSlug="connect-interim"
        onClose={() => {}}
      />
    )

    const dialog = await screen.findByRole("dialog")
    const image = within(dialog).getByRole("img")
    expect(image.getAttribute("src")).toBe("/connect-interim/api/files/doc-1")
  })
})

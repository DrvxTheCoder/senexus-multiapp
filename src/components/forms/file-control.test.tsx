// @vitest-environment jsdom
import * as React from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"

import { FileControl } from "@/components/forms/controls"

/**
 * The rule this pins: **choosing a file uploads nothing.**
 *
 * The file is held in form state and shown back locally; it reaches the server
 * only when the form is submitted. Anything else means picking the wrong scan
 * is discovered after it is already stored.
 */

const created: string[] = []
const revoked: string[] = []

beforeAll(() => {
  // jsdom implements neither.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:mock/${created.length}-${(blob as File).name ?? "blob"}`
    created.push(url)
    return url
  }) as never
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  }) as never
})

afterEach(() => {
  cleanup()
  created.length = 0
  revoked.length = 0
})

function Harness({
  onSubmit,
  accept = "application/pdf,image/png",
}: {
  onSubmit: (values: { file?: File }) => void
  accept?: string
}) {
  const form = useForm<{ file?: File }>({ defaultValues: {} })
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <FileControl form={form} name="file" label="Fichier" accept={accept} />
      <button type="submit">Envoyer</button>
    </form>
  )
}

const png = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "cni.png", { type: "image/png" })

describe("FileControl", () => {
  it("shows the chosen file without sending anything", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    await user.upload(screen.getByLabelText("Fichier"), png())

    expect(await screen.findByText("cni.png")).toBeTruthy()
    // The preview is a local object URL, not a request.
    expect(created).toHaveLength(1)
    // Nothing has been submitted.
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText(/Rien n'est envoyé tant que le formulaire/)
    ).toBeTruthy()
  })

  it("renders an image preview from the local file", async () => {
    const user = userEvent.setup()
    render(<Harness onSubmit={vi.fn()} />)

    await user.upload(screen.getByLabelText("Fichier"), png())

    const image = await screen.findByRole("img", { name: /Aperçu de cni.png/ })
    expect(image.getAttribute("src")).toBe(created[0])
  })

  it("hands the File to the submit handler, once, on submit", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    await user.upload(screen.getByLabelText("Fichier"), png())
    await user.click(screen.getByRole("button", { name: "Envoyer" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const values = onSubmit.mock.calls[0][0] as { file?: File }
    expect(values.file).toBeInstanceOf(File)
    expect(values.file?.name).toBe("cni.png")
  })

  it("lets the choice be withdrawn, and frees the preview", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    await user.upload(screen.getByLabelText("Fichier"), png())
    await screen.findByText("cni.png")

    await user.click(screen.getByRole("button", { name: "Retirer" }))

    expect(screen.queryByText("cni.png")).toBeNull()
    // The object URL is released rather than pinning the file for the tab's
    // lifetime.
    await waitFor(() => expect(revoked).toContain(created[0]))

    await user.click(screen.getByRole("button", { name: "Envoyer" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect((onSubmit.mock.calls[0][0] as { file?: File }).file).toBeUndefined()
  })

  it("says plainly when a type has no preview", async () => {
    const user = userEvent.setup()
    // No `accept` here: the browser would refuse the file before the control
    // ever saw it, which is a different behaviour from the one under test.
    render(<Harness onSubmit={vi.fn()} accept="" />)

    await user.upload(
      screen.getByLabelText("Fichier"),
      new File(["x"], "fiche.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    )

    expect(
      await screen.findByText("Pas d'aperçu pour ce type de fichier.")
    ).toBeTruthy()
  })
})

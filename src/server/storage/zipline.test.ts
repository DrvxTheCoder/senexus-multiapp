import { describe, expect, it } from "vitest"

import { ensureHttps, sanitiseFolder, uploadName } from "@/server/storage/zipline"

/**
 * The two filename rules are not preferences — they are what the deployed
 * Zipline build enforces, and getting either wrong is a 400 that reaches the
 * user as "Le stockage a refusé le fichier".
 */
describe("uploadName", () => {
  it("flattens a path, because a slash is rejected outright", () => {
    // Zipline answers a path-shaped name with
    // `bad options: [x-zipline-filename]: Invalid filename`.
    expect(uploadName("ipm/participants/01704/photo.png")).toBe(
      "ipm_participants_01704_photo"
    )
    expect(uploadName("a\\b\\c.png")).toBe("a_b_c")
  })

  it("strips the extension, because Zipline appends its own", () => {
    // Sent as `photo.png`, the file is stored as `photo.png.png`.
    expect(uploadName("photo.png")).toBe("photo")
    expect(uploadName("scan.jpeg")).toBe("scan")
    expect(uploadName("report.pdf")).toBe("report")
  })

  it("leaves a name that has no extension alone", () => {
    expect(uploadName("no-extension")).toBe("no-extension")
  })

  it("keeps the timestamped document convention readable", () => {
    expect(
      uploadName("connect-interim/employees/EMP001/1700000000-cni.pdf")
    ).toBe("connect-interim_employees_EMP001_1700000000-cni")
  })

  it("never returns an empty name, which Zipline would replace at random", () => {
    expect(uploadName("/")).toBe("file")
    expect(uploadName("")).toBe("file")
  })

  it("produces nothing that would be rejected again", () => {
    for (const key of [
      "ipm/participants/01704/photo (1).png",
      "a b/c d/é.png",
      "///weird///.jpg",
    ]) {
      expect(uploadName(key)).not.toMatch(/[/\\]/)
      expect(uploadName(key).length).toBeGreaterThan(0)
    }
  })
})

describe("sanitiseFolder", () => {
  it("keeps the separators that make a storage key a path", () => {
    expect(sanitiseFolder("ipm/participants/01704")).toBe("ipm/participants/01704")
  })

  it("trims the leading and trailing slashes", () => {
    expect(sanitiseFolder("/ipm/participants/")).toBe("ipm/participants")
  })
})

describe("ensureHttps", () => {
  it("rewrites the scheme Zipline returns, which a browser blocks", () => {
    expect(ensureHttps("http://zipline.example/u/a.png")).toBe(
      "https://zipline.example/u/a.png"
    )
  })

  it("leaves an already-secure URL untouched", () => {
    expect(ensureHttps("https://zipline.example/u/a.png")).toBe(
      "https://zipline.example/u/a.png"
    )
  })
})

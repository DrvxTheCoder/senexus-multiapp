import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// `ActionError` lives beside the back-office action wrapper, which reaches
// next-auth. Nothing here goes through a back-office session, so the session
// layer is stubbed rather than loaded.
vi.mock("@/server/auth/require-firm-access", () => ({
  getSession: vi.fn(),
  requireFirmAccess: vi.fn(),
  requireHoldingAccess: vi.fn(),
  requireModule: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { db } from "@/lib/db"
import {
  adjustDeferredAmount,
  expireAwaitingVouchers,
  validateDeferredAmount,
  voidDeferredVoucher,
  VoucherAmountError,
} from "@/server/ipm/voucher-amount"
import { issuePharmacyVoucher } from "@/server/portal/pharmacy"
import { resetProviderLoginLimiter, type ProviderPrincipal } from "@/server/portal/provider-auth"
import { listValidated } from "@/server/portal/provider-vouchers"
import { issuePortalToken } from "@/server/portal/token"
import { providerConsumption } from "@/server/queries/ipm/documents"
import {
  buildPharmacyFixture,
  databaseAvailable,
  destroyPharmacyFixture,
  PROVIDER_PASSWORD,
  type PharmacyFixture,
} from "@/test/pharmacy-fixture"

import { POST as cancelRoute } from "@/app/api/portail/voucher/cancel/route"
import { POST as participantPreviewRoute } from "@/app/api/portail/voucher/preview/route"
import { POST as changePasswordRoute } from "@/app/api/portail/prestataire/change-password/route"
import { POST as loginRoute } from "@/app/api/portail/prestataire/login/route"
import { POST as logoutRoute } from "@/app/api/portail/prestataire/logout/route"
import { GET as lookupRoute } from "@/app/api/portail/prestataire/voucher/lookup/route"
import { POST as validatePreviewRoute } from "@/app/api/portail/prestataire/voucher/validate/preview/route"
import { POST as validateRoute } from "@/app/api/portail/prestataire/voucher/validate/route"
import { GET as detailRoute } from "@/app/api/portail/prestataire/vouchers/[voucherId]/route"
import { GET as listRoute } from "@/app/api/portail/prestataire/vouchers/route"

/**
 * Bon de pharmacie à montant différé, against the real database.
 *
 * Three claims, each about rows rather than functions:
 *   - **scoping**: a pharmacy reaches its own bons and nothing else, and no
 *     other kind of session reaches its routes;
 *   - **one figure**: a back-office correction moves the pharmacy's list and
 *     monthly total, the invoice and the participant's balance together;
 *   - **money moves at validation**, never at issue, and once.
 *
 * Skipped when no local database is reachable (CI without Postgres).
 */

const available = await databaseAvailable()

process.env.PORTAL_TOKEN_SECRET ??= "t".repeat(48)
process.env.PROVIDER_TOKEN_SECRET ??= "u".repeat(48)
process.env.NEXTAUTH_SECRET ??= "v".repeat(48)

const BASE = "http://localhost/api/portail"
const noContext = { params: Promise.resolve({}) } as never

function request(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {}
): Request {
  return new Request(`${BASE}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function login(username: string, password = PROVIDER_PASSWORD): Promise<string> {
  const response = await loginRoute(
    request("/prestataire/login", { body: { code: username, password } }),
    noContext
  )
  expect(response.status).toBe(200)
  return (await body<{ token: string }>(response)).token
}

function principalFor(fixture: PharmacyFixture, which: "A" | "B"): ProviderPrincipal {
  const account = which === "A" ? fixture.accountA : fixture.accountB
  return {
    providerAccountId: account.id,
    providerId: account.providerId,
    firmId: fixture.firm.id,
    sessionId: "test",
    username: account.username,
    mustChangePassword: false,
  }
}

async function issue(fixture: PharmacyFixture, provider: "A" | "B" = "A") {
  return db.$transaction((tx) =>
    issuePharmacyVoucher(
      tx,
      fixture.participant,
      {
        beneficiaryRef: `member:${fixture.member.id}`,
        category: "PHARMACY",
        providerId: provider === "A" ? fixture.providerA.id : fixture.providerB.id,
      },
      { url: "https://storage.test.invalid/ordonnance.jpg", hash: "a".repeat(64) }
    )
  )
}

async function balance(fixture: PharmacyFixture): Promise<number> {
  const member = await db.member.findUniqueOrThrow({
    where: { id: fixture.member.id },
    select: { currentBalance: true },
  })
  return Number(member.currentBalance)
}

const ctxFor = (fixture: PharmacyFixture) => ({ firmId: fixture.firm.id }) as never

describe.skipIf(!available)("bon de pharmacie — against the database", () => {
  let fixture: PharmacyFixture

  beforeAll(() => {
    resetProviderLoginLimiter()
  })

  beforeEach(async () => {
    fixture = await buildPharmacyFixture({ rate: 0.8, ceilingMonthly: 50_000 })
  })

  afterEach(async () => {
    await destroyPharmacyFixture(fixture)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  /* ------------------------------------------------------------------ */

  it("issues without an amount and commits nothing until validation", async () => {
    const before = await balance(fixture)
    const issued = await issue(fixture)
    expect(issued.status).toBe("AWAITING_AMOUNT")
    expect(issued.qrToken).toMatch(/^BP\./)

    const row = await db.ipmVoucher.findUniqueOrThrow({ where: { id: issued.voucherId } })
    expect(row.totalAmount).toBeNull()
    expect(row.deferredAmount).toBe(true)
    expect(Number(row.insurerShare)).toBe(0)
    expect(await db.ipmConsumption.count({ where: { voucherId: row.id } })).toBe(0)
    expect(
      await db.ipmLedgerEntry.count({ where: { sourceType: "VOUCHER", sourceId: row.id } })
    ).toBe(0)
    expect(await balance(fixture)).toBe(before)
    // The deadline comes from the settings, not the 30-day pharmacy default.
    const days = (row.expiryDate.getTime() - row.issueDate.getTime()) / 86_400_000
    expect(days).toBe(7)
  })

  it("validates once, idempotently, and counts at validation", async () => {
    const issued = await issue(fixture)
    const token = await login(fixture.accountA.username)
    const payload = { voucherId: issued.voucherId, amount: 12_345, idempotencyKey: "key-00000001" }

    const first = await validateRoute(request("/prestataire/voucher/validate", { token, body: payload }), noContext)
    expect(first.status).toBe(200)
    const firstBody = await body(first)
    expect(firstBody).toMatchObject({
      status: "SETTLED",
      amount: 12_345,
      ipmShare: 9_876, // ceil(12 345 × 0.8)
      participantShare: 2_469,
      replayed: false,
    })

    const retry = await validateRoute(request("/prestataire/voucher/validate", { token, body: payload }), noContext)
    expect(retry.status).toBe(200)
    expect(await body(retry)).toMatchObject({ ...firstBody, replayed: true })

    const other = await validateRoute(
      request("/prestataire/voucher/validate", {
        token,
        body: { ...payload, idempotencyKey: "key-00000002", amount: 999 },
      }),
      noContext
    )
    expect(other.status).toBe(409)
    expect((await body<{ error: { code: string } }>(other)).error.code).toBe("ALREADY_VALIDATED")

    // Posted once, at the full amount, and the plafond counts the IPM share.
    const entries = await db.ipmLedgerEntry.findMany({
      where: { sourceType: "VOUCHER", sourceId: issued.voucherId },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: "CONSUMPTION" })
    expect(Number(entries[0]!.debit)).toBe(12_345)
    expect(await balance(fixture)).toBe(-12_345)
    const consumption = await db.ipmConsumption.findMany({ where: { voucherId: issued.voucherId } })
    expect(consumption.map((c) => Number(c.insurerShare))).toEqual([9_876])
  })

  it("caps the IPM share at the remaining plafond, in the preview and the write alike", async () => {
    // 45 000 of a 50 000 monthly plafond already used.
    const first = await issue(fixture)
    await db.$transaction((tx) =>
      validateDeferredAmount(tx, {
        firmId: fixture.firm.id,
        voucherId: first.voucherId,
        amount: 56_250, // × 0.8 = 45 000
        actor: { kind: "user", userId: fixture.user.id },
        reason: "Saisie test",
      })
    )

    const second = await issue(fixture)
    const token = await login(fixture.accountA.username)
    const preview = await validatePreviewRoute(
      request("/prestataire/voucher/validate/preview", {
        token,
        body: { voucherId: second.voucherId, amount: 20_000 },
      }),
      noContext
    )
    expect(preview.status).toBe(200)
    expect(await body(preview)).toMatchObject({
      amount: 20_000,
      ipmShare: 5_000,
      participantShare: 15_000,
      remainingCeiling: 5_000,
      flags: ["CEILING_CAPPED"],
    })
    // Nothing written by the preview.
    const untouched = await db.ipmVoucher.findUniqueOrThrow({ where: { id: second.voucherId } })
    expect(untouched.status).toBe("AWAITING_AMOUNT")

    const validated = await validateRoute(
      request("/prestataire/voucher/validate", {
        token,
        body: { voucherId: second.voucherId, amount: 20_000, idempotencyKey: "cap-0000001" },
      }),
      noContext
    )
    expect(await body(validated)).toMatchObject({ ipmShare: 5_000, participantShare: 15_000 })
  })

  /* ------------------------------------------------------------------ */

  it("keeps every pharmacy to its own bons", async () => {
    const forB = await issue(fixture, "B")
    const forA = await issue(fixture, "A")
    const tokenA = await login(fixture.accountA.username)

    const lookup = await lookupRoute(
      request(`/prestataire/voucher/lookup?token=${encodeURIComponent(forB.qrToken)}`, { token: tokenA }),
      noContext
    )
    expect(lookup.status).toBe(403)
    const lookupBody = await body<{ error: { code: string } }>(lookup)
    expect(lookupBody.error.code).toBe("WRONG_PROVIDER")
    expect(JSON.stringify(lookupBody)).not.toContain(forB.number)

    const validate = await validateRoute(
      request("/prestataire/voucher/validate", {
        token: tokenA,
        body: { voucherId: forB.voucherId, amount: 1_000, idempotencyKey: "steal-000001" },
      }),
      noContext
    )
    expect(validate.status).toBe(403)
    expect((await body<{ error: { code: string } }>(validate)).error.code).toBe("WRONG_PROVIDER")

    const detail = await detailRoute(request(`/prestataire/vouchers/${forB.voucherId}`, { token: tokenA }), {
      params: Promise.resolve({ voucherId: forB.voucherId }),
    })
    expect(detail.status).toBe(404)

    // B's bon validated from the back office still never shows in A's list.
    await db.$transaction((tx) =>
      validateDeferredAmount(tx, {
        firmId: fixture.firm.id,
        voucherId: forB.voucherId,
        amount: 3_000,
        actor: { kind: "user", userId: fixture.user.id },
        reason: "Pharmacie hors portail",
      })
    )
    const list = await listRoute(request("/prestataire/vouchers", { token: tokenA }), noContext)
    const listBody = await body<{ items: { voucherId: string }[]; kpi: { count: number } }>(list)
    expect(listBody.items.map((i) => i.voucherId)).not.toContain(forB.voucherId)
    expect(listBody.kpi.count).toBe(0)

    // A's own bon: found by its QR, with a signed link to the ordonnance.
    const own = await lookupRoute(
      request(`/prestataire/voucher/lookup?token=${encodeURIComponent(forA.qrToken)}`, { token: tokenA }),
      noContext
    )
    expect(own.status).toBe(200)
    const ownBody = await body<{ prescriptionUrl: string; status: string }>(own)
    expect(ownBody.status).toBe("AWAITING_AMOUNT")
    expect(ownBody.prescriptionUrl).toMatch(/\/api\/portail\/prescriptions\/.+\?exp=\d+&sig=/)
    expect(ownBody.prescriptionUrl).not.toContain("storage.test.invalid")
  })

  it("refuses provider routes without a session, or with a participant's", async () => {
    const issued = await issue(fixture)
    const participantToken = issuePortalToken(
      { portalAccountId: fixture.participant.portalAccountId, firmId: fixture.firm.id },
      process.env.PORTAL_TOKEN_SECRET!
    ).token

    for (const token of [undefined, participantToken, "garbage.token"]) {
      const lookup = await lookupRoute(
        request(`/prestataire/voucher/lookup?token=${encodeURIComponent(issued.qrToken)}`, { token }),
        noContext
      )
      expect(lookup.status).toBe(401)
      const validate = await validateRoute(
        request("/prestataire/voucher/validate", {
          token,
          body: { voucherId: issued.voucherId, amount: 1_000, idempotencyKey: "anon-0000001" },
        }),
        noContext
      )
      expect(validate.status).toBe(401)
      const list = await listRoute(request("/prestataire/vouchers", { token }), noContext)
      expect(list.status).toBe(401)
    }

    // And the reverse: a provider token opens no participant route.
    const providerToken = await login(fixture.accountA.username)
    const preview = await participantPreviewRoute(
      request("/voucher/preview", {
        token: providerToken,
        body: {
          beneficiaryRef: `member:${fixture.member.id}`,
          category: "PHARMACY",
          providerId: fixture.providerA.id,
        },
      }),
      noContext
    )
    expect(preview.status).toBe(401)

    const row = await db.ipmVoucher.findUniqueOrThrow({ where: { id: issued.voucherId } })
    expect(row.status).toBe("AWAITING_AMOUNT")
  })

  it("closes a session at logout", async () => {
    const token = await login(fixture.accountA.username)
    expect((await listRoute(request("/prestataire/vouchers", { token }), noContext)).status).toBe(200)
    expect((await logoutRoute(request("/prestataire/logout", { token, body: {} }), noContext)).status).toBe(200)
    expect((await listRoute(request("/prestataire/vouchers", { token }), noContext)).status).toBe(401)
  })

  /* ------------------------------------------------------------------ */

  it("locks an account after five wrong passwords, and an unknown code alike", async () => {
    resetProviderLoginLimiter()
    const code = fixture.accountA.username
    for (let i = 0; i < 5; i++) {
      const response = await loginRoute(
        request("/prestataire/login", { body: { code, password: "wrong-password-1" } }),
        noContext
      )
      expect(response.status).toBe(401)
      expect((await body<{ error: { code: string; message: string } }>(response)).error.code).toBe(
        "INVALID_CREDENTIALS"
      )
    }
    const locked = await loginRoute(
      request("/prestataire/login", { body: { code, password: PROVIDER_PASSWORD } }),
      noContext
    )
    expect(locked.status).toBe(429)
    expect((await body<{ error: { code: string } }>(locked)).error.code).toBe("ACCOUNT_LOCKED")
    expect(locked.headers.get("Retry-After")).toBeTruthy()

    const unknown = `NOPE${fixture.tag}`
    const messages = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const response = await loginRoute(
        request("/prestataire/login", { body: { code: unknown, password: "whatever-123" } }),
        noContext
      )
      expect(response.status).toBe(401)
      messages.add((await body<{ error: { message: string } }>(response)).error.message)
    }
    // Same sentence as a wrong password on a real code.
    expect(messages.size).toBe(1)
    const sixth = await loginRoute(
      request("/prestataire/login", { body: { code: unknown, password: "whatever-123" } }),
      noContext
    )
    expect(sixth.status).toBe(429)
  })

  it("confines a temporary password to the change-password route", async () => {
    await db.providerAccount.update({
      where: { id: fixture.accountA.id },
      data: { mustChangePassword: true },
    })
    const response = await loginRoute(
      request("/prestataire/login", {
        body: { code: fixture.accountA.username, password: PROVIDER_PASSWORD },
      }),
      noContext
    )
    const { token, mustChangePassword } = await body<{ token: string; mustChangePassword: boolean }>(
      response
    )
    expect(mustChangePassword).toBe(true)

    const blocked = await listRoute(request("/prestataire/vouchers", { token }), noContext)
    expect(blocked.status).toBe(403)
    expect((await body<{ error: { code: string } }>(blocked)).error.code).toBe(
      "PASSWORD_CHANGE_REQUIRED"
    )

    const changed = await changePasswordRoute(
      request("/prestataire/change-password", {
        token,
        body: { currentPassword: PROVIDER_PASSWORD, newPassword: "NouveauMotDePasse42" },
      }),
      noContext
    )
    expect(changed.status).toBe(200)
    expect((await listRoute(request("/prestataire/vouchers", { token }), noContext)).status).toBe(200)
  })

  /* ------------------------------------------------------------------ */

  it("never validates an expired bon from the pharmacy, but the back office can", async () => {
    const issued = await issue(fixture)
    await db.ipmVoucher.update({
      where: { id: issued.voucherId },
      data: { expiryDate: new Date(Date.now() - 60_000) },
    })
    const token = await login(fixture.accountA.username)

    const refused = await validateRoute(
      request("/prestataire/voucher/validate", {
        token,
        body: { voucherId: issued.voucherId, amount: 5_000, idempotencyKey: "late-0000001" },
      }),
      noContext
    )
    expect(refused.status).toBe(409)
    expect((await body<{ error: { code: string } }>(refused)).error.code).toBe("EXPIRED")

    const { expired } = await expireAwaitingVouchers(db, { firmId: fixture.firm.id })
    expect(expired).toBe(1)
    const lookup = await lookupRoute(
      request(`/prestataire/voucher/lookup?token=${encodeURIComponent(issued.qrToken)}`, { token }),
      noContext
    )
    // The QR is dead once the bon has expired.
    expect(lookup.status).toBe(404)

    const result = await db.$transaction((tx) =>
      validateDeferredAmount(tx, {
        firmId: fixture.firm.id,
        voucherId: issued.voucherId,
        amount: 5_000,
        actor: { kind: "user", userId: fixture.user.id },
        reason: "Délivré avant l'échéance, saisi en retard",
      })
    )
    expect(result).toMatchObject({ status: "SETTLED", amount: 5_000, ipmShare: 4_000 })
    const row = await db.ipmVoucher.findUniqueOrThrow({ where: { id: issued.voucherId } })
    expect(row.amountSource).toBe("BACK_OFFICE")
  })

  it("lets the participant cancel a waiting bon, which the pharmacy then cannot find", async () => {
    const issued = await issue(fixture)
    const participantToken = issuePortalToken(
      { portalAccountId: fixture.participant.portalAccountId, firmId: fixture.firm.id },
      process.env.PORTAL_TOKEN_SECRET!
    ).token
    const cancelled = await cancelRoute(
      request("/voucher/cancel", { token: participantToken, body: { voucherId: issued.voucherId } }),
      noContext
    )
    expect(cancelled.status).toBe(200)
    expect((await body<{ voucher: { status: string } }>(cancelled)).voucher.status).toBe("CANCELLED")

    const token = await login(fixture.accountA.username)
    const lookup = await lookupRoute(
      request(`/prestataire/voucher/lookup?token=${encodeURIComponent(issued.qrToken)}`, { token }),
      noContext
    )
    expect(lookup.status).toBe(404)
  })

  /* ------------------------------------------------------------------ */

  it("moves the pharmacy's list, the invoice and the balance together on a back-office edit", async () => {
    const issued = await issue(fixture)
    const token = await login(fixture.accountA.username)
    await validateRoute(
      request("/prestataire/voucher/validate", {
        token,
        body: { voucherId: issued.voucherId, amount: 10_000, idempotencyKey: "edit-0000001" },
      }),
      noContext
    )
    expect(await balance(fixture)).toBe(-10_000)

    // Invoiced as the generator does it: the billable bons, attached.
    const month = new Date()
    const from = new Date(month.getFullYear(), month.getMonth(), 1)
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59)
    const billable = await providerConsumption(ctxFor(fixture), {
      providerId: fixture.providerA.id,
      from,
      to,
    })
    expect(billable?.lines.map((l) => [l.totalAmount, l.insurerShare])).toEqual([[10_000, 8_000]])
    const invoice = await db.ipmProviderInvoice.create({
      data: {
        firmId: fixture.firm.id,
        providerId: fixture.providerA.id,
        number: `FACT-TEST-${fixture.tag}`,
        origin: "GENERATED",
        receivedDate: new Date(),
        periodFrom: from,
        periodTo: to,
        totalAmount: billable!.insurerShare,
        matchedAmount: billable!.insurerShare,
        status: "CHECKED",
        lines: {
          create: billable!.lines.map((line) => ({
            firmId: fixture.firm.id,
            voucherId: line.voucherId,
            voucherNumber: line.voucherNumber,
            serviceDate: line.serviceDate,
            beneficiaryName: line.beneficiaryName,
            memberMatricule: line.memberMatricule,
            categoryLabel: line.categoryLabel,
            totalAmount: line.totalAmount,
            insurerShare: line.insurerShare,
            memberShare: line.memberShare,
          })),
        },
      },
    })
    await db.ipmVoucher.update({
      where: { id: issued.voucherId },
      data: { status: "INVOICED", providerInvoiceId: invoice.id },
    })

    // The gestionnaire corrects the amount.
    await db.$transaction((tx) =>
      adjustDeferredAmount(tx, {
        firmId: fixture.firm.id,
        voucherId: issued.voucherId,
        amount: 15_000,
        userId: fixture.user.id,
        reason: "Reçu présenté par la pharmacie",
      })
    )

    // The pharmacy's list and its monthly figure.
    const list = await listValidated(principalFor(fixture, "A"), null)
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({
      amount: 15_000,
      ipmShare: 12_000,
      participantShare: 3_000,
      adjustedByIpm: true,
    })
    expect(list.kpi).toMatchObject({ totalAmount: 15_000, count: 1 })

    // The invoice: its line and its total.
    const after = await db.ipmProviderInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { lines: true },
    })
    expect(Number(after.totalAmount)).toBe(12_000)
    expect(Number(after.matchedAmount)).toBe(12_000)
    expect(after.lines.map((l) => [Number(l.totalAmount), Number(l.insurerShare)])).toEqual([
      [15_000, 12_000],
    ])

    // The participant's balance, through the register, and the plafond.
    expect(await balance(fixture)).toBe(-15_000)
    const entries = await db.ipmLedgerEntry.findMany({
      where: { sourceType: "VOUCHER", sourceId: issued.voucherId },
      orderBy: { createdAt: "asc" },
    })
    expect(entries.map((e) => [e.type, Number(e.debit), Number(e.credit)])).toEqual([
      ["CONSUMPTION", 10_000, 0],
      ["ADJUSTMENT", 5_000, 0],
    ])
    const consumption = await db.ipmConsumption.findMany({ where: { voucherId: issued.voucherId } })
    expect(consumption.map((c) => Number(c.insurerShare))).toEqual([12_000])

    // History and notice.
    const changes = await db.ipmVoucherAmountChange.findMany({
      where: { voucherId: issued.voucherId },
      orderBy: { createdAt: "asc" },
    })
    expect(changes.map((c) => [c.kind, c.newAmount === null ? null : Number(c.newAmount)])).toEqual([
      ["VALIDATE", 10_000],
      ["ADJUST", 15_000],
    ])
    expect(changes[0]!.providerAccountId).toBe(fixture.accountA.id)
    expect(changes[1]!.userId).toBe(fixture.user.id)
    const notices = await db.portalNotification.findMany({ where: { voucherId: issued.voucherId } })
    expect(notices.map((n) => n.kind).sort()).toEqual(["VOUCHER_ADJUSTED", "VOUCHER_VALIDATED"])

    // A void undoes all of it.
    await db.$transaction((tx) =>
      voidDeferredVoucher(tx, {
        firmId: fixture.firm.id,
        voucherId: issued.voucherId,
        userId: fixture.user.id,
        reason: "Bon émis par erreur",
      })
    )
    expect(await balance(fixture)).toBe(0)
    expect(await db.ipmConsumption.count({ where: { voucherId: issued.voucherId } })).toBe(0)
    const voidedInvoice = await db.ipmProviderInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { lines: true },
    })
    expect(voidedInvoice.lines).toHaveLength(0)
    expect(Number(voidedInvoice.totalAmount)).toBe(0)
    expect((await listValidated(principalFor(fixture, "A"), null)).kpi).toMatchObject({
      totalAmount: 0,
      count: 0,
    })
  })

  it("refuses to touch a bon on an approved or paid invoice", async () => {
    const issued = await issue(fixture)
    await db.$transaction((tx) =>
      validateDeferredAmount(tx, {
        firmId: fixture.firm.id,
        voucherId: issued.voucherId,
        amount: 8_000,
        actor: { kind: "user", userId: fixture.user.id },
        reason: "Saisie test",
      })
    )
    const invoice = await db.ipmProviderInvoice.create({
      data: {
        firmId: fixture.firm.id,
        providerId: fixture.providerA.id,
        number: `FACT-PAID-${fixture.tag}`,
        receivedDate: new Date(),
        periodFrom: new Date(),
        periodTo: new Date(),
        totalAmount: 6_400,
        status: "PAID",
      },
    })
    await db.ipmVoucher.update({
      where: { id: issued.voucherId },
      data: { status: "INVOICED", providerInvoiceId: invoice.id },
    })

    for (const attempt of [
      () =>
        db.$transaction((tx) =>
          adjustDeferredAmount(tx, {
            firmId: fixture.firm.id,
            voucherId: issued.voucherId,
            amount: 9_000,
            userId: fixture.user.id,
            reason: "Correction",
          })
        ),
      () =>
        db.$transaction((tx) =>
          voidDeferredVoucher(tx, {
            firmId: fixture.firm.id,
            voucherId: issued.voucherId,
            userId: fixture.user.id,
            reason: "Annulation",
          })
        ),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "INVOICE_LOCKED" })
    }
    expect(await balance(fixture)).toBe(-8_000)
  })

  it("requires a reason from the back office", async () => {
    const issued = await issue(fixture)
    await expect(
      db.$transaction((tx) =>
        validateDeferredAmount(tx, {
          firmId: fixture.firm.id,
          voucherId: issued.voucherId,
          amount: 8_000,
          actor: { kind: "user", userId: fixture.user.id },
          reason: " ",
        })
      )
    ).rejects.toBeInstanceOf(VoucherAmountError)
  })
})

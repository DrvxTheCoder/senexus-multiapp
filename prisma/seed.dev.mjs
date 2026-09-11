/**
 * Development seed.
 *
 * Fills a LOCAL database with production-shaped data so the query layer,
 * the tables and the dashboard aggregates can be built and measured against
 * realistic volume and realistic distributions.
 *
 * This never runs against a remote host: the guard below refuses anything that
 * is not localhost. It also only ever touches the firms it seeds: the two HR
 * filiales, which get fixture data, and IPM Tawfeikh, which gets a module and
 * nothing else until Phase 1 gives it a data model.
 *
 *   pnpm db:seed:dev
 *
 * Nothing here ships. The application itself contains no fixture content.
 */
import { PrismaClient } from "@prisma/client"
import { hash } from "bcryptjs"

const db = new PrismaClient()

// --------------------------------------------------------------------------
// Guard: local only.
// --------------------------------------------------------------------------
const url = process.env.DATABASE_URL ?? ""
const host = (() => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
})()

if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(
    `Refusing to seed: DATABASE_URL points at "${host || "an unparseable host"}".\n` +
      "This script only runs against a local database."
  )
  process.exit(1)
}

// --------------------------------------------------------------------------
// Deterministic randomness, so two runs produce the same database.
// --------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20260904)
const pick = (list) => list[Math.floor(rnd() * list.length)]
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1))
const chance = (p) => rnd() < p

const TODAY = new Date("2026-09-04T00:00:00.000Z")
const DAY = 86_400_000
const addDays = (date, days) => new Date(date.getTime() + days * DAY)

// --------------------------------------------------------------------------
// Vocabulary
// --------------------------------------------------------------------------
const MALE_FIRST = [
  "Ousmane", "Modou", "Cheikh", "Ibrahima", "Abdoulaye", "Moussa", "Mamadou",
  "Alioune", "Babacar", "Serigne", "Papa", "Idrissa", "Lamine", "Malick",
  "Souleymane", "Amadou", "Assane", "Bassirou", "Djibril", "Saliou",
  "Ismaila", "Omar", "Mor", "Pape", "Abdou",
]
const FEMALE_FIRST = [
  "Aminata", "Fatou", "Awa", "Mariama", "Ndèye", "Khady", "Adama", "Astou",
  "Bineta", "Coumba", "Dieynaba", "Fatoumata", "Maimouna", "Marème",
  "Ramatoulaye", "Rokhaya", "Sokhna", "Yacine", "Aïssatou", "Seynabou",
  "Nafissatou", "Mame Diarra", "Oumou", "Anta", "Soukeyna",
]
const LAST = [
  "Diop", "Ndiaye", "Fall", "Sarr", "Ba", "Sy", "Cissé", "Gueye", "Sow",
  "Diallo", "Camara", "Faye", "Mbaye", "Thiam", "Kane", "Seck", "Diouf",
  "Niang", "Dieng", "Barry", "Touré", "Diagne", "Wade", "Samb", "Lô",
  "Ndour", "Badji", "Coly", "Sané", "Mendy",
]
const JOBS_FIELD = [
  "Agent de conditionnement", "Cariste", "Manutentionnaire", "Soudeur",
  "Agent de maintenance", "Chauffeur PL", "Magasinier", "Électromécanicien",
  "Opérateur de production", "Agent de nettoyage", "Gardien",
  "Contrôleur qualité", "Aide-mécanicien", "Peintre industriel",
]
const JOBS_OFFICE = [
  "Agent administratif", "Assistante administrative", "Chef d'équipe",
  "Superviseur", "Coordinateur logistique", "Assistant RH",
]
const CITIES = [
  "Guédiawaye", "Pikine", "Thiaroye", "Mbao", "Rufisque", "Parcelles Assainies",
  "Keur Massar", "Yeumbeul", "Diamniadio", "Grand Yoff", "Ouakam", "Sébikotane",
  "Bargny", "Malika", "Golf Sud",
]
const CATEGORIES = ["1ère catégorie", "2ème catégorie", "3ème catégorie", "Agent de maîtrise"]

// --------------------------------------------------------------------------
// Shape of the population, taken from the prototype distribution so the
// dashboard bands and the ceiling exposure look like the real thing.
// interim day bands: [label, share of interim population]
// --------------------------------------------------------------------------
const INTERIM_BANDS = [
  { max: 179, weight: 142 },
  { max: 364, weight: 118 },
  { max: 549, weight: 96 },
  { max: 649, weight: 47 },
  { max: 729, weight: 21 },
  { max: 900, weight: 4 },
]

function drawInterimDays() {
  const total = INTERIM_BANDS.reduce((sum, band) => sum + band.weight, 0)
  let roll = rnd() * total
  let previous = 0
  for (const band of INTERIM_BANDS) {
    roll -= band.weight
    if (roll <= 0) return int(previous, band.max)
    previous = band.max + 1
  }
  return int(0, 179)
}

const FIRMS = {
  "connect-interim": {
    prefix: "CI",
    displayName: "Connect Interim",
    themeColor: "#b45309",
    headcount: 430,
    interimShare: 0.68,
    clients: [
      { name: "Touba Gaz Mbao", industry: "Distribution gaz", weight: 134 },
      { name: "Sococim Industries", industry: "Cimenterie", weight: 86 },
      { name: "Dakar Terminal", industry: "Logistique portuaire", weight: 62 },
      { name: "Sen Eau Thiaroye", industry: "Distribution eau", weight: 48 },
      { name: "Patisen", industry: "Agroalimentaire", weight: 41 },
      { name: "Groupe Filfili", industry: "BTP", weight: 29 },
      { name: "Kirène", industry: "Agroalimentaire", weight: 18 },
      { name: "SODIDA", industry: "Immobilier industriel", weight: 0, status: "PROSPECT" },
      { name: "Eiffage Sénégal", industry: "BTP", weight: 0, status: "PROSPECT" },
      { name: "SDE", industry: "Distribution eau", weight: 0, status: "INACTIVE" },
    ],
    departments: [
      ["Opérations", "OPS"],
      ["Logistique", "LOG"],
      ["Maintenance", "MNT"],
      ["Administration", "ADM"],
    ],
  },
  "synergie-pro": {
    prefix: "SP",
    displayName: "Synergie Pro",
    themeColor: "#2563eb",
    headcount: 58,
    interimShare: 0.15,
    clients: [
      { name: "CBAO", industry: "Banque", weight: 14 },
      { name: "Sonatel", industry: "Télécommunications", weight: 11 },
      { name: "Ecobank Sénégal", industry: "Banque", weight: 8 },
      { name: "ASEPEX", industry: "Secteur public", weight: 5 },
      { name: "Compagnie Sucrière Sénégalaise", industry: "Agro-industrie", weight: 0, status: "PROSPECT" },
    ],
    departments: [
      ["Conseil", "CSL"],
      ["Administration", "ADM"],
    ],
  },
}

// The account that owns every filiale. Override when seeding for someone else.
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "flanpaul19@gmail.com"

/**
 * IPM Tawfeikh — third filiale of the same holding, and deliberately **not** a
 * member of `FIRMS`.
 *
 * `FIRMS` is the HR fixture generator's input: everything in it receives
 * departments, employees, contracts, clients and a matricule prefix. The IPM
 * runs one module and has none of those. Listing it there to save a loop would
 * hand it the entire HR surface, which is precisely what the module boundary
 * exists to prevent.
 */
const IPM_FIRM = {
  slug: "ipm-tawfeikh",
  displayName: "IPM Tawfeikh",
  themeColor: "#0b5d53",
  /** Not `documents`: that module is employee documents and depends on hr. */
  modules: ["ipm"],
}

const DOCUMENT_TYPES = [
  "CONTRACT", "ID_CARD", "CV", "MEDICAL_CERTIFICATE", "CERTIFICATE",
  "DIPLOMA", "PAYSLIP", "LEGAL_DOCUMENT",
]

async function main() {
  console.log("Seeding local development data…\n")

  const firms = await db.firm.findMany({ select: { id: true, slug: true, name: true } })
  const bySlug = Object.fromEntries(firms.map((f) => [f.slug, f]))

  // A fresh database has no firms at all, and refusing to run was a poor first
  // experience: the seed now creates what it needs under the single holding.
  // One holding, whatever it is called. Creating a second one is not a
  // cosmetic mistake: a transfer is only legal between filiales of the *same*
  // holding, so two holdings silently make every transfer impossible.
  const holding =
    (await db.holding.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })) ??
    (await db.holding.create({
      data: {
        name: "Groupe Senexus",
        description: "Holding du groupe, Dakar.",
      },
      select: { id: true },
    }))

  for (const [slug, config] of Object.entries(FIRMS)) {
    if (bySlug[slug]) continue
    bySlug[slug] = await db.firm.create({
      data: {
        holdingId: holding.id,
        slug,
        name: config.displayName,
        themeColor: config.themeColor ?? "#0b5d53",
      },
      select: { id: true, slug: true, name: true },
    })
    console.log(`Created firm ${config.displayName}.`)
  }

  if (!bySlug[IPM_FIRM.slug]) {
    bySlug[IPM_FIRM.slug] = await db.firm.create({
      data: {
        holdingId: holding.id,
        slug: IPM_FIRM.slug,
        name: IPM_FIRM.displayName,
        themeColor: IPM_FIRM.themeColor,
      },
      select: { id: true, slug: true, name: true },
    })
    console.log(`Created firm ${IPM_FIRM.displayName}.`)
  }
  const ipmFirm = bySlug[IPM_FIRM.slug]

  // The second firm was seeded as `senexus-consulting` before the real name was
  // confirmed. Left behind it becomes a third firm full of stale fixtures that
  // every dashboard counts. Removed here, and only here — this seed already
  // refuses to run against anything but a local database.
  const retired = await db.firm.findUnique({
    where: { slug: "senexus-consulting" },
    select: { id: true },
  })
  if (retired) {
    console.log("Removing the retired senexus-consulting fixture…")
    await db.employeeTransfer.deleteMany({
      where: { OR: [{ fromFirmId: retired.id }, { toFirmId: retired.id }] },
    })
    await db.firm.delete({ where: { id: retired.id } })
  }

  // A firm seeded before this rule existed may sit under a second holding.
  await db.firm.updateMany({
    where: {
      slug: { in: [...Object.keys(FIRMS), IPM_FIRM.slug] },
      NOT: { holdingId: holding.id },
    },
    data: { holdingId: holding.id },
  })
  await db.holding.deleteMany({ where: { firms: { none: {} } } })

  const seededFirms = Object.keys(FIRMS).map((slug) => bySlug[slug])
  const firmIds = seededFirms.map((f) => f.id)

  // ---- wipe domain data for the seeded firms (never users/firms/holdings) --
  console.log("Clearing existing domain rows…")
  // No `fileObject` wipe: FileObject was dropped with the IPM draft models in
  // 8c9db50 — EmployeeDocument is the only file system in use.
  await db.employeeDocument.deleteMany({ where: { firmId: { in: firmIds } } })
  await db.employeeTransfer.deleteMany({
    where: { OR: [{ fromFirmId: { in: firmIds } }, { toFirmId: { in: firmIds } }] },
  })
  await db.leaveRequest.deleteMany({ where: { firmId: { in: firmIds } } })
  await db.leaveBalance.deleteMany({ where: { employee: { firmId: { in: firmIds } } } })
  await db.contract.deleteMany({ where: { firmId: { in: firmIds } } })
  await db.userClientAssignment.deleteMany({ where: { firmId: { in: firmIds } } })
  await db.employee.deleteMany({ where: { firmId: { in: firmIds } } })
  await db.department.deleteMany({ where: { firmId: { in: firmIds } } })
  await db.clientFirmAssignment.deleteMany({ where: { firmId: { in: firmIds } } })
  await db.client.deleteMany({ where: { firmId: { in: firmIds } } })
  await db.dashboardView.deleteMany({ where: { firmId: { in: firmIds } } })

  // ---- modules -----------------------------------------------------------
  // Modules are data, not code (DATA_MODEL.md §6): a route under /hr, /crm or
  // /documents is only reachable when the firm has that Module row enabled.
  //
  // `hr` and `crm` used to be read with findUnique and skipped when absent,
  // which assumed a database that already had them. A fresh one does not, so
  // the seed produced firms with `documents` alone and every /hr and /crm
  // route gated off. All three are created here.
  //
  // Documents depends on hr. That gates navigation and authorisation only —
  // EmployeeDocument keeps its foreign key to Employee either way.
  console.log("Ensuring modules…")
  const MODULES = [
    {
      slug: "hr",
      name: "Ressources Humaines",
      description:
        "Employés, contrats, congés et transferts entre filiales du groupe.",
      icon: "UserMultipleIcon",
      basePath: "/hr",
      // A system module cannot be uninstalled from the admin screen.
      isSystem: true,
    },
    {
      slug: "crm",
      name: "CRM",
      description: "Portefeuille clients, affectations et suivi commercial.",
      icon: "Building03Icon",
      basePath: "/crm",
      isSystem: true,
    },
    {
      slug: "documents",
      name: "Documents",
      description:
        "Pièces rattachées aux employés : contrats signés, CNI, certificats, attestations.",
      icon: "Folder01Icon",
      basePath: "/documents",
      isSystem: false,
      dependsOn: "hr",
    },
    {
      slug: "ipm",
      name: "Prévoyance maladie",
      description:
        "Institution de prévoyance maladie : affiliation, formules, bons de prise en charge, cotisations.",
      icon: "HealthIcon",
      basePath: "/ipm",
      isSystem: false,
      // Deliberately no `dependsOn`. The IPM is a filiale with neither
      // employees nor clients in MultiAPP, so a dependency on hr would be a
      // lie that also forces the whole HR surface on.
    },
  ]

  const moduleBySlug = {}
  for (const spec of MODULES) {
    moduleBySlug[spec.slug] = await db.module.upsert({
      where: { slug: spec.slug },
      // Name, path and icon are corrected on re-run; isSystem is not, so an
      // admin's own change to it survives the seed.
      update: {
        name: spec.name,
        description: spec.description,
        icon: spec.icon,
        basePath: spec.basePath,
        isActive: true,
      },
      create: {
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        version: "1.0.0",
        icon: spec.icon,
        basePath: spec.basePath,
        isSystem: spec.isSystem,
        isActive: true,
      },
    })
  }

  for (const spec of MODULES) {
    if (!spec.dependsOn) continue
    const moduleId = moduleBySlug[spec.slug].id
    const dependsOnId = moduleBySlug[spec.dependsOn].id
    const existing = await db.moduleDependency.findUnique({
      where: { moduleId_dependsOnId: { moduleId, dependsOnId } },
    })
    if (!existing) {
      await db.moduleDependency.create({ data: { moduleId, dependsOnId } })
    }
  }

  // What a firm is *installed* with is never "every module in the catalogue".
  // A FirmModule row is the authorisation boundary, so each firm's list is
  // enumerated explicitly: the HR filiales get the three HR-side modules, the
  // IPM gets `ipm` alone. Iterating MODULES here instead would hand health
  // routes to Connect Interim the moment a module is added to the catalogue.
  const HR_FIRM_MODULES = ["hr", "crm", "documents"]

  async function install(firm, slugs) {
    for (const slug of slugs) {
      const moduleId = moduleBySlug[slug].id
      await db.firmModule.upsert({
        where: { firmId_moduleId: { firmId: firm.id, moduleId } },
        update: { isEnabled: true },
        create: { firmId: firm.id, moduleId, isEnabled: true },
      })
    }
    console.log(`  ${firm.name}: ${slugs.join(", ")}`)
  }

  for (const firm of seededFirms) {
    await install(firm, HR_FIRM_MODULES)
  }
  await install(ipmFirm, IPM_FIRM.modules)

  // ---- matricule prefixes ------------------------------------------------
  // The single most consequential legacy defect: `generateNextMatricule` took a
  // prefix nobody passed, so every firm numbered its people `CI####`. The
  // prefix lives per firm in the HR module's settings — the schema's own JSON
  // extension point — and the seed writes it so generated matricules match the
  // ones in the fixtures. This used to be skipped when the hr module was
  // missing, which on a fresh database meant always.
  //
  // It also used to `upsert`. A FirmModule row is the authorisation boundary,
  // not a key-value store that happens to hang off a firm, and writing a
  // setting must never be what brings one into existence — any firm added to
  // FIRMS without HR would have come out with the whole HR surface enabled. It
  // updates a row that the install step above has already created, and says so
  // rather than silently granting one.
  const hrModuleId = moduleBySlug.hr.id
  for (const [slug, config] of Object.entries(FIRMS)) {
    const firm = bySlug[slug]
    const existing = await db.firmModule.findUnique({
      where: { firmId_moduleId: { firmId: firm.id, moduleId: hrModuleId } },
      select: { settings: true },
    })
    if (!existing) {
      console.log(`  ${firm.name}: RH non activé, préfixe non écrit.`)
      continue
    }
    await db.firmModule.update({
      where: { firmId_moduleId: { firmId: firm.id, moduleId: hrModuleId } },
      data: {
        isEnabled: true,
        settings: { ...(existing.settings ?? {}), matriculePrefix: config.prefix },
      },
    })
    console.log(`  ${firm.name}: matricules ${config.prefix}####`)
  }

  // ---- users -------------------------------------------------------------
  // A manager and a client-scoped responsable, so role scoping can actually be
  // tested (§3.5: the same restriction must apply to list, facets and export).
  console.log("Ensuring test users…")
  const devPassword = await hash("senexus-dev", 10)

  // The owner account used to be looked up rather than created, on the
  // assumption it already existed from a real sign-up. On a fresh database it
  // did not, and because every use of it downstream reads `owner?.id ?? …`,
  // the seed quietly finished with no OWNER at all. It is created here like
  // the others — but `update` stays empty so a real account that already
  // exists keeps its own password.
  //
  // Whether it already existed is read *before* the upsert. Inferring it from
  // `updatedAt === createdAt` afterwards is wrong for any row that has simply
  // never been updated since sign-up, and it was wrong here: the summary told
  // the owner of a real account that their password was `senexus-dev`.
  const ownerWasCreated =
    (await db.user.findUnique({
      where: { email: OWNER_EMAIL },
      select: { id: true },
    })) === null

  const owner = await db.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      email: OWNER_EMAIL,
      name: "Paul Flan",
      passwordHash: devPassword,
      emailVerified: new Date(),
    },
  })

  const manager = await db.user.upsert({
    where: { email: "manager.dev@senexus.local" },
    update: { passwordHash: devPassword },
    create: {
      email: "manager.dev@senexus.local",
      name: "Awa Ba",
      passwordHash: devPassword,
      emailVerified: new Date(),
    },
  })

  const responsable = await db.user.upsert({
    where: { email: "responsable.dev@senexus.local" },
    update: { passwordHash: devPassword },
    create: {
      email: "responsable.dev@senexus.local",
      name: "Modou Fall",
      passwordHash: devPassword,
      emailVerified: new Date(),
    },
  })

  const connectInterim = bySlug["connect-interim"]

  for (const [user, role] of [
    [manager, "MANAGER"],
    [responsable, "RESPONSABLE"],
  ]) {
    await db.userFirm.upsert({
      where: { userId_firmId: { userId: user.id, firmId: connectInterim.id } },
      update: { role },
      create: { userId: user.id, firmId: connectInterim.id, role },
    })
  }

  // The manager also belongs to the destination firm: a transfer is approved by
  // the receiving side and completed by the sending side, so testing the flow
  // end to end needs one account that can act on both.
  for (const firm of seededFirms) {
    await db.userFirm.upsert({
      where: { userId_firmId: { userId: manager.id, firmId: firm.id } },
      update: {},
      create: { userId: manager.id, firmId: firm.id, role: "MANAGER" },
    })
    await db.userFirm.upsert({
      where: { userId_firmId: { userId: owner.id, firmId: firm.id } },
      update: { role: "OWNER" },
      create: { userId: owner.id, firmId: firm.id, role: "OWNER" },
    })
  }
  // The IPM gets the owner and no one else. `manager.dev` deliberately stays
  // out: §7 asks that a right on the HR side confer nothing on the health side,
  // and leaving one seeded account with HR access and no IPM membership is what
  // makes that testable rather than merely asserted.
  await db.userFirm.upsert({
    where: { userId_firmId: { userId: owner.id, firmId: ipmFirm.id } },
    update: { role: "OWNER" },
    create: { userId: owner.id, firmId: ipmFirm.id, role: "OWNER" },
  })
  console.log(`  owner ${OWNER_EMAIL} on ${seededFirms.length + 1} firms`)

  // ---- per-firm data -----------------------------------------------------
  const totals = { clients: 0, departments: 0, employees: 0, contracts: 0, documents: 0, leaves: 0 }
  const employeesByFirm = {}

  for (const [slug, config] of Object.entries(FIRMS)) {
    const firm = bySlug[slug]
    console.log(`\n${firm.name}`)

    // clients
    const clients = []
    for (const spec of config.clients) {
      const client = await db.client.create({
        data: {
          firmId: firm.id,
          name: spec.name,
          industry: spec.industry,
          status: spec.status ?? "ACTIVE",
          contactName: `${pick(MALE_FIRST)} ${pick(LAST)}`,
          contactEmail: `contact@${spec.name.toLowerCase().replace(/[^a-z]+/g, "")}.sn`,
          contactPhone: `+221 33 ${int(800, 899)} ${int(10, 99)} ${int(10, 99)}`,
          address: pick(CITIES),
          tags: spec.weight > 60 ? ["grand compte"] : [],
          contractStartDate: addDays(TODAY, -int(400, 1600)),
          contractEndDate: spec.weight > 0 ? addDays(TODAY, int(16, 180)) : null,
        },
      })
      clients.push({ ...client, weight: spec.weight })
    }
    totals.clients += clients.length
    console.log(`  ${clients.length} clients`)

    // departments
    const departments = []
    for (const [name, code] of config.departments) {
      departments.push(
        await db.department.create({ data: { firmId: firm.id, name, code } })
      )
    }
    totals.departments += departments.length

    // weighted client picker, so the portfolio is concentrated like the real one
    const placeable = clients.filter((c) => c.weight > 0)
    const weightTotal = placeable.reduce((sum, c) => sum + c.weight, 0)
    const pickClient = () => {
      let roll = rnd() * weightTotal
      for (const client of placeable) {
        roll -= client.weight
        if (roll <= 0) return client
      }
      return placeable[0]
    }

    // employees + their contract chains
    const employees = []
    const contractRows = []
    const documentRows = []
    const balanceRows = []

    for (let i = 0; i < config.headcount; i += 1) {
      const female = chance(0.42)
      const firstName = female ? pick(FEMALE_FIRST) : pick(MALE_FIRST)
      const lastName = pick(LAST)
      const office = chance(0.18)
      const jobTitle = office ? pick(JOBS_OFFICE) : pick(JOBS_FIELD)
      const client = pickClient()
      const matricule = `${config.prefix}${String(i + 1).padStart(4, "0")}`

      const isInterim = chance(config.interimShare)
      const type = isInterim
        ? "INTERIM"
        : chance(0.5)
          ? "CDD"
          : chance(0.6)
            ? "CDI"
            : chance(0.5)
              ? "PRESTATION"
              : "STAGE"

      // cumulative interim days drives how far back the chain starts
      const cumulativeDays = isInterim ? drawInterimDays() : int(60, 700)
      const hireDate = addDays(TODAY, -(cumulativeDays + int(0, 45)))

      const status = chance(0.94)
        ? "ACTIVE"
        : chance(0.5)
          ? "ON_LEAVE"
          : chance(0.5)
            ? "INACTIVE"
            : "TERMINATED"

      const netSalary = int(130, 340) * 1000

      const employee = {
        id: `seed_${config.prefix}_emp_${i}`,
        firmId: firm.id,
        firstName,
        lastName,
        matricule,
        departmentId: pick(departments).id,
        assignedClientId: client.id,
        status,
        hireDate,
        phone: `+221 7${pick([0, 6, 7, 8])} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`,
        email: `${firstName.toLowerCase().replace(/[^a-z]/g, "")}.${lastName.toLowerCase().replace(/[^a-z]/g, "")}@example.sn`,
        address: pick(CITIES),
        dateOfBirth: addDays(TODAY, -int(21, 55) * 365),
        placeOfBirth: pick(CITIES),
        gender: female ? "FEMALE" : "MALE",
        maritalStatus: pick(["Célibataire", "Marié(e)", "Divorcé(e)"]),
        nationality: "Sénégalaise",
        // A quarter of records are missing a CNI on purpose: the Décisions
        // queue surfaces incomplete employee files.
        cni: chance(0.75)
          ? `${female ? 2 : 1} ${int(1970, 2004)} ${int(1000, 9999)} ${String(i).padStart(5, "0")}`
          : null,
        fatherName: chance(0.8) ? `${pick(MALE_FIRST)} ${lastName}` : null,
        motherName: chance(0.8) ? `${pick(FEMALE_FIRST)} ${pick(LAST)}` : null,
        jobTitle,
        category: pick(CATEGORIES),
        netSalary,
      }
      employees.push(employee)

      // ---- contract chain -------------------------------------------------
      // Successive contracts, each renewing the last. The chain is built so
      // that the days ALREADY ELAPSED across it add up to `cumulativeDays` —
      // that is the number the 730-day ceiling is computed from — while the
      // final contract of an active employee still runs into the future. A
      // roster whose contracts had all ended in the past would be useless for
      // building expiry alerts and the renewal pre-flight.
      const stillEmployed = status === "ACTIVE" || status === "ON_LEAVE"
      const chainLength = isInterim ? int(1, 4) : int(1, 2)

      // Split the elapsed days into segments of at least 25 days each.
      const segments = []
      let left = Math.max(cumulativeDays, chainLength * 25)
      for (let c = 0; c < chainLength; c += 1) {
        const slotsAfter = chainLength - c - 1
        const elapsed =
          c === chainLength - 1
            ? left
            : Math.max(25, Math.min(left - slotsAfter * 25, Math.floor(left / (chainLength - c)) + int(-15, 15)))
        segments.push(elapsed)
        left -= elapsed
      }

      // Rare gaps between contracts push the hire date further back without
      // changing how many days were actually worked.
      const gaps = segments.slice(1).map(() => (chance(0.15) ? int(3, 25) : 0))
      const totalGap = gaps.reduce((sum, gap) => sum + gap, 0)
      const chainStart = addDays(TODAY, -(segments.reduce((a, b) => a + b, 0) + totalGap))

      // How much runway the final contract still has. Skewed so roughly a
      // tenth of the roster falls inside the 30-day alert window and another
      // slice inside 90 days.
      const tail = chance(0.1) ? int(2, 29) : chance(0.2) ? int(30, 89) : int(90, 420)

      let cursor = chainStart
      let previousId = null

      for (let c = 0; c < chainLength; c += 1) {
        const last = c === chainLength - 1
        const startDate = cursor
        const elapsed = segments[c]
        const endDate =
          type === "CDI"
            ? null
            : last && stillEmployed
              ? addDays(startDate, elapsed + tail)
              : addDays(startDate, elapsed)

        const contractId = `seed_${config.prefix}_ctr_${i}_${c}`
        const contractStatus = !last
          ? "RENEWED"
          : status === "TERMINATED"
            ? "TERMINATED"
            : stillEmployed
              ? "ACTIVE"
              : // A CDI has no end date, so it can never be EXPIRED. It ends
                // by termination or it does not end.
                type === "CDI"
                ? "TERMINATED"
                : "EXPIRED"

        contractRows.push({
          id: contractId,
          firmId: firm.id,
          employeeId: employee.id,
          clientId: client.id,
          type,
          status: contractStatus,
          startDate,
          endDate,
          renewalDate: last ? null : endDate,
          renewedFromId: previousId,
          alertThreshold: chance(0.9) ? 30 : 60,
          isAutoRenewal: chance(0.12),
          position: jobTitle,
          salary: netSalary - (chainLength - 1 - c) * int(5, 15) * 1000,
          workingHours: 40,
          trialPeriodEnd: c === 0 ? addDays(startDate, 90) : null,
          // Visa from the labour inspectorate. A handful are still pending.
          isVise: chance(0.88),
          isActive: contractStatus === "ACTIVE",
          terminationDate: contractStatus === "TERMINATED" ? addDays(startDate, elapsed) : null,
          terminationReason:
            contractStatus === "TERMINATED"
              ? pick(["Rupture pendant la période d essai", "Abandon de poste", "Fin de mission anticipée"])
              : null,
        })

        previousId = contractId
        cursor = addDays(startDate, elapsed + (gaps[c] ?? 0))
      }

      // ---- documents ------------------------------------------------------
      const documentCount = int(1, 8)
      const shuffled = [...DOCUMENT_TYPES].sort(() => rnd() - 0.5)
      for (let d = 0; d < documentCount; d += 1) {
        const documentType = shuffled[d % shuffled.length]
        const expiring = chance(0.12)
        const expired = chance(0.06)
        documentRows.push({
          id: `seed_${config.prefix}_doc_${i}_${d}`,
          employeeId: employee.id,
          firmId: firm.id,
          documentType,
          fileName: `${documentType.toLowerCase()}-${matricule}.pdf`,
          storageKey: `employees/${matricule}/${documentType.toLowerCase()}-${d}.pdf`,
          // Deliberately a raw storage URL, exactly as the legacy data holds
          // it. Nothing in the UI may render this value (§3.7).
          fileUrl: `https://zipline.example.invalid/u/${config.prefix}${i}${d}.pdf`,
          fileSize: int(48, 2400) * 1024,
          mimeType: "application/pdf",
          uploadedBy: owner.id,
          tags: [],
          expiryDate: expired
            ? addDays(TODAY, -int(1, 200))
            : expiring
              ? addDays(TODAY, int(1, 60))
              : chance(0.3)
                ? addDays(TODAY, int(200, 900))
                : null,
          isVerified: chance(0.78),
          verifiedBy: chance(0.78) ? owner.id : null,
          verifiedAt: chance(0.78) ? addDays(TODAY, -int(10, 400)) : null,
        })
      }

      // ---- leave balances -------------------------------------------------
      for (const [leaveType, totalDays] of [
        ["ANNUAL", 20],
        ["SICK", 5],
      ]) {
        const used = int(0, totalDays)
        balanceRows.push({
          id: `seed_${config.prefix}_bal_${i}_${leaveType}`,
          employeeId: employee.id,
          year: 2026,
          leaveType,
          totalDays,
          usedDays: used,
          remainingDays: totalDays - used,
          carriedOver: 0,
        })
      }
    }

    console.log(`  ${employees.length} employees`)
    await createInBatches(db.employee, employees)
    await createInBatches(db.contract, contractRows)
    await createInBatches(db.employeeDocument, documentRows)
    await createInBatches(db.leaveBalance, balanceRows)
    console.log(`  ${contractRows.length} contracts, ${documentRows.length} documents`)

    totals.employees += employees.length
    totals.contracts += contractRows.length
    totals.documents += documentRows.length
    employeesByFirm[slug] = employees

    // ---- leave requests ---------------------------------------------------
    const leaveRows = []
    const sample = employees.filter(() => chance(0.11))
    for (const [index, employee] of sample.entries()) {
      const start = addDays(TODAY, int(-120, 40))
      const days = int(2, 15)
      const status = chance(0.3) ? "PENDING" : chance(0.75) ? "APPROVED" : "REJECTED"
      leaveRows.push({
        id: `seed_${config.prefix}_lv_${index}`,
        firmId: firm.id,
        employeeId: employee.id,
        leaveType: pick(["ANNUAL", "ANNUAL", "SICK", "MATERNITY", "SPECIAL"]),
        startDate: start,
        endDate: addDays(start, days),
        totalDays: days,
        isPaid: true,
        status,
        requestedAt: addDays(start, -int(3, 30)),
        reviewedBy: status === "PENDING" ? null : owner.id,
        reviewedAt: status === "PENDING" ? null : addDays(start, -int(1, 3)),
      })
    }
    await createInBatches(db.leaveRequest, leaveRows)
    totals.leaves += leaveRows.length
    console.log(`  ${leaveRows.length} leave requests`)

    // client-firm assignments
    for (const client of clients) {
      await db.clientFirmAssignment.create({
        data: {
          clientId: client.id,
          firmId: firm.id,
          startDate: client.contractStartDate ?? addDays(TODAY, -500),
          isActive: client.status === "ACTIVE",
        },
      })
    }
  }

  // ---- the responsable sees two clients only -----------------------------
  const scopedClients = await db.client.findMany({
    where: { firmId: connectInterim.id, status: "ACTIVE" },
    orderBy: { name: "asc" },
    take: 2,
    select: { id: true, name: true },
  })
  for (const client of scopedClients) {
    await db.userClientAssignment.create({
      data: {
        userId: responsable.id,
        clientId: client.id,
        firmId: connectInterim.id,
      },
    })
  }

  // ---- transfers between the two firms -----------------------------------
  const transferSource = employeesByFirm["connect-interim"].slice(0, 6)
  const destination = bySlug["synergie-pro"]
  let transferIndex = 0
  for (const employee of transferSource) {
    const status = ["PENDING", "PENDING", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"][
      transferIndex
    ]
    await db.employeeTransfer.create({
      data: {
        employeeId: employee.id,
        fromFirmId: connectInterim.id,
        toFirmId: destination.id,
        transferDate: addDays(TODAY, -int(5, 60)),
        effectiveDate: addDays(TODAY, int(-30, 45)),
        reason: pick([
          "Renfort sur le pôle conseil",
          "Demande du collaborateur",
          "Réaffectation après fin de mission",
        ]),
        status,
        newMatricule: `SP${String(900 + transferIndex).padStart(4, "0")}`,
        requestedBy: owner.id,
        approvedBy: ["APPROVED", "COMPLETED"].includes(status)
          ? owner.id
          : null,
        approvedAt: ["APPROVED", "COMPLETED"].includes(status)
          ? addDays(TODAY, -int(1, 20))
          : null,
      },
    })
    transferIndex += 1
  }

  console.log("\n----------------------------------------")
  console.log("Seed complete.")
  console.table(totals)
  console.log("\nSign-in accounts (development only):")
  console.table([
    {
      email: OWNER_EMAIL,
      role: "OWNER (les trois filiales)",
      // Created just now by this seed, or pre-existing with its own password.
      password: ownerWasCreated ? "senexus-dev" : "unchanged",
    },
    { email: "manager.dev@senexus.local", role: "MANAGER (connect-interim)", password: "senexus-dev" },
    {
      email: "responsable.dev@senexus.local",
      role: `RESPONSABLE, sees only ${scopedClients.map((c) => c.name).join(" + ")}`,
      password: "senexus-dev",
    },
  ])
}

/** createMany in chunks, so a large seed does not build one enormous statement. */
async function createInBatches(model, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await model.createMany({ data: rows.slice(i, i + size), skipDuplicates: true })
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })

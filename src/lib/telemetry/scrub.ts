import type { ErrorEvent, EventHint } from "@sentry/nextjs"

/**
 * §7 — PII scrubbing is mandatory.
 *
 * This application handles CNI numbers, salaries, addresses and identity
 * documents. Nothing that could carry one leaves the process: request bodies
 * are dropped outright, headers and query strings are filtered by key, and any
 * remaining string is swept for CNI-shaped and email-shaped values.
 *
 * The rule is deny-by-default. A new route cannot leak by forgetting to opt in.
 */

/** Routes whose payloads are never transmitted, under any circumstances. */
const SENSITIVE_PATH = /\/(employees|documents|payroll|payslips|files|claims|salaries|contracts)(\/|$)/i

const SENSITIVE_KEY =
  /(cni|passport|password|passwordhash|token|secret|authorization|cookie|session|salary|salaire|netsalary|grosssalary|amount|montant|iban|address|adresse|phone|telephone|email|birth|naissance|matricule|firstname|lastname|nom|prenom)/i

/** Senegalese CNI: 13+ digits, often written in space-separated groups. */
const CNI_LIKE = /\b\d[\d ]{11,}\d\b/g
const EMAIL_LIKE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g

const REDACTED = "[redacted]"

function scrubString(value: string): string {
  return value.replace(CNI_LIKE, REDACTED).replace(EMAIL_LIKE, REDACTED)
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED
  if (typeof value === "string") return scrubString(value)
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(inner, depth + 1)
    }
    return out
  }
  return value
}

function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url, "http://internal")
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) {
        parsed.searchParams.set(key, REDACTED)
      } else {
        const current = parsed.searchParams.get(key)
        if (current) parsed.searchParams.set(key, scrubString(current))
      }
    }
    return url.startsWith("http") ? parsed.toString() : `${parsed.pathname}${parsed.search}`
  } catch {
    return scrubString(url)
  }
}

/**
 * Expected access outcomes. A caller hitting a firm they cannot see is a 404,
 * not a crash, and must not page anyone.
 */
const EXPECTED_ERROR_NAMES = new Set([
  "UnauthorizedError",
  "ForbiddenError",
  "NotFoundError",
])

export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  const thrown = event.exception?.values?.[0]?.type
  if (thrown && EXPECTED_ERROR_NAMES.has(thrown)) {
    return null
  }

  // Identity: keep the user id, drop everything that names a person.
  if (event.user) {
    event.user = { id: event.user.id }
  }

  if (event.request) {
    // Never send a request body. Not from any route, sensitive or not.
    delete event.request.data
    delete event.request.cookies

    if (event.request.url) {
      const url = event.request.url
      event.request.url = scrubUrl(url)
      if (SENSITIVE_PATH.test(url)) {
        delete event.request.query_string
      } else if (event.request.query_string) {
        event.request.query_string = scrubValue(
          event.request.query_string
        ) as typeof event.request.query_string
      }
    }

    if (event.request.headers) {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(event.request.headers)) {
        headers[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubString(String(value))
      }
      event.request.headers = headers
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message ? scrubString(crumb.message) : crumb.message,
      data: crumb.data
        ? (scrubValue(crumb.data) as Record<string, unknown>)
        : crumb.data,
    }))
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as typeof event.contexts
  }

  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = scrubString(value.value)
  }

  if (event.message) {
    event.message = scrubString(event.message)
  }

  return event
}

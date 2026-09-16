import "server-only"

/**
 * Where this deployment is reachable — from configuration, not from the
 * request that happens to be in flight.
 *
 * ## Why not `new URL(request.url).origin`
 *
 * It is the obvious thing and it is wrong for anything durable. The request
 * origin is whatever host the caller reached the server on, so it follows the
 * operator around: a card generated from `localhost:3000` carries a QR that
 * resolves to the generator's own laptop, and one generated through an
 * internal hostname or a preview deployment carries a URL nobody outside can
 * open. The card is then printed, laminated and handed to somebody — the
 * mistake is permanent in a way a mistaken web response is not.
 *
 * It is also attacker-controlled: `Host` is a request header, and Auth.js is
 * configured with `trustHost: true`, so nothing upstream is rejecting an
 * unexpected one. Printing a QR from it means printing a URL a caller chose.
 *
 * ## The variable
 *
 * `AUTH_URL` first, then `NEXTAUTH_URL` — the same order and the same reason
 * as the secret in `config.edge.ts`: v5 is the current name, and the v4 name
 * is still read so an existing deployment keeps working.
 *
 * Throwing when neither is set matches `verificationSecret()`. A silent
 * fallback to `localhost` would produce cards that look completely correct and
 * are useless the moment they leave the building, which is exactly the failure
 * that is worth being loud about.
 */
export function appOrigin(): string {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL

  if (!configured) {
    throw new Error(
      "AUTH_URL (or NEXTAUTH_URL) is required: it is the origin printed into " +
        "card QR codes, and it cannot be taken from the request."
    )
  }

  try {
    // Normalises away a trailing slash, a path, a default port and a
    // capitalised host — all of which would otherwise reach the QR, where
    // every character is rationed.
    return new URL(configured).origin
  } catch {
    throw new Error(
      `AUTH_URL is not a valid absolute URL: ${JSON.stringify(configured)}`
    )
  }
}

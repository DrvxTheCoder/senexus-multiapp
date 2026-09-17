"use client"

import type { AssetValue } from "@/components/forms/asset-field"
import { uploadAsset, type AssetKind } from "@/server/actions/uploads"

/**
 * Turns what an `AssetField` holds into the string a form action stores.
 *
 * The three states the field can express map onto exactly three outcomes, and
 * the middle one is why this is a function rather than a line in each dialog:
 *
 *   - a new `File` → uploaded here, and its URL returned;
 *   - no file, `url` unchanged → returned as-is, **no request at all**;
 *   - no file, `url` cleared → `null`, which the action stores as "removed".
 *
 * Skipping the upload when nothing was chosen is the part that matters: a
 * dialog that re-uploads the existing logo on every save doubles the stored
 * blobs of any firm whose name is edited twice.
 */
export async function resolveAsset(
  value: AssetValue,
  kind: AssetKind,
  ownerId?: string | null
): Promise<
  { ok: true; url: string | null } | { ok: false; message: string }
> {
  if (!value.file) return { ok: true, url: value.url }

  const body = new FormData()
  body.set("kind", kind)
  if (ownerId) body.set("ownerId", ownerId)
  body.set("file", value.file)

  const result = await uploadAsset(body)
  if (!result.ok) return { ok: false, message: result.message }
  return { ok: true, url: result.data.url }
}

/**
 * The same, for a form that carries several images — the firm dialog has a
 * logo, an en-tête and a cachet.
 *
 * Uploads run in parallel and the first failure is reported: one message about
 * a refused file is more useful than three, and the caller keeps the dialog
 * open so nothing is lost.
 */
export async function resolveAssets<K extends string>(
  entries: Record<K, { value: AssetValue; kind: AssetKind }>,
  ownerId?: string | null
): Promise<
  { ok: true; urls: Record<K, string | null> } | { ok: false; message: string }
> {
  const keys = Object.keys(entries) as K[]
  const settled = await Promise.all(
    keys.map((key) =>
      resolveAsset(entries[key].value, entries[key].kind, ownerId)
    )
  )

  const failure = settled.find((result) => !result.ok)
  if (failure && !failure.ok) return { ok: false, message: failure.message }

  const urls = {} as Record<K, string | null>
  keys.forEach((key, index) => {
    const result = settled[index]
    urls[key] = result.ok ? result.url : null
  })
  return { ok: true, urls }
}

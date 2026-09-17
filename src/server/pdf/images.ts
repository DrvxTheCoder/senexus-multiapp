import "server-only"

import sharp from "sharp"
import QRCode from "qrcode"

/**
 * Les images d'un document : en-tête, cachet, signature, QR.
 *
 * ## Why the bytes are fetched here rather than handed to react-pdf
 *
 * `<Image src="https://…" />` works, and three things make it the wrong choice
 * for a document nobody is watching render:
 *
 *   1. **WebP.** The uploader accepts it — it is in `IMAGE_MIME` — and
 *      react-pdf does not decode it at all. A firm that uploads a WebP
 *      letterhead gets a PDF that throws on render, weeks after the upload,
 *      with no connection between the two. Everything is normalised to PNG on
 *      the way through, so the format an operator happened to pick stops
 *      mattering.
 *   2. **Failure.** A fetch that 404s inside the renderer takes the whole
 *      document down. Here it returns `null`, the block that wanted the image
 *      is simply not drawn, and the bon still prints — which is the right
 *      trade for a letterhead and, for a signature, is the *only* acceptable
 *      one: a visa box with no signature is honest, and a document that fails
 *      to generate helps nobody.
 *   3. **Repetition.** A bon prints in three copies and a facture may run to
 *      several pages; the letterhead and the cachet are the same bytes each
 *      time. Fetched once per document, embedded once per use.
 *
 * ## The cache
 *
 * Letterheads, cachets and signatures change perhaps twice a year and are
 * read on every document. A small in-process cache keeps a run of fifty bons
 * from making fifty identical round trips to Zipline. It is per-process and
 * short-lived on purpose: nothing here is worth a stale logo for an hour.
 */

const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 64

/** Bytes an asset must stay under to be embedded. A letterhead is not a photo. */
const MAX_ASSET_BYTES = 5 * 1024 * 1024

type Entry = { data: string | null; at: number }

const cache = new Map<string, Entry>()

function remember(key: string, data: string | null): string | null {
  // Oldest-first eviction. The map preserves insertion order, so the first
  // key is the least recently *written* — good enough for a handful of brand
  // assets, and it costs no bookkeeping.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { data, at: Date.now() })
  return data
}

export type FittedImage = {
  /** `data:image/png;base64,…`, ready for `<Image src>`. */
  src: string
  width: number
  height: number
  /** height / width — lets a caller reserve the right box before layout. */
  ratio: number
}

/**
 * Fetches a stored image and returns it as an embeddable PNG.
 *
 * Returns `null` for anything that does not work out — no URL, a host that is
 * down, a file that is not an image, something absurdly large. Every caller
 * treats that as "this document has no letterhead", which is a document that
 * still prints.
 */
export async function documentImage(
  url: string | null | undefined
): Promise<FittedImage | null> {
  if (!url) return null

  const cached = cache.get(url)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data ? decode(cached.data) : null
  }

  try {
    const response = await fetch(url, { cache: "no-store" })
    if (!response.ok) {
      remember(url, null)
      return null
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      console.warn("Document asset too large to embed", { bytes: bytes.byteLength })
      remember(url, null)
      return null
    }

    // `png()` normalises WebP, JPEG and anything else sharp reads. The alpha
    // channel is kept — a signature and a cachet are both transparent PNGs,
    // and flattening them onto white would paint a box over whatever they sit
    // on.
    const png = await sharp(bytes).png().toBuffer()
    const meta = await sharp(png).metadata()
    if (!meta.width || !meta.height) {
      remember(url, null)
      return null
    }

    const encoded = `${meta.width}x${meta.height}|data:image/png;base64,${png.toString("base64")}`
    remember(url, encoded)
    return decode(encoded)
  } catch {
    // Never the URL's contents and never a stack: a brand asset failing to
    // load is an operational note, not an incident.
    console.warn("Document asset could not be embedded")
    remember(url, null)
    return null
  }
}

function decode(encoded: string): FittedImage {
  const separator = encoded.indexOf("|")
  const [width, height] = encoded
    .slice(0, separator)
    .split("x")
    .map((value) => Number.parseInt(value, 10))
  return {
    src: encoded.slice(separator + 1),
    width,
    height,
    ratio: height / width,
  }
}

/** Fetches several at once, in the order given. */
export async function documentImages(
  urls: (string | null | undefined)[]
): Promise<(FittedImage | null)[]> {
  return Promise.all(urls.map((url) => documentImage(url)))
}

/**
 * The verification QR, as a PNG.
 *
 * Rendered at a fixed 512 px and scaled down by the layout: a QR is a grid of
 * hard edges, and letting the PDF viewer upscale a 128 px bitmap is what makes
 * a printed code fail to scan. Error correction M with a 2-module quiet zone,
 * which is what the specification asks for and what most phone cameras assume.
 *
 * Unlike the card's, this code has no size budget to respect — a sheet of A4
 * has room — so the token goes in whole rather than being packed.
 */
export async function qrImage(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
    color: { dark: "#000000ff", light: "#ffffffff" },
  })
}

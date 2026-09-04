/**
 * Generates the PWA icon set from one vector source.
 *
 * Run after changing the mark:  node scripts/gen-icons.mjs
 *
 * Two shapes are produced for each size. The plain icon has its own padding and
 * rounded corners, for platforms that use the image as-is. The maskable variant
 * fills the full square with the brand colour and keeps the mark inside the
 * safe zone (the middle 80%), so Android can crop it to a circle, a squircle or
 * anything else without slicing the letters off.
 */
import sharp from "sharp"
import { mkdir } from "node:fs/promises"

const BRAND = "#0B5D53"
const PAPER = "#EFF1EE"

const mark = (size, { maskable }) => {
  // Safe zone: a maskable icon may be cropped to 80% of its box.
  const inset = maskable ? size * 0.1 : 0
  const box = size - inset * 2
  const radius = maskable ? 0 : size * 0.22
  const fontSize = box * 0.42

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="${maskable ? BRAND : "none"}"/>
      <rect x="${inset}" y="${inset}" width="${box}" height="${box}"
            rx="${radius}" ry="${radius}" fill="${BRAND}"/>
      <text x="50%" y="50%" dy="0.34em" text-anchor="middle"
            font-family="IBM Plex Sans, Segoe UI, Helvetica, Arial, sans-serif"
            font-size="${fontSize}" font-weight="600" fill="${PAPER}"
            letter-spacing="${-fontSize * 0.03}">SX</text>
    </svg>
  `)
}

await mkdir("public/icons", { recursive: true })

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-192-maskable.png", size: 192, maskable: true },
  { file: "icon-512-maskable.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: true },
]

for (const target of targets) {
  await sharp(mark(target.size, { maskable: target.maskable }))
    .png({ compressionLevel: 9 })
    .toFile(`public/icons/${target.file}`)
  console.log(`  public/icons/${target.file}  ${target.size}x${target.size}`)
}

// favicon.ico is served from src/app/favicon.ico by Next; this is the PNG used
// by browsers that prefer one.
await sharp(mark(32, { maskable: false })).png().toFile("public/icons/favicon-32.png")
console.log("  public/icons/favicon-32.png  32x32")

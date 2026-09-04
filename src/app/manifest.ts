import type { MetadataRoute } from "next"

/**
 * Q14 — the web app manifest.
 *
 * `app/manifest.ts` is the Next 16 convention: one manifest, served at
 * /manifest.webmanifest, discovered automatically. The old application scattered
 * this across pages, which is why the install prompt appeared on the firm
 * selector and never on the login page — the manifest was only reachable from
 * some routes.
 *
 * `start_url` is the root, which routes a signed-in user to their firm and an
 * anonymous one to sign-in. An installed window therefore lands somewhere
 * sensible whatever the session state, instead of deep-linking into a firm the
 * user may no longer belong to.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Senexus — gestion du personnel",
    short_name: "Senexus",
    description:
      "Gestion du personnel, des contrats et des clients du groupe Senexus.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#EFF1EE",
    theme_color: "#0B5D53",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Maskable variants let Android crop to its own shape without clipping
      // the mark — the reason an installed icon otherwise looks wrong.
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Tableau de bord", url: "/" },
      { name: "Décisions", url: "/" },
    ],
  }
}

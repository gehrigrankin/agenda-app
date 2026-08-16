import type { MetadataRoute } from "next";

/**
 * PWA manifest (served at /manifest.webmanifest, auto-linked by Next). Two
 * jobs:
 *
 * 1. Installability — standalone display + real icons (public/icons/, both
 *    "any" and dedicated maskable variants whose glyph fits the ~80% safe
 *    zone), colors matching the default light palette in globals.css (--color-canvas
 *    page background, --color-bar top bar).
 * 2. Share target — once installed, the app appears in the OS share sheet.
 *    Shares POST multipart/form-data (title/text/url + optional images) to
 *    /app/share, which stores a capture_inbox row and lands on /app/inbox.
 *    This is the real capture path (CONTEXT.md "Product coherence decisions");
 *    the demo email-address facade is gone.
 *
 * Nothing here affects plain browser usage — uninstalled browsers ignore
 * share_target, and the service worker (public/sw.js) is passthrough.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agenda",
    short_name: "Agenda",
    description: "Notes, tasks, and a daily agenda.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f8faf8",
    theme_color: "#f8faf8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    share_target: {
      action: "/app/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "images", accept: ["image/*"] }],
      },
    },
  };
}

"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (public/sw.js — passthrough fetch + push
 * handlers). Mounted once in the app shell; renders nothing. Browsers without
 * service worker support (or non-secure contexts) skip it silently, so plain
 * browser usage is unaffected.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.error("[pwa] service worker register failed:", err));
  }, []);

  return null;
}

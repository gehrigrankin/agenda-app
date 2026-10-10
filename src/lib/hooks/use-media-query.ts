"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. The server (and hydration) render sees
 * `false`; the real answer arrives in the post-hydration re-render.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The tablet layout (Notes Sidebars design §4/§6): md+ but either narrower
 * than lg or finger-driven. Right-hand detail sidebars become slide-over
 * panels here instead of a third docked column.
 */
export const TABLET_QUERY =
  "(min-width: 768px) and ((max-width: 1023.98px) or (pointer: coarse))";

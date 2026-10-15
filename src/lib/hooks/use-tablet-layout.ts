"use client";

import { useSyncExternalStore } from "react";

/**
 * Tablet mode of the docked layout (Notes Sidebars design §6): md–lg widths or
 * any coarse primary pointer. Matches the main nav's own rule, so a page's
 * sidebars collapse into their tablet shape exactly when the nav shrinks to
 * its 60px rail. The server and hydration pass see `false` (desktop); the real
 * answer lands in the re-render useSyncExternalStore forces before paint.
 */
const QUERY = "(max-width: 1023.98px), (pointer: coarse)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useTabletLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

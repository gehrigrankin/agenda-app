"use client";

import { useEffect, useRef } from "react";

/**
 * Dismiss an open menu on an outside pointer press or Escape.
 *
 * This exists because the `fixed inset-0` backdrop-button trick does NOT work
 * here: a `backdrop-filter` (or `transform`/`filter`) ancestor becomes the
 * containing block for fixed positioning, so the "full-screen" scrim collapses
 * to that ancestor's box and clicks outside it never reach the backdrop. Half
 * this app's chrome is `backdrop-blur`, so the document-level listener is the
 * only reliable dismissal. A menu that opens inside a blurred panel and never
 * closes is the bug this replaces.
 *
 * `onClose` receives how the dismissal happened so callers can treat a stray
 * outside click differently from an explicit Escape (the note composer stays
 * open on outside clicks once it holds typed text).
 */
export function useOutsideClose(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onClose: (via: "pointer" | "escape") => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCloseRef.current("pointer");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current("escape");
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref]);
}

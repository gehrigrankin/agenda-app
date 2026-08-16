"use client";

import { useEffect, useState } from "react";

const WRITING_TARGET =
  '[contenteditable="true"], textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="number"]';

/**
 * Whether phone chrome should get out of the way for the on-screen keyboard.
 * Focus is the primary signal (and makes the transition immediate); the visual
 * viewport catches keyboards opened by editors that move focus internally.
 */
export function useMobileWritingMode(enabled: boolean) {
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setWriting(false);
      return;
    }

    const phone = window.matchMedia("(max-width: 767px)");
    const viewport = window.visualViewport;
    const isWritingTarget = (target: EventTarget | null) =>
      target instanceof Element && target.closest(WRITING_TARGET) !== null;
    const keyboardIsVisible = () =>
      viewport !== null && window.innerHeight - viewport.height > 140;
    const update = () => {
      if (!phone.matches) {
        setWriting(false);
        return;
      }
      setWriting(
        isWritingTarget(document.activeElement) || keyboardIsVisible(),
      );
    };
    const handleFocusOut = () => window.setTimeout(update, 0);

    document.addEventListener("focusin", update);
    document.addEventListener("focusout", handleFocusOut);
    // Lexical can move focus inside its editor without producing a focusin
    // that reaches document in every Chromium/WebView build. A click lands
    // after focus has settled, so it is a reliable second signal on Android.
    document.addEventListener("click", update, true);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    phone.addEventListener("change", update);
    update();

    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("click", update, true);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      phone.removeEventListener("change", update);
    };
  }, [enabled]);

  return writing;
}

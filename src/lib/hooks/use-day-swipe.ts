"use client";

import { useEffect, useRef } from "react";

/**
 * Swipe horizontally to turn the page — trackpad, Magic Mouse, or touch.
 *
 * TRACKPAD is the hard case. A two-finger horizontal pan arrives as `wheel`
 * events with `deltaX`, and three things go wrong if you just read them:
 *
 *  1. macOS Safari and Chrome claim that gesture for history back/forward. We
 *     take it back by preventing the default on horizontal-dominant events
 *     (hence a NON-PASSIVE listener) — paired with `overscroll-behavior-x` on
 *     the element, which is what actually suppresses the navigation overscroll.
 *  2. There is no "fingers lifted" event and macOS sends a long inertia tail,
 *     so one flick reads as a continuous shove. We fire at most once per
 *     gesture and only re-arm after the wheel stream has been quiet
 *     (`QUIET_MS`) — the only reliable signal that a gesture ended.
 *  3. Horizontal deltas also come from shift+scroll and from panning inside a
 *     wide code block or table. So the gesture must be clearly horizontal
 *     (`DOMINANCE`), and anything with a horizontally scrollable ancestor is
 *     left alone — that content owns the gesture.
 *
 * TOUCH is easy by comparison: real start/end events, so the accumulator
 * resets naturally. The one concession is `EDGE_ZONE`, which ignores swipes
 * begun at the very edge of the screen so iOS's own back gesture still works.
 *
 * Direction follows the browser's own convention, so the gesture means the same
 * thing here as everywhere else: fingers right (deltaX < 0) goes back a day,
 * fingers left goes forward.
 */

/** Accumulated px before a flip fires. Trackpad flicks overshoot this easily. */
const WHEEL_THRESHOLD = 110;
/** Touch is a direct manipulation, so it takes a shorter, deliberate drag. */
const TOUCH_THRESHOLD = 64;
/** Silence that marks the end of a wheel gesture, inertia included. */
const QUIET_MS = 160;
/** How much horizontal has to beat vertical before we call it a swipe. */
const DOMINANCE = 1.6;
/** Ignore touches begun this close to the edge — the OS wants those. */
const EDGE_ZONE = 28;

/** True if anything between `target` and `root` can scroll sideways itself. */
function hasScrollableXAncestor(target: EventTarget | null, root: HTMLElement) {
  let node = target instanceof Node ? target : null;
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    node = node.parentNode;
  }
  return false;
}

export function useDaySwipe({
  onPrev,
  onNext,
  enabled = true,
}: {
  onPrev: () => void;
  onNext: () => void;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Held in a ref so the listeners never need re-binding when the day changes —
  // rebinding mid-gesture would drop the accumulator and eat the flick.
  const handlers = useRef({ onPrev, onNext });
  handlers.current = { onPrev, onNext };

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    // --- Trackpad / Magic Mouse ---------------------------------------------
    let accX = 0;
    let accY = 0;
    let firedThisGesture = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const endGesture = () => {
      accX = 0;
      accY = 0;
      firedThisGesture = false;
      quietTimer = null;
    };

    const onWheel = (e: WheelEvent) => {
      // Pinch-zoom arrives as ctrl+wheel; never ours.
      if (e.ctrlKey) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
        // A vertical scroll in the middle of reading — let it through, and let
        // it end any horizontal gesture that was in progress.
        if (Math.abs(e.deltaY) > 0 && accX !== 0) endGesture();
        return;
      }
      if (hasScrollableXAncestor(e.target, el)) return;

      // Ours: stop the browser turning this into a back/forward navigation.
      e.preventDefault();

      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(endGesture, QUIET_MS);

      accX += e.deltaX;
      accY += e.deltaY;
      if (firedThisGesture) return;
      if (Math.abs(accX) < WHEEL_THRESHOLD) return;
      if (Math.abs(accX) < Math.abs(accY) * DOMINANCE) return;

      firedThisGesture = true;
      if (accX < 0) handlers.current.onPrev();
      else handlers.current.onNext();
    };

    // --- Touch ---------------------------------------------------------------
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let firedThisTouch = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      // Leave the OS its edge gesture.
      if (
        t.clientX < EDGE_ZONE ||
        t.clientX > window.innerWidth - EDGE_ZONE
      ) {
        tracking = false;
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      firedThisTouch = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || firedThisTouch || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < TOUCH_THRESHOLD) return;
      if (Math.abs(dx) < Math.abs(dy) * DOMINANCE) {
        // Settled into a vertical scroll — this touch is not a page turn.
        tracking = false;
        return;
      }
      if (hasScrollableXAncestor(e.target, el)) {
        tracking = false;
        return;
      }
      firedThisTouch = true;
      // Same sign convention as the wheel: dragging the page leftwards (dx < 0)
      // pulls the next day in from the right.
      if (dx > 0) handlers.current.onPrev();
      else handlers.current.onNext();
    };

    const onTouchEnd = () => {
      tracking = false;
      firedThisTouch = false;
    };

    // passive: false on wheel is what makes preventDefault legal, and
    // preventDefault is the only thing that stops swipe-to-go-back.
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      if (quietTimer) clearTimeout(quietTimer);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled]);

  return ref;
}

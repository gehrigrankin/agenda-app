"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll vertically past the edge of the page to snap to the next day.
 *
 * Not a feed: the days never sit in one long scroll. A vertical wheel gesture
 * that STARTS with nothing left to scroll in its direction is ours — the page
 * pulls against a rubber band, and past `THRESHOLD` it snaps through: the day
 * slides out, the next one slides in. Short of it, the page springs back.
 *
 * The rules that keep it from fighting reading:
 *
 *  1. A gesture belongs to whoever it starts with. If the scroller under the
 *     pointer (the note, the agenda) can still move that way, the whole
 *     gesture — inertia tail included — is a normal scroll, even once it hits
 *     the bottom. Turning the page takes a fresh gesture at the edge, so a
 *     long fling to the end of a note never overshoots into tomorrow.
 *  2. One day per gesture. After a snap the rest of the stream is swallowed
 *     until it has been quiet for `QUIET_MS` (the only "fingers lifted" signal
 *     a trackpad gives), so a flick's inertia can't flip a second day or
 *     scroll the newly arrived one.
 *  3. Horizontal-dominant events are left to `useDaySwipe`; pinch (ctrl+wheel)
 *     and anything inside a menu, listbox or dialog are never ours.
 *
 * `QUIET_MS` is longer than the swipe hook's because a mouse wheel turned
 * notch by notch arrives in bursts ~100–200ms apart, and those notches have to
 * add up to one gesture for the rubber band to feel continuous.
 *
 * Direction follows the scroll: down is the next day, up the previous.
 */

/** Accumulated px before the page snaps — about two mouse-wheel notches. */
const THRESHOLD = 160;
/** Silence that marks the end of a wheel gesture, inertia included. */
const QUIET_MS = 260;
/** Vertical has to beat horizontal by this much to count. */
const DOMINANCE = 1.2;
/** The rubber band: the page's furthest pull, and how fast it gets there. */
const PULL_MAX = 48;
const PULL_K = 140;
/** Snap-through: slide out, swap the day, slide the new one in. */
const OUT_MS = 120;
const IN_MS = 220;
const TRAVEL = 36;

/** Line/page-mode deltas (Firefox) normalized to pixels. */
function deltaPx(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * 40;
  if (e.deltaMode === 2) return e.deltaY * 800;
  return e.deltaY;
}

/** True if anything between `target` and `root` can still scroll `dir`. */
function canScrollY(
  target: EventTarget | null,
  root: HTMLElement,
  dir: 1 | -1,
): boolean {
  let node = target instanceof Node ? target : null;
  while (node && node !== root) {
    if (
      node instanceof HTMLElement &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        if (
          dir < 0
            ? node.scrollTop > 0
            : node.scrollTop + node.clientHeight < node.scrollHeight - 1
        ) {
          return true;
        }
      }
    }
    node = node.parentNode;
  }
  return false;
}

function inOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="menu"],[role="listbox"],[role="dialog"]') !== null
  );
}

export function useDayScrollSnap({
  onPrev,
  onNext,
  enabled = true,
  bindKey,
}: {
  onPrev: () => void;
  onNext: () => void;
  enabled?: boolean;
  /** Change this when the ref moves to a different element so the listener
   *  rebinds to the new one. */
  bindKey?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // In a ref so a day change never rebinds the listener mid-gesture.
  const handlers = useRef({ onPrev, onNext });
  handlers.current = { onPrev, onNext };

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    // null: no gesture. "native": the scroller owns it. "pull": ours, pulling.
    // "done": snapped; swallow the rest.
    let mode: null | "native" | "pull" | "done" = null;
    let dir: 1 | -1 = 1;
    let acc = 0;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    const animTimers: ReturnType<typeof setTimeout>[] = [];

    const setStyle = (
      transform: string,
      opacity: string,
      transition: string,
    ) => {
      el.style.transition = transition;
      el.style.transform = transform;
      el.style.opacity = opacity;
    };
    // Cleared, not zeroed: a transform on this ancestor would re-anchor any
    // position: fixed popover inside it (editor toolbars, menus).
    const clearStyle = () => setStyle("", "", "");

    const springBack = () => {
      if (reduced.matches || !el.style.transform) return clearStyle();
      setStyle("translateY(0)", "", "transform 200ms ease-out");
      animTimers.push(setTimeout(clearStyle, 200));
    };

    const endGesture = () => {
      quietTimer = null;
      if (mode === "pull") springBack();
      mode = null;
      acc = 0;
    };

    const snap = () => {
      mode = "done";
      const turn = () =>
        dir > 0 ? handlers.current.onNext() : handlers.current.onPrev();
      if (reduced.matches) {
        clearStyle();
        turn();
        return;
      }
      setStyle(
        `translateY(${-dir * TRAVEL}px)`,
        "0",
        `transform ${OUT_MS}ms ease-in, opacity ${OUT_MS}ms ease-in`,
      );
      animTimers.push(
        setTimeout(() => {
          turn();
          // The new day enters from the side the gesture came from.
          setStyle(`translateY(${dir * TRAVEL}px)`, "0", "none");
          // Next frame, so the browser lays out the start position first.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              setStyle(
                "translateY(0)",
                "1",
                `transform ${IN_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${IN_MS}ms ease-out`,
              );
              animTimers.push(setTimeout(clearStyle, IN_MS));
            }),
          );
        }, OUT_MS),
      );
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      const dy = deltaPx(e);
      if (dy === 0 || Math.abs(dy) < Math.abs(e.deltaX) * DOMINANCE) return;
      if (inOverlay(e.target)) return;

      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(endGesture, QUIET_MS);

      const eventDir: 1 | -1 = dy > 0 ? 1 : -1;
      if (mode === null) {
        dir = eventDir;
        mode = canScrollY(e.target, el, dir) ? "native" : "pull";
      }
      if (mode === "native") return;
      if (mode === "done") {
        e.preventDefault();
        return;
      }

      // Pulling. A reversal hands the gesture back to the scroller.
      if (eventDir !== dir) {
        mode = "native";
        acc = 0;
        springBack();
        return;
      }
      e.preventDefault();
      acc += dy;
      if (Math.abs(acc) >= THRESHOLD) {
        snap();
        return;
      }
      if (!reduced.matches) {
        const pull = PULL_MAX * (1 - Math.exp(-Math.abs(acc) / PULL_K));
        setStyle(`translateY(${-dir * pull}px)`, "", "none");
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (quietTimer) clearTimeout(quietTimer);
      animTimers.forEach(clearTimeout);
      el.removeEventListener("wheel", onWheel);
      clearStyle();
    };
  }, [enabled, bindKey]);

  return ref;
}

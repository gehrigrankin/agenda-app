"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Circle, Plus, StickyNote } from "lucide-react";

import type { BubbleData, BubbleNoteData } from "./types";
import { bodyClassFor, headerClassFor } from "./colors";
import { BubbleControls } from "./BubbleControls";
import { LatchedInput } from "./LatchedInput";

/**
 * Infinite, pannable/zoomable canvas for the whole bubble tree.
 *
 * Bubbles are rounded rectangular containers that physically hold their
 * content: child containers and note cards are shelf-packed inside the parent
 * body, so a parent is always exactly as big as what it contains. The whole
 * tree is laid out once in stable "world" coordinates; a single CSS transform
 * (translate + scale) on the world layer provides pan/zoom.
 *
 * Semantic zoom: a container renders in "detail" mode (header strip + real
 * content) once it's wide enough on screen, and as a compact "tile" (emoji +
 * title) when smaller. Notes only render inside detail-mode parents. Tiny or
 * off-screen subtrees are culled — valid because children always lie inside
 * their parent's rect.
 *
 * Input model:
 * - Taps are detected explicitly on pointerup (never via the browser `click`
 *   event, which is unreliable on iOS Safari after `setPointerCapture`). A tap
 *   is: single pointer, press < 500ms, moved less than the per-pointer-type
 *   drag threshold. Any second pointer (pinch) cancels tap eligibility.
 * - Pressing a container's header (or a tile) targets that bubble; pressing a
 *   note card targets the note. Handlers run innermost-first (React bubbling),
 *   and the first press target wins, so nested content beats its ancestors.
 * - Double-tap/double-click on empty canvas goes up one level.
 */

// ---- Layout tuning ---------------------------------------------------------
const MAX_SCALE = 12;
const ZOOM_SENS = 0.0016; // wheel delta → zoom factor

const NOTE_W = 150; // fixed note card size (world units)
const NOTE_H = 100;
const EMPTY_BODY_W = 200; // body size of a container with no content
const EMPTY_BODY_H = 110;
const PAD = 18; // inset between a container edge and its content
const GAP = 14; // gap between shelf-packed items
const HEADER_FRAC = 0.09; // header height as a fraction of container width
const HEADER_MIN = 34;
const TARGET_ASPECT = 4 / 3; // shelf packing aims for this body aspect ratio
const RADIUS_FRAC = 0.045; // corner radius as a fraction of the short side
const DETAIL_MIN_PX = 180; // screen width above which a container shows detail
const TILE_MIN_PX = 14; // screen width below which a container isn't drawn
const FADE_BAND_PX = 18; // px over which a revealed container fades in
const NOTE_PREVIEW_MIN_PX = 70; // note screen width needed to render preview text
const FOCUS_MARGIN = 0.92; // focused container fills this much of the viewport

// ---- Input tuning ----------------------------------------------------------
// Fingers wobble far more than a mouse: a 4px threshold makes almost every
// touch tap read as a pan, so the threshold is per pointer type.
const DRAG_THRESHOLD_MOUSE = 4;
const DRAG_THRESHOLD_TOUCH = 12;
const TAP_MAX_MS = 500; // press longer than this is not a tap
const DOUBLE_TAP_MS = 350; // two empty-canvas taps within this = go up
const DOUBLE_TAP_DIST = 30; // ...and within this many px of each other
const BUTTON_ZOOM = 1.4; // zoom factor for +/- controls and keyboard
const KEY_PAN_PX = 80; // arrow-key pan distance

const clamp = (min: number, v: number, max: number) =>
  Math.max(min, Math.min(v, max));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface Placed {
  x: number; // top-left corner (world units)
  y: number;
  w: number;
  h: number;
  headerH: number;
  idx: number; // sibling index (for fallback color)
  depth: number;
}

interface NotePlaced {
  x: number;
  y: number;
  w: number;
  h: number;
  bubbleId: string;
}

/**
 * What a pointerdown landed on. `draggable` is plumbed for the upcoming
 * drag & drop work (root can't be dragged; body presses aren't drags) but is
 * not consumed yet.
 */
type PressTarget =
  | { kind: "bubble"; id: string; draggable: boolean }
  | { kind: "note"; id: string; bubbleId: string };

interface View {
  x: number; // pan (screen px)
  y: number;
  scale: number;
}

interface ShelfItem {
  kind: "bubble" | "note";
  id: string;
  dx: number; // offset from the parent's body origin
  dy: number;
  w: number;
  h: number;
}

/**
 * Bottom-up measure + top-down place. Every container is sized to hold its
 * children and notes shelf-packed in order (children first, then notes),
 * aiming for a roughly 4:3 body. The root is centered on the world origin.
 */
function buildLayout(
  nodes: BubbleData[],
  childrenOf: Map<string, BubbleData[]>,
  notesOf: Map<string, BubbleNoteData[]>,
): {
  pos: Map<string, Placed>;
  notePos: Map<string, NotePlaced>;
  rootId: string | null;
  rootSize: { w: number; h: number };
} {
  const pos = new Map<string, Placed>();
  const notePos = new Map<string, NotePlaced>();
  const root = nodes.find((n) => n.parentId === null);
  if (!root) return { pos, notePos, rootId: null, rootSize: { w: 1, h: 1 } };

  const sizeOf = new Map<string, { w: number; h: number; headerH: number }>();
  const shelfOf = new Map<string, ShelfItem[]>();

  const measure = (
    id: string,
    seen: Set<string>,
  ): { w: number; h: number; headerH: number } => {
    const cached = sizeOf.get(id);
    if (cached) return cached;
    if (seen.has(id)) {
      // Corrupt parent cycle: return a degenerate empty measure instead of
      // recursing forever. The entry on the stack overwrites this when it
      // finishes.
      const w = EMPTY_BODY_W + 2 * PAD;
      const headerH = Math.max(HEADER_MIN, HEADER_FRAC * w);
      return { w, h: headerH + PAD + EMPTY_BODY_H + PAD, headerH };
    }
    seen.add(id);

    const items: Array<{ kind: "bubble" | "note"; id: string; w: number; h: number }> =
      [];
    for (const kid of childrenOf.get(id) ?? []) {
      const m = measure(kid.id, seen);
      items.push({ kind: "bubble", id: kid.id, w: m.w, h: m.h });
    }
    for (const note of notesOf.get(id) ?? []) {
      items.push({ kind: "note", id: note.id, w: NOTE_W, h: NOTE_H });
    }

    const shelf: ShelfItem[] = [];
    let bodyW: number;
    let bodyH: number;
    if (items.length === 0) {
      bodyW = EMPTY_BODY_W;
      bodyH = EMPTY_BODY_H;
    } else {
      const totalArea = items.reduce(
        (sum, it) => sum + (it.w + GAP) * (it.h + GAP),
        0,
      );
      const targetRowW = Math.max(
        Math.max(...items.map((it) => it.w)),
        Math.sqrt(totalArea * TARGET_ASPECT),
      );
      let rowX = 0;
      let rowTop = 0;
      let rowH = 0;
      bodyW = 0;
      for (const it of items) {
        if (rowX > 0 && rowX + it.w > targetRowW) {
          rowTop += rowH + GAP;
          rowX = 0;
          rowH = 0;
        }
        shelf.push({ kind: it.kind, id: it.id, dx: rowX, dy: rowTop, w: it.w, h: it.h });
        bodyW = Math.max(bodyW, rowX + it.w);
        rowX += it.w + GAP;
        rowH = Math.max(rowH, it.h);
      }
      bodyH = rowTop + rowH;
    }

    const w = bodyW + 2 * PAD;
    const headerH = Math.max(HEADER_MIN, HEADER_FRAC * w);
    const m = { w, h: headerH + PAD + bodyH + PAD, headerH };
    sizeOf.set(id, m);
    shelfOf.set(id, shelf);
    return m;
  };

  const rootM = measure(root.id, new Set());

  const place = (
    id: string,
    x: number,
    y: number,
    idx: number,
    depth: number,
    seen: Set<string>,
  ) => {
    if (seen.has(id)) return;
    seen.add(id);
    const m = sizeOf.get(id);
    if (!m) return;
    pos.set(id, { x, y, w: m.w, h: m.h, headerH: m.headerH, idx, depth });
    const bx = x + PAD;
    const by = y + m.headerH + PAD;
    let childIdx = 0;
    for (const item of shelfOf.get(id) ?? []) {
      if (item.kind === "bubble") {
        place(item.id, bx + item.dx, by + item.dy, childIdx, depth + 1, seen);
        childIdx += 1;
      } else {
        notePos.set(item.id, {
          x: bx + item.dx,
          y: by + item.dy,
          w: NOTE_W,
          h: NOTE_H,
          bubbleId: id,
        });
      }
    }
  };

  place(root.id, -rootM.w / 2, -rootM.h / 2, 0, 0, new Set());
  return {
    pos,
    notePos,
    rootId: root.id,
    rootSize: { w: rootM.w, h: rootM.h },
  };
}

type RenderItem =
  | {
      kind: "bubble";
      id: string;
      data: BubbleData;
      p: Placed;
      mode: "detail" | "tile";
      opacity: number;
    }
  | { kind: "note"; note: BubbleNoteData; np: NotePlaced; sw: number };

export function BubbleCanvas({
  nodes,
  childrenOf,
  notesOf,
  focusId,
  onFocus,
  onUp,
  canGoUp,
  onOpenNote,
  onAddBubble,
  onAddNote,
  keysDisabled = false,
}: {
  nodes: BubbleData[];
  childrenOf: Map<string, BubbleData[]>;
  notesOf: Map<string, BubbleNoteData[]>;
  focusId: string;
  onFocus: (id: string) => void;
  /** Focus the parent of the current bubble (no-op at root). */
  onUp: () => void;
  canGoUp: boolean;
  /** Open a note in the editor pane. */
  onOpenNote: (id: string) => void;
  /** Create a sub-bubble / note (from the quick-add popover). */
  onAddBubble: (parentId: string, title: string) => void;
  onAddNote: (bubbleId: string, title: string) => void;
  /** True while a dialog/popover owns the keyboard (delete confirm, style picker…). */
  keysDisabled?: boolean;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const { pos, notePos, rootId, rootSize } = useMemo(
    () => buildLayout(nodes, childrenOf, notesOf),
    [nodes, childrenOf, notesOf],
  );

  // Zoom floor: far enough out that the whole root fits at roughly half the
  // viewport, but never above the old absolute floor. Mirrored into a ref for
  // the once-bound wheel handler.
  const minScale = useMemo(() => {
    if (!rootId || dims.w === 0) return 0.015;
    return Math.min(
      0.015,
      ((FOCUS_MARGIN * Math.min(dims.w, dims.h)) /
        Math.max(rootSize.w, rootSize.h)) *
        0.5,
    );
  }, [rootId, rootSize, dims]);
  const minScaleRef = useRef(minScale);
  minScaleRef.current = minScale;

  // First-interaction latch: fades out the hint pill once the user has
  // panned/zoomed/tapped (per mount — fine to reappear on reload).
  const [interacted, setInteracted] = useState(false);
  const interactedRef = useRef(false);
  const markInteracted = () => {
    if (!interactedRef.current) {
      interactedRef.current = true;
      setInteracted(true);
    }
  };

  // Coarse-pointer detection for hint copy (iPad reads "pinch to zoom").
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // --- Measure the canvas ----------------------------------------------------
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Focus framing ---------------------------------------------------------
  const focusView = useCallbackFocusView(dims, pos, minScale);

  const initedRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const cancelAnim = () => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  };
  const animateTo = (target: View, dur = 540) => {
    cancelAnim();
    // Before initial framing there's no meaningful start view — jump straight
    // to the target instead of animating in from the origin.
    if (!initedRef.current) {
      viewRef.current = target;
      setView(target);
      return;
    }
    const start = viewRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = easeOutCubic(t);
      setView({
        x: lerp(start.x, target.x, e),
        y: lerp(start.y, target.y, e),
        scale: lerp(start.scale, target.scale, e),
      });
      animRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    animRef.current = requestAnimationFrame(step);
  };

  // Initial framing once we have a size + layout.
  useEffect(() => {
    if (initedRef.current || dims.w === 0 || dims.h === 0) return;
    const v = focusView(focusId) ?? (rootId ? focusView(rootId) : null);
    if (v) {
      // Sync the ref immediately so an animateTo in the same commit window
      // starts from the framed view, not the {0,0,1} default.
      viewRef.current = v;
      setView(v);
      initedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims, rootId]);

  // Animate to the focused bubble whenever it changes (after init).
  useEffect(() => {
    if (!initedRef.current) return;
    const v = focusView(focusId);
    if (v) animateTo(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  useEffect(() => () => cancelAnim(), []);

  // --- Quick-add popover (portaled; screen-space) -----------------------------
  const [quickAdd, setQuickAdd] = useState<{
    bubbleId: string;
    x: number;
    y: number;
  } | null>(null);
  const [quickAddMode, setQuickAddMode] = useState<null | "bubble" | "note">(
    null,
  );
  const [quickAddDraft, setQuickAddDraft] = useState("");

  const openQuickAdd = (bubbleId: string, anchor: DOMRect) => {
    markInteracted();
    // Below the button, clamped so the popover stays on screen.
    setQuickAdd({
      bubbleId,
      x: clamp(8, anchor.left + anchor.width / 2 - 88, window.innerWidth - 184),
      y: Math.min(anchor.bottom + 6, window.innerHeight - 96),
    });
    setQuickAddMode(null);
    setQuickAddDraft("");
  };
  const closeQuickAdd = () => {
    setQuickAdd(null);
    setQuickAddMode(null);
    setQuickAddDraft("");
  };

  const quickAddOpen = quickAdd !== null;
  useEffect(() => {
    if (!quickAddOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuickAdd(null);
        setQuickAddMode(null);
        setQuickAddDraft("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [quickAddOpen]);

  // --- Programmatic zoom / fit / home (controls + keyboard) ------------------
  const zoomAtCenter = (factor: number) => {
    markInteracted();
    const v = viewRef.current;
    const cx = dims.w / 2;
    const cy = dims.h / 2;
    const ns = clamp(minScale, v.scale * factor, MAX_SCALE);
    const ratio = ns / v.scale;
    animateTo(
      { scale: ns, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio },
      220,
    );
  };
  const fitFocus = () => {
    markInteracted();
    const v = focusView(focusId);
    if (v) animateTo(v, 320);
  };
  const goHome = () => {
    markInteracted();
    if (!rootId) return;
    if (focusId === rootId) {
      // Already home — just re-frame the root.
      const v = focusView(rootId);
      if (v) animateTo(v, 320);
    } else {
      onFocus(rootId);
    }
  };

  // --- Keyboard (canvas region focused via tabIndex) --------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (keysDisabled || quickAddOpen) return;
    const ae = document.activeElement as HTMLElement | null;
    if (
      ae &&
      (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)
    ) {
      return;
    }
    const pan = (dx: number, dy: number) => {
      markInteracted();
      cancelAnim();
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };
    switch (e.key) {
      case "+":
      case "=":
        e.preventDefault();
        zoomAtCenter(BUTTON_ZOOM);
        break;
      case "-":
      case "_":
        e.preventDefault();
        zoomAtCenter(1 / BUTTON_ZOOM);
        break;
      case "0":
        e.preventDefault();
        fitFocus();
        break;
      case "Escape":
      case "Backspace":
        if (canGoUp) {
          e.preventDefault();
          onUp();
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        pan(KEY_PAN_PX, 0);
        break;
      case "ArrowRight":
        e.preventDefault();
        pan(-KEY_PAN_PX, 0);
        break;
      case "ArrowUp":
        e.preventDefault();
        pan(0, KEY_PAN_PX);
        break;
      case "ArrowDown":
        e.preventDefault();
        pan(0, -KEY_PAN_PX);
        break;
    }
  };

  // --- Wheel zoom (toward cursor) -------------------------------------------
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnim();
      markInteracted();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = viewRef.current;
      const delta = clamp(-240, e.deltaY, 240);
      const factor = Math.exp(-delta * ZOOM_SENS);
      // Handler is bound once — the dynamic zoom floor is read via ref.
      const ns = clamp(minScaleRef.current, v.scale * factor, MAX_SCALE);
      const ratio = ns / v.scale;
      setView({
        scale: ns,
        x: sx - (sx - v.x) * ratio,
        y: sy - (sy - v.y) * ratio,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // --- Pan + pinch + tap (pointer events) ------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastSingle = useRef<{ x: number; y: number } | null>(null);
  const downPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinchDist = useRef(0);
  const pinchMid = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  // Drives the grab/grabbing cursor re-render.
  const [isPanning, setIsPanning] = useState(false);

  // Tap detection (explicit, in pointerup — the browser `click` event is
  // unreliable on iOS Safari once the container has pointer capture).
  const pressRef = useRef({ t: 0, eligible: false, threshold: DRAG_THRESHOLD_MOUSE });
  // Set by content pointerdown handlers (which run before the canvas's in the
  // bubbling phase), consumed by the canvas pointerdown. First target wins so
  // the innermost element under the pointer is the press target.
  const pendingPress = useRef<PressTarget | null>(null);
  // What the current gesture started on (null = empty canvas).
  const tapTargetRef = useRef<PressTarget | null>(null);
  const lastEmptyTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const pressStart = (target: PressTarget) => {
    if (pendingPress.current === null) pendingPress.current = target;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Capture on the container (not e.target): a world element can be culled
    // and unmounted mid-gesture, which would silently drop its captured
    // pointermove/pointerup stream and leave the pan stuck.
    elRef.current?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelAnim();
    if (pointers.current.size === 1) {
      lastSingle.current = { x: e.clientX, y: e.clientY };
      downPos.current = { x: e.clientX, y: e.clientY };
      movedRef.current = false;
      setIsPanning(true);
      pressRef.current = {
        t: performance.now(),
        eligible: true,
        threshold:
          e.pointerType === "mouse" ? DRAG_THRESHOLD_MOUSE : DRAG_THRESHOLD_TOUCH,
      };
      tapTargetRef.current = pendingPress.current;
    } else {
      // A second pointer means pinch — this gesture can never be a tap.
      pressRef.current.eligible = false;
      if (pointers.current.size === 2) {
        const pts = [...pointers.current.values()];
        const rect = elRef.current!.getBoundingClientRect();
        pinchDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchMid.current = {
          x: (pts[0].x + pts[1].x) / 2 - rect.left,
          y: (pts[0].y + pts[1].y) / 2 - rect.top,
        };
      }
    }
    pendingPress.current = null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const rect = elRef.current!.getBoundingClientRect();

    if (pts.length === 1) {
      const last = lastSingle.current;
      const cur = { x: e.clientX, y: e.clientY };
      if (last) {
        const dx = cur.x - last.x;
        const dy = cur.y - last.y;
        if (
          !movedRef.current &&
          Math.hypot(cur.x - downPos.current.x, cur.y - downPos.current.y) >
            pressRef.current.threshold
        ) {
          movedRef.current = true;
          markInteracted();
        }
        if (movedRef.current) {
          setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        }
      }
      lastSingle.current = cur;
    } else if (pts.length >= 2) {
      movedRef.current = true;
      markInteracted();
      const mid = {
        x: (pts[0].x + pts[1].x) / 2 - rect.left,
        y: (pts[0].y + pts[1].y) / 2 - rect.top,
      };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const prevD = pinchDist.current;
      const prevMid = pinchMid.current;
      if (prevD && prevMid) {
        setView((v) => {
          let nx = v.x + (mid.x - prevMid.x);
          let ny = v.y + (mid.y - prevMid.y);
          const ns = clamp(minScale, v.scale * (dist / prevD), MAX_SCALE);
          const ratio = ns / v.scale;
          nx = mid.x - (mid.x - nx) * ratio;
          ny = mid.y - (mid.y - ny) * ratio;
          return { x: nx, y: ny, scale: ns };
        });
      }
      pinchDist.current = dist;
      pinchMid.current = mid;
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    const wasTracked = pointers.current.has(e.pointerId);
    const wasLast = wasTracked && pointers.current.size === 1;

    // Explicit tap detection: single pointer, short press, under the movement
    // threshold, never joined by a second pointer, ended with pointerup.
    if (
      e.type === "pointerup" &&
      wasLast &&
      pressRef.current.eligible &&
      !movedRef.current &&
      performance.now() - pressRef.current.t < TAP_MAX_MS
    ) {
      markInteracted();
      const target = tapTargetRef.current;
      if (target) {
        lastEmptyTap.current = null;
        if (target.kind === "note") {
          onOpenNote(target.id);
        } else if (target.id === focusId) {
          // Tapping the already-focused bubble re-frames it.
          const v = focusView(target.id);
          if (v) animateTo(v, 320);
        } else {
          onFocus(target.id);
        }
      } else {
        // Empty canvas: two quick taps in the same spot go up one level.
        const now = performance.now();
        const prev = lastEmptyTap.current;
        if (
          prev &&
          now - prev.t < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_DIST
        ) {
          lastEmptyTap.current = null;
          if (canGoUp) onUp();
        } else {
          lastEmptyTap.current = { t: now, x: e.clientX, y: e.clientY };
        }
      }
    }

    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      pinchMid.current = null;
      pinchDist.current = 0;
    }
    if (pointers.current.size === 1) {
      const remaining = [...pointers.current.values()][0];
      lastSingle.current = { ...remaining };
    }
    if (pointers.current.size === 0) {
      setIsPanning(false);
      tapTargetRef.current = null;
    }
  };

  // --- Visible set (LOD + culling), in paint order ----------------------------
  // DFS from the root emitting: container, its notes, then child subtrees.
  // DOM order alone gives correct stacking and innermost-topmost hit testing.
  const renderList = useMemo(() => {
    const out: RenderItem[] = [];
    if (!rootId || dims.w === 0) return out;
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const { x: px, y: py, scale } = view;

    const onScreen = (x: number, y: number, w: number, h: number) => {
      const sx = x * scale + px;
      const sy = y * scale + py;
      return (
        sx + w * scale >= -40 &&
        sx <= dims.w + 40 &&
        sy + h * scale >= -40 &&
        sy <= dims.h + 40
      );
    };

    const walk = (id: string, seen: Set<string>) => {
      if (seen.has(id)) return;
      seen.add(id);
      const p = pos.get(id);
      const data = byId.get(id);
      if (!p || !data) return;
      // Children lie inside the parent rect, so both tests cull the subtree.
      if (!onScreen(p.x, p.y, p.w, p.h)) return;
      const sw = p.w * scale;
      if (sw < TILE_MIN_PX) return;

      const mode: "detail" | "tile" = sw >= DETAIL_MIN_PX ? "detail" : "tile";
      out.push({
        kind: "bubble",
        id,
        data,
        p,
        mode,
        opacity: clamp(0, (sw - TILE_MIN_PX) / FADE_BAND_PX, 1),
      });
      if (mode !== "detail") return;

      for (const note of notesOf.get(id) ?? []) {
        const np = notePos.get(note.id);
        if (!np || !onScreen(np.x, np.y, np.w, np.h)) continue;
        out.push({ kind: "note", note, np, sw: np.w * scale });
      }
      for (const kid of childrenOf.get(id) ?? []) walk(kid.id, seen);
    };

    walk(rootId, new Set());
    return out;
  }, [view, dims, pos, notePos, rootId, nodes, childrenOf, notesOf]);

  return (
    <div
      ref={elRef}
      tabIndex={0}
      role="application"
      aria-label="Bubble map — arrow keys pan, plus and minus zoom, Escape goes up a level"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      className="bubble-canvas-grid relative h-full w-full select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60"
      style={{
        touchAction: "none",
        cursor: isPanning ? "grabbing" : "grab",
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {renderList.map((item) =>
          item.kind === "bubble" ? (
            <WorldContainer
              key={item.id}
              data={item.data}
              p={item.p}
              mode={item.mode}
              opacity={item.opacity}
              isFocus={item.id === focusId}
              isRoot={item.id === rootId}
              noteCount={(notesOf.get(item.id) ?? []).length}
              childCount={(childrenOf.get(item.id) ?? []).length}
              onPressStart={pressStart}
              onOpenQuickAdd={openQuickAdd}
            />
          ) : (
            <WorldNoteCard
              key={item.note.id}
              note={item.note}
              np={item.np}
              sw={item.sw}
              onPressStart={pressStart}
            />
          ),
        )}
      </div>

      <BubbleControls
        onZoomIn={() => zoomAtCenter(BUTTON_ZOOM)}
        onZoomOut={() => zoomAtCenter(1 / BUTTON_ZOOM)}
        onFit={fitFocus}
        onUp={onUp}
        onHome={goHome}
        canGoUp={canGoUp}
      />

      {/* first-run hint — fades out after the first pan/zoom/tap */}
      <div
        aria-hidden={interacted}
        className={`pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-neutral-900/75 px-3.5 py-1.5 text-[11px] font-medium text-white/90 shadow-lg backdrop-blur-sm transition-opacity duration-700 dark:border-white/10 dark:bg-white/10 ${
          interacted ? "opacity-0" : "opacity-100"
        }`}
      >
        {coarsePointer
          ? "drag to pan · pinch to zoom · tap a board to dive in"
          : "drag to pan · scroll to zoom · click a board to dive in"}
      </div>

      {/* quick-add popover (screen-space; portaled above everything) */}
      {quickAdd &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close"
              onClick={closeQuickAdd}
              onPointerDown={(e) => e.stopPropagation()}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              style={{ left: quickAdd.x, top: quickAdd.y }}
              onPointerDown={(e) => e.stopPropagation()}
              className="animate-pop-in fixed z-50 w-44 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            >
              {quickAddMode === null ? (
                <>
                  <button
                    type="button"
                    onClick={() => setQuickAddMode("bubble")}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-neutral-700 transition-colors duration-150 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <Circle className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                    Sub-bubble
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickAddMode("note")}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-neutral-700 transition-colors duration-150 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <StickyNote className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                    Note
                  </button>
                </>
              ) : (
                <div className="px-2.5 py-1.5">
                  <LatchedInput
                    value={quickAddDraft}
                    onChange={setQuickAddDraft}
                    onCommit={() => {
                      const title = quickAddDraft.trim();
                      const { bubbleId } = quickAdd;
                      const mode = quickAddMode;
                      closeQuickAdd();
                      if (mode === "bubble") onAddBubble(bubbleId, title);
                      else onAddNote(bubbleId, title);
                    }}
                    onCancel={closeQuickAdd}
                    placeholder={
                      quickAddMode === "bubble"
                        ? "New sub-bubble name…"
                        : "Note title…"
                    }
                    className="w-full border-b border-blue-400 bg-transparent px-1 py-0.5 text-sm outline-none"
                  />
                </div>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

// useCallback wrapper that recomputes the framing transform for a bubble id:
// fit the container's rect at FOCUS_MARGIN of the viewport, centered.
function useCallbackFocusView(
  dims: { w: number; h: number },
  pos: Map<string, Placed>,
  minScale: number,
) {
  return useMemo(() => {
    return (id: string): View | null => {
      const p = pos.get(id);
      if (!p || dims.w === 0 || dims.h === 0) return null;
      const scale = clamp(
        minScale,
        FOCUS_MARGIN * Math.min(dims.w / p.w, dims.h / p.h),
        MAX_SCALE,
      );
      return {
        scale,
        x: dims.w / 2 - (p.x + p.w / 2) * scale,
        y: dims.h / 2 - (p.y + p.h / 2) * scale,
      };
    };
  }, [dims, pos, minScale]);
}

// ---------------------------------------------------------------------------
// A container in world space. Detail mode: colored header strip (emoji, title,
// counts, quick-add) over a translucent body holding the children/notes.
// Tile mode: compact centered emoji + title stand-in when small on screen.
// All type/spacing is proportional to the container's world size (self-similar
// at any zoom).
// ---------------------------------------------------------------------------
function WorldContainer({
  data,
  p,
  mode,
  opacity,
  isFocus,
  isRoot,
  noteCount,
  childCount,
  onPressStart,
  onOpenQuickAdd,
}: {
  data: BubbleData;
  p: Placed;
  mode: "detail" | "tile";
  opacity: number;
  isFocus: boolean;
  isRoot: boolean;
  noteCount: number;
  childCount: number;
  /** Reports pointerdown on this container so the canvas can tap-detect on pointerup. */
  onPressStart: (target: PressTarget) => void;
  onOpenQuickAdd: (id: string, anchor: DOMRect) => void;
}) {
  const minSide = Math.min(p.w, p.h);
  const isEmpty = noteCount === 0 && childCount === 0;
  const baseShadow = `0 ${0.01 * p.h}px ${0.035 * p.h}px rgba(15, 23, 42, 0.08)`;
  const focusShadow = `0 0 0 ${0.006 * p.w}px #3b82f6, 0 0 ${0.05 * p.w}px ${
    0.012 * p.w
  }px rgba(59, 130, 246, 0.35)`;

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={data.title || "Untitled"}
      // Body press (detail) or whole-tile press. First-target-wins in the
      // canvas means the header handler below (a child, fires earlier) and any
      // nested content override this.
      onPointerDown={() =>
        onPressStart(
          mode === "tile"
            ? { kind: "bubble", id: data.id, draggable: !isRoot }
            : { kind: "bubble", id: data.id, draggable: false },
        )
      }
      style={{
        left: p.x,
        top: p.y,
        width: p.w,
        height: p.h,
        opacity,
        borderRadius: Math.max(8, RADIUS_FRAC * minSide),
        borderWidth: Math.max(1, 0.004 * p.w),
        boxShadow: isFocus ? `${focusShadow}, ${baseShadow}` : baseShadow,
      }}
      className={`absolute overflow-hidden border ${bodyClassFor(data, p.idx)} ${
        mode === "tile"
          ? "cursor-pointer transition-[scale,filter] duration-150 hover:scale-[1.015] hover:brightness-[1.04] active:scale-[0.99]"
          : ""
      }`}
    >
      {mode === "detail" ? (
        <>
          <div
            onPointerDown={() =>
              onPressStart({ kind: "bubble", id: data.id, draggable: !isRoot })
            }
            style={{
              height: p.headerH,
              paddingLeft: 0.35 * p.headerH,
              paddingRight: 0.18 * p.headerH,
              gap: 0.22 * p.headerH,
            }}
            className={`flex cursor-pointer items-center ${headerClassFor(
              data,
              p.idx,
            )}`}
          >
            {data.emoji && (
              <span
                style={{ fontSize: 0.5 * p.headerH, lineHeight: 1 }}
                className="shrink-0"
              >
                {data.emoji}
              </span>
            )}
            <span
              style={{ fontSize: 0.4 * p.headerH }}
              className="min-w-0 flex-1 truncate font-semibold"
            >
              {data.title || "Untitled"}
            </span>
            <CountsChip
              childCount={childCount}
              noteCount={noteCount}
              fontSize={0.28 * p.headerH}
            />
            <button
              type="button"
              aria-label="Add a note or sub-bubble here"
              // Stop propagation so the canvas never captures this pointer —
              // presses on the button are clicks, never pans/taps (and onClick
              // stays reliable on iOS).
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) =>
                onOpenQuickAdd(data.id, e.currentTarget.getBoundingClientRect())
              }
              style={{
                width: 0.7 * p.headerH,
                height: 0.7 * p.headerH,
                fontSize: 0.45 * p.headerH,
              }}
              className="flex shrink-0 items-center justify-center rounded-md transition-colors duration-150 hover:bg-black/10 dark:hover:bg-white/10"
            >
              <Plus style={{ width: "1em", height: "1em" }} />
            </button>
          </div>
          {isEmpty && (
            <div
              style={{ top: p.headerH, fontSize: 0.05 * p.w }}
              className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center px-[6%] text-center text-neutral-400 dark:text-neutral-500"
            >
              Empty — use + to add a note or bubble
            </div>
          )}
        </>
      ) : (
        <div
          style={{ gap: 0.05 * minSide, padding: `0 ${0.08 * p.w}px` }}
          className="flex h-full w-full flex-col items-center justify-center text-center"
        >
          {data.emoji && (
            <span style={{ fontSize: 0.3 * minSide, lineHeight: 1 }}>
              {data.emoji}
            </span>
          )}
          <span
            style={{ fontSize: 0.13 * minSide, lineHeight: 1.15 }}
            className="line-clamp-2 font-medium"
          >
            {data.title || "Untitled"}
          </span>
          <CountsChip
            childCount={childCount}
            noteCount={noteCount}
            fontSize={0.08 * minSide}
          />
        </div>
      )}
    </div>
  );
}

/** Small "N sub-bubbles · N notes" pill; sizes via em so it scales anywhere. */
function CountsChip({
  childCount,
  noteCount,
  fontSize,
}: {
  childCount: number;
  noteCount: number;
  fontSize: number;
}) {
  if (childCount === 0 && noteCount === 0) return null;
  return (
    <span
      style={{ fontSize, gap: "0.4em", padding: "0.18em 0.6em" }}
      className="flex shrink-0 items-center rounded-full bg-black/[0.06] font-medium opacity-80 dark:bg-white/10"
    >
      {childCount > 0 && (
        <span className="flex items-center" style={{ gap: "0.22em" }}>
          <Circle
            aria-hidden
            strokeWidth={2.5}
            style={{ width: "1em", height: "1em" }}
          />
          {childCount}
        </span>
      )}
      {childCount > 0 && noteCount > 0 && <span className="opacity-60">·</span>}
      {noteCount > 0 && (
        <span className="flex items-center" style={{ gap: "0.22em" }}>
          <StickyNote
            aria-hidden
            strokeWidth={2.5}
            style={{ width: "1em", height: "1em" }}
          />
          {noteCount}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// A note card in world space (fixed 150×100 world units, so self-similar at
// every depth). Preview text drops out when the card is small on screen.
// ---------------------------------------------------------------------------
function WorldNoteCard({
  note,
  np,
  sw,
  onPressStart,
}: {
  note: BubbleNoteData;
  np: NotePlaced;
  /** The card's current screen width in px (LOD for the preview text). */
  sw: number;
  onPressStart: (target: PressTarget) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={note.title || "Untitled"}
      onPointerDown={() =>
        onPressStart({ kind: "note", id: note.id, bubbleId: np.bubbleId })
      }
      style={{
        left: np.x,
        top: np.y,
        width: np.w,
        height: np.h,
        padding: 10,
        boxShadow: "0 2px 6px rgba(15, 23, 42, 0.08)",
      }}
      className="absolute cursor-pointer overflow-hidden rounded-[10px] border border-neutral-200 bg-white transition hover:-translate-y-[1px] hover:shadow-md dark:border-neutral-700 dark:bg-neutral-800"
    >
      <p style={{ fontSize: 11 }} className="line-clamp-1 font-medium">
        {note.title || "Untitled"}
      </p>
      {sw >= NOTE_PREVIEW_MIN_PX &&
        (note.preview ? (
          <p
            style={{ fontSize: 8.5, lineHeight: 1.4 }}
            className="mt-1 line-clamp-4 text-neutral-500 dark:text-neutral-400"
          >
            {note.preview}
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 w-3/4 rounded bg-neutral-200 dark:bg-neutral-600" />
            <div className="h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-600" />
            <div className="h-1.5 w-5/6 rounded bg-neutral-200 dark:bg-neutral-600" />
          </div>
        ))}
    </div>
  );
}

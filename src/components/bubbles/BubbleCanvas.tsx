"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, CircleDashed } from "lucide-react";

import type { BubbleData } from "./types";
import { colorClassFor } from "./colors";

/**
 * Infinite, pannable/zoomable canvas for the whole bubble tree.
 *
 * The entire tree is laid out once in stable "world" coordinates via a
 * recursive radial layout that shrinks with depth, so deeper bubbles are
 * physically smaller and clustered around their parent. A single CSS transform
 * (translate + scale) on the world layer provides pan/zoom; bubbles render in
 * world units and the transform does the scaling.
 *
 * Semantic zoom: a bubble's children are only rendered once that bubble is big
 * enough on screen, so zooming into a bubble reveals its children. Far/tiny
 * subtrees are culled for performance. Clicking a bubble smoothly animates the
 * viewport to frame it (and its children).
 */

// ---- Layout tuning ---------------------------------------------------------
const ROOT_R = 120; // world radius of the root bubble
const MIN_SCALE = 0.015;
const MAX_SCALE = 12;
const ZOOM_SENS = 0.0016; // wheel delta → zoom factor
const FOCUS_FRACTION = 0.82; // focused bubble+children fills this much of viewport
const MIN_VISIBLE = 5; // px screen radius below which a bubble isn't drawn
const FADE_BAND = 22; // px over which a revealed bubble fades in
const LABEL_MIN = 26; // px screen radius needed to show emoji + title
const DRAG_THRESHOLD = 4; // px of movement before a press counts as a pan

const clamp = (min: number, v: number, max: number) =>
  Math.max(min, Math.min(v, max));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// Per-depth child sizing/spacing (functions of sibling count).
const childScale = (k: number) => clamp(0.2, 0.55 - 0.035 * k, 0.46);
const ringFactor = (k: number) => 1.5 + 0.22 * k;

interface Placed {
  x: number;
  y: number;
  r: number;
  idx: number; // sibling index (for fallback color)
  focusR: number; // radius to frame when focusing (covers immediate children)
  boundR: number; // bounding radius of the whole subtree (for culling)
}

interface View {
  x: number; // pan (screen px)
  y: number;
  scale: number;
}

function buildLayout(
  nodes: BubbleData[],
  childrenOf: Map<string, BubbleData[]>,
): { pos: Map<string, Placed>; rootId: string | null } {
  const pos = new Map<string, Placed>();
  const root = nodes.find((n) => n.parentId === null);
  if (!root) return { pos, rootId: null };

  pos.set(root.id, {
    x: 0,
    y: 0,
    r: ROOT_R,
    idx: 0,
    focusR: ROOT_R,
    boundR: ROOT_R,
  });

  // Place a node's children, then recurse. Returns the subtree bounding radius.
  const place = (id: string, outward: number, seen: Set<string>): number => {
    if (seen.has(id)) return pos.get(id)?.r ?? 0;
    seen.add(id);
    const p = pos.get(id)!;
    const kids = childrenOf.get(id) ?? [];
    const k = kids.length;
    let boundR = p.r;

    if (k > 0) {
      const cr = p.r * childScale(k);
      const ring = p.r * ringFactor(k);
      const isRoot = id === root.id;
      const span = Math.min(Math.PI * 2 * 0.92, 0.9 + 0.5 * k);

      kids.forEach((kid, i) => {
        let ang: number;
        if (isRoot) {
          ang = -Math.PI / 2 + (i * Math.PI * 2) / k;
        } else if (k === 1) {
          ang = outward;
        } else {
          ang = outward + (i / (k - 1) - 0.5) * span;
        }
        const cx = p.x + ring * Math.cos(ang);
        const cy = p.y + ring * Math.sin(ang);
        pos.set(kid.id, {
          x: cx,
          y: cy,
          r: cr,
          idx: i,
          focusR: cr,
          boundR: cr,
        });
        const childBound = place(kid.id, ang, seen);
        boundR = Math.max(boundR, ring + childBound);
      });

      p.focusR = ring + cr; // frame parent + its children when focusing
    } else {
      p.focusR = p.r * 1.35;
    }

    p.boundR = boundR;
    return boundR;
  };

  place(root.id, 0, new Set());
  return { pos, rootId: root.id };
}

export function BubbleCanvas({
  nodes,
  childrenOf,
  noteCountOf,
  focusId,
  onFocus,
}: {
  nodes: BubbleData[];
  childrenOf: Map<string, BubbleData[]>;
  noteCountOf: Map<string, number>;
  focusId: string;
  onFocus: (id: string) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const { pos, rootId } = useMemo(
    () => buildLayout(nodes, childrenOf),
    [nodes, childrenOf],
  );
  const posRef = useRef(pos);
  posRef.current = pos;

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
  const focusView = useCallbackFocusView(dims, pos);

  const animRef = useRef<number | null>(null);
  const cancelAnim = () => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  };
  const animateTo = (target: View, dur = 540) => {
    cancelAnim();
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
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current || dims.w === 0 || dims.h === 0) return;
    const v = focusView(focusId) ?? (rootId ? focusView(rootId) : null);
    if (v) {
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

  // --- Wheel zoom (toward cursor) -------------------------------------------
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnim();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = viewRef.current;
      const delta = clamp(-240, e.deltaY, 240);
      const factor = Math.exp(-delta * ZOOM_SENS);
      const ns = clamp(MIN_SCALE, v.scale * factor, MAX_SCALE);
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

  // --- Pan + pinch (pointer events) -----------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastSingle = useRef<{ x: number; y: number } | null>(null);
  const downPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinchDist = useRef(0);
  const pinchMid = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const panningRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelAnim();
    if (pointers.current.size === 1) {
      lastSingle.current = { x: e.clientX, y: e.clientY };
      downPos.current = { x: e.clientX, y: e.clientY };
      movedRef.current = false;
      panningRef.current = true;
    } else if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const rect = elRef.current!.getBoundingClientRect();
      pinchDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchMid.current = {
        x: (pts[0].x + pts[1].x) / 2 - rect.left,
        y: (pts[0].y + pts[1].y) / 2 - rect.top,
      };
    }
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
            DRAG_THRESHOLD
        ) {
          movedRef.current = true;
        }
        if (movedRef.current) {
          setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        }
      }
      lastSingle.current = cur;
    } else if (pts.length >= 2) {
      movedRef.current = true;
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
          const ns = clamp(MIN_SCALE, v.scale * (dist / prevD), MAX_SCALE);
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
      panningRef.current = false;
    }
  };

  // --- Visible set (LOD + culling) ------------------------------------------
  const visible = useMemo(() => {
    const out: Array<{
      id: string;
      data: BubbleData;
      p: Placed;
      screenR: number;
      opacity: number;
    }> = [];
    if (!rootId || dims.w === 0) return out;
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const { x: px, y: py, scale } = view;

    const onScreen = (p: Placed, radius: number) => {
      const cx = p.x * scale + px;
      const cy = p.y * scale + py;
      const r = radius * scale;
      return (
        cx + r >= -40 &&
        cx - r <= dims.w + 40 &&
        cy + r >= -40 &&
        cy - r <= dims.h + 40
      );
    };

    const walk = (id: string, seen: Set<string>) => {
      if (seen.has(id)) return;
      seen.add(id);
      const p = pos.get(id);
      const data = byId.get(id);
      if (!p || !data) return;
      // Cull whole subtree if its bounding circle is off-screen.
      if (!onScreen(p, p.boundR)) return;

      const screenR = p.r * scale;
      if (screenR >= MIN_VISIBLE && onScreen(p, p.r)) {
        out.push({
          id,
          data,
          p,
          screenR,
          opacity: clamp(0, (screenR - MIN_VISIBLE) / FADE_BAND, 1),
        });
      }
      // Recurse only if children could be large enough to see.
      const kids = childrenOf.get(id) ?? [];
      if (kids.length === 0) return;
      const childScreenR = p.r * childScale(kids.length) * scale;
      if (childScreenR < MIN_VISIBLE * 0.6) return;
      for (const kid of kids) walk(kid.id, seen);
    };

    walk(rootId, new Set());
    return out;
  }, [view, dims, pos, rootId, nodes, childrenOf]);

  // Parent→child connector lines among visible bubbles.
  const links = useMemo(() => {
    const shown = new Set(visible.map((v) => v.id));
    const out: Array<{ id: string; a: Placed; b: Placed }> = [];
    for (const v of visible) {
      for (const kid of childrenOf.get(v.id) ?? []) {
        if (shown.has(kid.id)) {
          const b = pos.get(kid.id);
          if (b) out.push({ id: kid.id, a: v.p, b });
        }
      }
    }
    return out;
  }, [visible, childrenOf, pos]);

  const clickBubble = (id: string) => {
    if (movedRef.current) return; // it was a pan, not a tap
    onFocus(id);
  };

  return (
    <div
      ref={elRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      className="relative h-full w-full select-none overflow-hidden bg-neutral-50 dark:bg-neutral-950"
      style={{
        touchAction: "none",
        cursor: panningRef.current ? "grabbing" : "grab",
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {/* connectors */}
        <svg
          className="pointer-events-none absolute overflow-visible text-neutral-300 dark:text-neutral-700"
          style={{ left: 0, top: 0, width: 1, height: 1 }}
        >
          {links.map((l) => (
            <line
              key={l.id}
              x1={l.a.x}
              y1={l.a.y}
              x2={l.b.x}
              y2={l.b.y}
              stroke="currentColor"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {visible.map((v) => (
          <WorldBubble
            key={v.id}
            data={v.data}
            p={v.p}
            screenR={v.screenR}
            opacity={v.opacity}
            isFocus={v.id === focusId}
            noteCount={noteCountOf.get(v.id) ?? 0}
            childCount={(childrenOf.get(v.id) ?? []).length}
            childrenOf={childrenOf}
            panningRef={panningRef}
            onClick={() => clickBubble(v.id)}
            onPick={onFocus}
          />
        ))}
      </div>

      {/* zoom hint / controls */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900/70 px-3 py-1 text-[11px] text-white/90 backdrop-blur-sm dark:bg-white/10">
        drag to pan · scroll to zoom · click a bubble to dive in
      </div>
    </div>
  );
}

// useCallback wrapper that recomputes the framing transform for a bubble id.
function useCallbackFocusView(
  dims: { w: number; h: number },
  pos: Map<string, Placed>,
) {
  return useMemo(() => {
    return (id: string): View | null => {
      const p = pos.get(id);
      if (!p || dims.w === 0 || dims.h === 0) return null;
      const minDim = Math.min(dims.w, dims.h);
      const scale = clamp(
        MIN_SCALE,
        (FOCUS_FRACTION * minDim) / (2 * p.focusR),
        MAX_SCALE,
      );
      return {
        scale,
        x: dims.w / 2 - p.x * scale,
        y: dims.h / 2 - p.y * scale,
      };
    };
  }, [dims, pos]);
}

// ---------------------------------------------------------------------------
// A single bubble in world space, with an optional hover "peek" dropdown.
// ---------------------------------------------------------------------------
function WorldBubble({
  data,
  p,
  screenR,
  opacity,
  isFocus,
  noteCount,
  childCount,
  childrenOf,
  panningRef,
  onClick,
  onPick,
}: {
  data: BubbleData;
  p: Placed;
  screenR: number;
  opacity: number;
  isFocus: boolean;
  noteCount: number;
  childCount: number;
  childrenOf: Map<string, BubbleData[]>;
  panningRef: React.MutableRefObject<boolean>;
  onClick: () => void;
  onPick: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kids = childrenOf.get(data.id) ?? [];
  const hasKids = kids.length > 0;
  const showLabel = screenR >= LABEL_MIN;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openMenu = () => {
    if (!hasKids || panningRef.current || screenR < LABEL_MIN) return;
    cancelClose();
    const r = ref.current?.getBoundingClientRect();
    if (r) setMenuPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setMenuPos(null), 160);
  };
  useEffect(() => () => cancelClose(), []);

  const fontPx = Math.max(8, p.r * 0.26);
  const emojiPx = p.r * 0.42;

  return (
    <>
      <div
        ref={ref}
        role="button"
        tabIndex={-1}
        onClick={onClick}
        onPointerEnter={openMenu}
        onPointerLeave={scheduleClose}
        style={{
          left: p.x,
          top: p.y,
          width: p.r * 2,
          height: p.r * 2,
          opacity,
          borderWidth: Math.max(1, p.r * 0.02),
        }}
        className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-full border text-center shadow-sm transition-shadow ${
          colorClassFor(data, p.idx)
        } ${
          isFocus
            ? "ring-4 ring-blue-500/70 ring-offset-2 ring-offset-neutral-50 dark:ring-offset-neutral-950"
            : ""
        }`}
      >
        {data.emoji && (
          <span style={{ fontSize: emojiPx, lineHeight: 1 }}>{data.emoji}</span>
        )}
        {showLabel && (
          <span
            style={{ fontSize: fontPx, lineHeight: 1.1, padding: `0 ${p.r * 0.12}px` }}
            className="line-clamp-3 font-medium"
          >
            {data.title || "Untitled"}
          </span>
        )}
        {showLabel && (noteCount > 0 || childCount > 0) && (
          <span
            style={{ fontSize: fontPx * 0.78 }}
            className="flex items-center gap-1 opacity-70"
          >
            {noteCount > 0 && <span>📝{noteCount}</span>}
            {childCount > 0 && <span>◯{childCount}</span>}
          </span>
        )}
      </div>

      {menuPos &&
        hasKids &&
        createPortal(
          <div
            style={{ left: menuPos.x, top: menuPos.y }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className="fixed z-50 -translate-x-1/2"
          >
            <BubbleSubmenu
              items={kids}
              childrenOf={childrenOf}
              depth={0}
              onPick={(id) => {
                setMenuPos(null);
                onPick(id);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/** One level of the descendant fly-out menu (recurses for deeper levels). */
function BubbleSubmenu({
  items,
  childrenOf,
  depth,
  onPick,
}: {
  items: BubbleData[];
  childrenOf: Map<string, BubbleData[]>;
  depth: number;
  onPick: (id: string) => void;
}) {
  return (
    <ul className="min-w-44 max-w-64 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      {items.map((item) => (
        <BubbleSubmenuItem
          key={item.id}
          item={item}
          childrenOf={childrenOf}
          depth={depth}
          onPick={onPick}
        />
      ))}
    </ul>
  );
}

function BubbleSubmenuItem({
  item,
  childrenOf,
  depth,
  onPick,
}: {
  item: BubbleData;
  childrenOf: Map<string, BubbleData[]>;
  depth: number;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kids = childrenOf.get(item.id) ?? [];
  const hasKids = kids.length > 0 && depth < 20;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => () => cancelClose(), []);

  return (
    <li
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => onPick(item.id)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        {item.emoji ? (
          <span className="text-sm leading-none">{item.emoji}</span>
        ) : (
          <CircleDashed className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        )}
        <span className="flex-1 truncate">{item.title || "Untitled"}</span>
        {hasKids && (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        )}
      </button>
      {hasKids && open && (
        <div className="absolute left-full top-0 -ml-1 pl-1">
          <BubbleSubmenu
            items={kids}
            childrenOf={childrenOf}
            depth={depth + 1}
            onPick={onPick}
          />
        </div>
      )}
    </li>
  );
}

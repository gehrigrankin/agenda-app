"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  type NodeKey,
} from "lexical";
import {
  Eraser,
  Highlighter,
  Lasso,
  PenLine,
  Trash2,
  Type,
  X,
} from "lucide-react";

import { transcribeInkAction } from "@/app/app/notes/actions";
import {
  INK_COLORS,
  INK_MAX_HEIGHT,
  INK_MIN_HEIGHT,
  INK_WIDTH,
  inkBottom,
  inkCss,
  lassoSelect,
  strokeHit,
  strokePath,
  strokeWidth,
  translateStrokes,
  type InkColor,
  type InkStroke,
  type InkTool,
} from "@/lib/ink";

import { $isInkNode } from "./InkNode";

/**
 * The ink block's surface: a ruled, dashed block you draw in with a pen,
 * mouse or finger, and its floating tool palette (pen, highlighter, eraser,
 * lasso; four colors). The palette belongs to whichever block you last drew
 * in, floats at the bottom of the screen, and hides as soon as you type.
 *
 * Palm rejection: once a pen has touched any block this session, fingers
 * scroll instead of drawing. Strokes are kept locally while a gesture runs and
 * written to the Lexical node on pointer-up (one history entry per stroke).
 */

// ---------------------------------------------------------------------------
// Shared palette state (one palette for every block on the page)
// ---------------------------------------------------------------------------

interface InkUi {
  tool: InkTool;
  color: InkColor;
  /** useId of the block that owns the palette, or null when hidden. */
  active: string | null;
  penSeen: boolean;
}

let ui: InkUi = { tool: "pen", color: "ink", active: null, penSeen: false };
const listeners = new Set<() => void>();
function setUi(patch: Partial<InkUi>) {
  ui = { ...ui, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const useInkUi = () =>
  useSyncExternalStore(
    subscribe,
    () => ui,
    () => ui,
  );

/** A block inserted from the slash menu / toolbar opens its palette on mount. */
let pendingActivate: NodeKey | null = null;
export function activateInkOnMount(key: NodeKey) {
  pendingActivate = key;
}

const PEN_WIDTH = 2.6;
const HIGHLIGHTER_WIDTH = 4;
const ERASER_RADIUS = 10;
const GROW_MARGIN = 60;
const GROW_STEP = 200;

type Gesture =
  | { kind: "draw"; stroke: InkStroke }
  | { kind: "erase" }
  | { kind: "lasso"; poly: [number, number][] }
  | { kind: "move"; from: [number, number]; base: InkStroke[] }
  | { kind: "resize"; startY: number; startH: number };

export function InkBlock({
  nodeKey,
  strokes,
  height,
}: {
  nodeKey: NodeKey;
  strokes: InkStroke[];
  height: number;
}) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const id = useId();
  const { tool, color, active, penSeen } = useInkUi();
  const isActive = active === id;

  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [local, setLocal] = useState<{ strokes: InkStroke[]; height: number }>({
    strokes,
    height,
  });
  const [draft, setDraft] = useState<InkStroke | null>(null);
  const [lasso, setLasso] = useState<[number, number][] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Follow the node (undo/redo, collaboration via reload) when idle.
  useEffect(() => {
    if (!gesture.current) setLocal({ strokes, height });
  }, [strokes, height]);

  useEffect(() => {
    if (pendingActivate === nodeKey) {
      pendingActivate = null;
      setUi({ active: id });
      rootRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [id, nodeKey]);

  // Selection belongs to the palette session.
  useEffect(() => {
    if (!isActive || tool !== "lasso") setSelected(new Set());
  }, [isActive, tool]);

  const commit = useCallback(
    (next: { strokes: InkStroke[]; height: number }) => {
      setLocal(next);
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isInkNode(node)) node.setInk(next.strokes, next.height);
      });
    },
    [editor, nodeKey],
  );

  // Typing anywhere (or Esc) hides the palette; Backspace/Delete with a lasso
  // selection deletes the selected strokes instead.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Backspace" || e.key === "Delete") && selected.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        commit({
          strokes: local.strokes.filter((_, i) => !selected.has(i)),
          height: local.height,
        });
        setSelected(new Set());
        return;
      }
      if ((e.target as Element | null)?.closest?.("[data-ink-palette]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (["Shift", "Tab", "CapsLock"].includes(e.key)) return;
      setUi({ active: null });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((t as Element).closest?.("[data-ink-palette]")) return;
      setUi({ active: null });
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [isActive, selected, local, commit]);

  const toInk = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = surfaceRef.current!.getBoundingClientRect();
    const s = INK_WIDTH / r.width;
    return [
      Math.round((e.clientX - r.left) * s * 10) / 10,
      Math.round((e.clientY - r.top) * s * 10) / 10,
    ];
  };
  const pressureOf = (e: React.PointerEvent) =>
    e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editable || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.pointerType === "touch" && penSeen) return; // palm / finger scrolls
    if (e.pointerType === "pen" && !penSeen) setUi({ penSeen: true });
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!isActive) setUi({ active: id });
    setMessage(null);
    const [x, y] = toInk(e);

    if (tool === "pen" || tool === "highlighter") {
      const stroke: InkStroke = {
        tool,
        color,
        width: tool === "pen" ? PEN_WIDTH : HIGHLIGHTER_WIDTH,
        points: [[x, y, pressureOf(e)]],
      };
      gesture.current = { kind: "draw", stroke };
      setDraft(stroke);
    } else if (tool === "eraser") {
      gesture.current = { kind: "erase" };
      eraseAt(x, y);
    } else if (
      selected.size > 0 &&
      selectionBox(local.strokes, selected, x, y)
    ) {
      gesture.current = { kind: "move", from: [x, y], base: local.strokes };
    } else {
      setSelected(new Set());
      gesture.current = { kind: "lasso", poly: [[x, y]] };
      setLasso([[x, y]]);
    }
  };

  const eraseAt = (x: number, y: number) => {
    setLocal((cur) => {
      const kept = cur.strokes.filter(
        (s) => !strokeHit(s, x, y, ERASER_RADIUS),
      );
      return kept.length === cur.strokes.length
        ? cur
        : { ...cur, strokes: kept };
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const events =
      typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : [e.nativeEvent];
    const list = events.length ? events : [e.nativeEvent];
    if (g.kind === "draw") {
      for (const ev of list) {
        const [x, y] = toInk(ev);
        const p =
          ev.pointerType === "pen" && ev.pressure > 0 ? ev.pressure : 0.5;
        g.stroke.points.push([x, y, Math.round(p * 10) / 10]);
      }
      setDraft({ ...g.stroke });
      const lastY = g.stroke.points[g.stroke.points.length - 1][1];
      if (lastY > local.height - GROW_MARGIN && local.height < INK_MAX_HEIGHT)
        setLocal((cur) => ({
          ...cur,
          height: Math.min(INK_MAX_HEIGHT, cur.height + GROW_STEP),
        }));
    } else if (g.kind === "erase") {
      for (const ev of list) {
        const [x, y] = toInk(ev);
        eraseAt(x, y);
      }
    } else if (g.kind === "lasso") {
      const [x, y] = toInk(e);
      g.poly.push([x, y]);
      setLasso([...g.poly]);
    } else if (g.kind === "move") {
      const [x, y] = toInk(e);
      setLocal((cur) => ({
        ...cur,
        strokes: translateStrokes(
          g.base,
          selected,
          x - g.from[0],
          y - g.from[1],
        ),
      }));
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "draw") {
      setDraft(null);
      commit({ strokes: [...local.strokes, g.stroke], height: local.height });
    } else if (g.kind === "lasso") {
      setLasso(null);
      setSelected(new Set(lassoSelect(local.strokes, g.poly)));
    } else if (g.kind === "erase" || g.kind === "move") {
      if (local.strokes !== strokes) commit(local);
    }
  };

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      kind: "resize",
      startY: e.clientY,
      startH: local.height,
    };
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (g?.kind !== "resize") return;
    const r = surfaceRef.current!.getBoundingClientRect();
    const s = INK_WIDTH / r.width;
    const min = Math.max(
      INK_MIN_HEIGHT,
      Math.ceil(inkBottom(local.strokes) + 8),
    );
    const h = Math.round(g.startH + (e.clientY - g.startY) * s);
    setLocal((cur) => ({
      ...cur,
      height: Math.min(INK_MAX_HEIGHT, Math.max(min, h)),
    }));
  };
  const onResizeUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "resize" && local.height !== height) commit(local);
  };

  const remove = () => {
    setUi({ active: null });
    editor.update(() => $getNodeByKey(nodeKey)?.remove());
  };

  const convert = async () => {
    if (converting || local.strokes.length === 0) return;
    setConverting(true);
    setMessage(null);
    try {
      const png = rasterize(local.strokes, local.height);
      const res = await transcribeInkAction(png);
      if (!res.ok) {
        setMessage(
          res.reason === "not-configured"
            ? "Converting needs AI — set ANTHROPIC_API_KEY on the server."
            : res.reason === "empty"
              ? "No writing found to convert."
              : "Couldn't read that — try again.",
        );
        return;
      }
      setUi({ active: null });
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!$isInkNode(node)) return;
        let prev: ReturnType<typeof $createParagraphNode> | null = null;
        for (const line of res.lines) {
          const p = $createParagraphNode().append($createTextNode(line));
          if (prev) prev.insertAfter(p);
          else node.insertBefore(p);
          prev = p;
        }
        node.remove();
        prev?.selectEnd();
      });
    } catch {
      setMessage("Couldn't read that — try again.");
    } finally {
      setConverting(false);
    }
  };

  const shown = local.strokes;
  const box =
    selected.size > 0 ? bounds(shown.filter((_, i) => selected.has(i))) : null;
  const fingerScrolls = penSeen || !editable;

  return (
    <div
      ref={rootRef}
      data-ink-block
      className={`overflow-hidden rounded-xl border border-dashed bg-white/[0.015] ${
        isActive ? "border-sage/60" : "border-sage/30"
      }`}
    >
      <div className="flex h-9 items-center gap-2 border-b border-dashed border-sage/20 pr-1.5 pl-3 touch:h-11">
        <PenLine className="h-3.5 w-3.5 text-sage/80" aria-hidden />
        <span className="text-[0.6875rem] font-semibold tracking-[0.1em] text-sage/80 uppercase">
          Ink block
        </span>
        {message && (
          <span
            role="status"
            className="ml-1 truncate text-[0.75rem] text-ink-500"
          >
            {message}
          </span>
        )}
        <span className="flex-1" />
        {editable && (
          <>
            <button
              type="button"
              onClick={convert}
              disabled={converting || shown.length === 0}
              className="flex h-7 items-center gap-1.5 rounded-md border border-white/8 bg-white/4 px-2 text-[0.75rem] text-ink-300 outline-none hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sage/70 disabled:opacity-50 touch:h-9"
            >
              <Type className="h-3.5 w-3.5" aria-hidden />
              {converting ? "Converting…" : "Convert to text"}
            </button>
            <button
              type="button"
              aria-label="Delete ink block"
              title="Delete ink block"
              onClick={remove}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 outline-none hover:bg-white/8 hover:text-ink-200 focus-visible:outline-2 focus-visible:outline-sage/70 touch:h-9 touch:w-9"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      <div
        ref={surfaceRef}
        role="img"
        aria-label={
          shown.length
            ? `Handwriting or sketch, ${shown.length} strokes`
            : "Empty ink block"
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative w-full select-none ${
          editable
            ? tool === "eraser" && isActive
              ? "cursor-cell"
              : "cursor-crosshair"
            : ""
        }`}
        style={{
          aspectRatio: `${INK_WIDTH} / ${local.height}`,
          touchAction: fingerScrolls ? "pan-y" : "none",
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0, transparent calc(2rem - 1px), color-mix(in srgb, var(--color-white) 6%, transparent) calc(2rem - 1px), color-mix(in srgb, var(--color-white) 6%, transparent) 2rem)",
        }}
      >
        <svg
          viewBox={`0 0 ${INK_WIDTH} ${local.height}`}
          className="absolute inset-0 h-full w-full"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {shown.map((s, i) => (
            <StrokePath key={i} stroke={s} dim={selected.has(i)} />
          ))}
          {draft && <StrokePath stroke={draft} />}
          {lasso && lasso.length > 1 && (
            <polyline
              points={lasso.map((p) => `${p[0]},${p[1]}`).join(" ")}
              stroke="var(--color-sage)"
              strokeWidth={1.5}
              strokeDasharray="6 5"
            />
          )}
          {box && (
            <rect
              x={box.x - 8}
              y={box.y - 8}
              width={box.w + 16}
              height={box.h + 16}
              rx={6}
              stroke="var(--color-sage)"
              strokeWidth={1.5}
              strokeDasharray="6 5"
              fill="color-mix(in srgb, var(--color-sage) 6%, transparent)"
            />
          )}
        </svg>
        {shown.length === 0 && !draft && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center text-[0.8125rem] text-ink-600">
            <span>Handwriting &amp; sketches live here</span>
            <span>Scribble in any text line to write as text</span>
          </div>
        )}
      </div>

      {editable && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize ink block"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          className="group flex h-3 cursor-ns-resize touch-none items-center justify-center touch:h-6"
        >
          <span className="h-1 w-10 rounded-full bg-white/10 group-hover:bg-white/25" />
        </div>
      )}

      {isActive &&
        editable &&
        typeof document !== "undefined" &&
        createPortal(<InkPalette anchor={rootRef.current} />, document.body)}
    </div>
  );
}

function StrokePath({ stroke, dim }: { stroke: InkStroke; dim?: boolean }) {
  return (
    <path
      d={strokePath(stroke.points)}
      stroke={inkCss(stroke.color)}
      strokeWidth={strokeWidth(stroke)}
      strokeOpacity={
        (stroke.tool === "highlighter" ? 0.35 : 1) * (dim ? 0.6 : 1)
      }
      strokeLinecap={stroke.tool === "highlighter" ? "butt" : "round"}
    />
  );
}

function bounds(strokes: InkStroke[]) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const s of strokes)
    for (const [x, y] of s.points) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function selectionBox(
  strokes: InkStroke[],
  selected: Set<number>,
  x: number,
  y: number,
): boolean {
  const b = bounds(strokes.filter((_, i) => selected.has(i)));
  return (
    x >= b.x - 12 && x <= b.x + b.w + 12 && y >= b.y - 12 && y <= b.y + b.h + 12
  );
}

/** Dark-on-white PNG (base64, no data: prefix) of the pen strokes for OCR. */
function rasterize(strokes: InkStroke[], height: number): string {
  const scale = Math.min(1, 1600 / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(INK_WIDTH * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111111";
  for (const s of strokes) {
    if (s.tool !== "pen") continue; // highlights aren't writing
    ctx.lineWidth = Math.max(2, strokeWidth(s));
    ctx.stroke(new Path2D(strokePath(s.points)));
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

// ---------------------------------------------------------------------------
// Floating palette
// ---------------------------------------------------------------------------

const TOOLS: { tool: InkTool; label: string; icon: typeof PenLine }[] = [
  { tool: "pen", label: "Pen", icon: PenLine },
  { tool: "highlighter", label: "Highlighter", icon: Highlighter },
  { tool: "eraser", label: "Eraser", icon: Eraser },
  { tool: "lasso", label: "Lasso — select and move strokes", icon: Lasso },
];

const COLOR_LABELS: Record<InkColor, string> = {
  ink: "Ink",
  green: "Green",
  amber: "Amber",
  coral: "Coral",
};

function InkPalette({ anchor }: { anchor: HTMLElement | null }) {
  const { tool, color } = useInkUi();
  // Center under the block's column (the editor pane on split screens).
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      setLeft(r.left + r.width / 2);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  const BTN =
    "flex h-10 w-10 items-center justify-center rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-sage/70 touch:h-11 touch:w-11";

  return (
    <div
      data-ink-palette
      role="toolbar"
      aria-label="Ink tools"
      className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-[65] flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-panel p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"
      style={{ left: left ?? "50%" }}
      onPointerDown={(e) => e.preventDefault()}
    >
      {TOOLS.map(({ tool: t, label, icon: Icon }) => (
        <button
          key={t}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={tool === t}
          onClick={() => setUi({ tool: t })}
          className={`${BTN} ${tool === t ? "bg-white/10 text-ink-100" : "text-ink-400 hover:bg-white/6"}`}
        >
          <Icon className="h-[1.125rem] w-[1.125rem]" />
        </button>
      ))}
      <span className="mx-1 h-6 w-px bg-white/10" />
      {INK_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${COLOR_LABELS[c]} ink`}
          title={COLOR_LABELS[c]}
          aria-pressed={color === c}
          onClick={() =>
            setUi({
              color: c,
              tool: tool === "pen" || tool === "highlighter" ? tool : "pen",
            })
          }
          className={`${BTN}`}
        >
          <span
            className={`h-5 w-5 rounded-full ${color === c ? "ring-2 ring-ink-100 ring-offset-2 ring-offset-panel" : ""}`}
            style={{ background: inkCss(c) }}
          />
        </button>
      ))}
      <span className="mx-1 h-6 w-px bg-white/10" />
      <button
        type="button"
        aria-label="Close ink tools"
        title="Close"
        onClick={() => setUi({ active: null })}
        className={`${BTN} text-ink-400 hover:bg-white/6`}
      >
        <X className="h-[1.125rem] w-[1.125rem]" />
      </button>
    </div>
  );
}

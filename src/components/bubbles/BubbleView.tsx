"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Check,
  ChevronRight,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { SerializedEditorState } from "lexical";

import { NoteEditor } from "@/components/notes/NoteEditor";
import {
  createBubbleAction,
  createBubbleNoteAction,
  deleteBubbleAction,
  getBubbleNoteAction,
  renameBubbleAction,
  trashBubbleNoteAction,
  updateBubbleStyleAction,
} from "@/app/app/bubbles/actions";

export interface BubbleData {
  id: string;
  parentId: string | null;
  title: string;
  emoji: string | null;
  color: string | null;
}

export interface BubbleNoteData {
  id: string;
  bubbleId: string;
  title: string;
  preview: string;
}

interface LoadedNote {
  id: string;
  title: string;
  content: SerializedEditorState | null;
}

// Named colors → circle classes (bg/border/text/hover) and a picker swatch.
const COLOR_NAMES = [
  "sky",
  "violet",
  "emerald",
  "amber",
  "rose",
  "teal",
] as const;
type ColorName = (typeof COLOR_NAMES)[number];

const COLOR_CLASSES: Record<ColorName, string> = {
  sky: "bg-sky-100 border-sky-300 text-sky-900 hover:bg-sky-200 dark:bg-sky-950 dark:border-sky-800 dark:text-sky-100 dark:hover:bg-sky-900",
  violet:
    "bg-violet-100 border-violet-300 text-violet-900 hover:bg-violet-200 dark:bg-violet-950 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-900",
  emerald:
    "bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900",
  amber:
    "bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900",
  rose: "bg-rose-100 border-rose-300 text-rose-900 hover:bg-rose-200 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-900",
  teal: "bg-teal-100 border-teal-300 text-teal-900 hover:bg-teal-200 dark:bg-teal-950 dark:border-teal-800 dark:text-teal-100 dark:hover:bg-teal-900",
};

const SWATCH: Record<ColorName, string> = {
  sky: "bg-sky-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  teal: "bg-teal-400",
};

const EMOJI_PRESETS = [
  "💡", "📁", "🧠", "✅", "📌", "🎯", "🔥", "⭐",
  "📝", "🌱", "🚀", "❤️", "🔧", "📚", "🎨", "💰",
];

function colorClassFor(bubble: BubbleData, index: number): string {
  const name = (bubble.color as ColorName) ?? COLOR_NAMES[index % COLOR_NAMES.length];
  return COLOR_CLASSES[name] ?? COLOR_CLASSES.sky;
}

const clamp = (min: number, val: number, max: number) =>
  Math.max(min, Math.min(val, max));

function computeDepth(byId: Map<string, BubbleData>, id: string): number {
  let depth = 0;
  let node = byId.get(id);
  const seen = new Set<string>();
  while (node?.parentId && !seen.has(node.id)) {
    seen.add(node.id);
    depth++;
    node = byId.get(node.parentId);
  }
  return depth;
}

const PANEL_MIN = 280;
const PANEL_MAX = 720;
const PANEL_KEY = "bubblePanelWidth";

export function BubbleView({
  rootId,
  initialBubbleId,
  nodes,
  notes,
}: {
  rootId: string;
  initialBubbleId: string | null;
  nodes: BubbleData[];
  notes: BubbleNoteData[];
}) {
  const [currentId, setCurrentId] = useState(
    initialBubbleId && initialBubbleId !== "" ? initialBubbleId : rootId,
  );
  const [, startTransition] = useTransition();

  // Editor overlay.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<LoadedNote | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  // Inline UI state.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [adding, setAdding] = useState<null | "note" | "bubble">(null);
  const [addDraft, setAddDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);

  // Focal "infinite zoom" transition between bubbles.
  const [transition, setTransition] = useState<{
    fromId: string;
    toId: string;
    dir: "in" | "out";
    fx: number;
    fy: number;
  } | null>(null);
  const outgoingRef = useRef<HTMLDivElement>(null);
  const incomingRef = useRef<HTMLDivElement>(null);

  // Resizable notes panel (persisted to localStorage).
  const rowRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(360);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  useEffect(() => {
    const saved = window.localStorage.getItem(PANEL_KEY);
    if (saved) setPanelWidth(clamp(PANEL_MIN, parseInt(saved, 10), PANEL_MAX));
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelWidth(clamp(PANEL_MIN, rect.right - ev.clientX, PANEL_MAX));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.localStorage.setItem(PANEL_KEY, String(Math.round(panelWidthRef.current)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Canvas sizing (measured) for the radial bubble layout.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { byId, childrenOf } = useMemo(() => {
    const byId = new Map<string, BubbleData>();
    const childrenOf = new Map<string, BubbleData[]>();
    for (const n of nodes) byId.set(n.id, n);
    for (const n of nodes) {
      if (n.parentId) {
        const arr = childrenOf.get(n.parentId) ?? [];
        arr.push(n);
        childrenOf.set(n.parentId, arr);
      }
    }
    return { byId, childrenOf };
  }, [nodes]);

  const notesOf = useMemo(() => {
    const map = new Map<string, BubbleNoteData[]>();
    for (const n of notes) {
      const arr = map.get(n.bubbleId) ?? [];
      arr.push(n);
      map.set(n.bubbleId, arr);
    }
    return map;
  }, [notes]);

  // Keep latest values for the popstate handler.
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  const current = byId.get(currentId) ?? byId.get(rootId);
  const effectiveId = current?.id ?? rootId;

  // Deep-linking: reflect navigation in the URL (?b=) and honor back/forward.
  // `focal` is the clicked child's canvas coords, so we zoom into that point.
  const navigate = (id: string, focal?: { x: number; y: number }) => {
    if (id === currentId) return;
    const dir =
      computeDepth(byId, id) >= computeDepth(byId, currentId) ? "in" : "out";
    if (dims.w > 0) {
      const f = focal ?? focalPoint(id, currentId, dir);
      setTransition({ fromId: currentId, toId: id, dir, fx: f.x, fy: f.y });
    }
    setCurrentId(id);
    if (typeof window !== "undefined") {
      window.history.pushState({ b: id }, "", `?b=${id}`);
    }
  };

  useEffect(() => {
    const onPop = () => {
      const b = new URLSearchParams(window.location.search).get("b");
      const target = b && byIdRef.current.has(b) ? b : rootId;
      const from = currentIdRef.current;
      if (target === from) return;
      const dir =
        computeDepth(byIdRef.current, target) >=
        computeDepth(byIdRef.current, from)
          ? "in"
          : "out";
      const d = dimsRef.current;
      if (d.w > 0) {
        setTransition({
          fromId: from,
          toId: target,
          dir,
          fx: d.w / 2,
          fy: d.h / 2,
        });
      }
      setCurrentId(target);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [rootId]);

  const breadcrumb = useMemo(() => {
    const path: BubbleData[] = [];
    let node = current;
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      path.unshift(node);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return path;
  }, [current, byId]);

  const bubbleNotes = notesOf.get(effectiveId) ?? [];

  // Drive the focal "infinite zoom" with the Web Animations API.
  useLayoutEffect(() => {
    if (!transition) return;
    const out = outgoingRef.current;
    const inc = incomingRef.current;
    if (!out || !inc) return;
    const S = 6;
    const origin = `${transition.fx}px ${transition.fy}px`;
    const duration = 360;
    out.style.transformOrigin = origin;
    inc.style.transformOrigin = origin;

    const incFrames =
      transition.dir === "in"
        ? [
            { transform: `scale(${1 / S})`, opacity: 0 },
            { transform: "scale(1)", opacity: 1 },
          ]
        : [
            { transform: `scale(${S})`, opacity: 0 },
            { transform: "scale(1)", opacity: 1 },
          ];
    const outFrames =
      transition.dir === "in"
        ? [
            { transform: "scale(1)", opacity: 1 },
            { transform: `scale(${S})`, opacity: 0 },
          ]
        : [
            { transform: "scale(1)", opacity: 1 },
            { transform: `scale(${1 / S})`, opacity: 0 },
          ];

    inc.animate(incFrames, { duration, easing: "ease-out", fill: "both" });
    const anim = out.animate(outFrames, {
      duration,
      easing: "ease-in",
      fill: "both",
    });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTransition(null);
    };
    anim.addEventListener("finish", finish);
    const t = setTimeout(finish, duration + 120);
    return () => {
      clearTimeout(t);
      anim.removeEventListener("finish", finish);
    };
  }, [transition]);

  if (!current) return null;
  const isRoot = !current.parentId;

  // --- Note editor overlay ---------------------------------------------------
  const openNote = async (id: string) => {
    setEditingNoteId(id);
    setEditingNote(null);
    setLoadingNote(true);
    const payload = await getBubbleNoteAction(id);
    if (!payload) {
      setEditingNoteId(null);
      setLoadingNote(false);
      return;
    }
    setEditingNote(payload);
    setLoadingNote(false);
  };

  const closeEditor = () => {
    setEditingNoteId(null);
    setEditingNote(null);
    setLoadingNote(false);
  };

  // --- Inline create ---------------------------------------------------------
  const startAdd = (kind: "note" | "bubble") => {
    setAdding(kind);
    setAddDraft("");
  };

  const submitAdd = async () => {
    const kind = adding;
    const value = addDraft.trim();
    setAdding(null);
    setAddDraft("");
    if (!kind) return;
    if (kind === "bubble") {
      startTransition(() => {
        void createBubbleAction(effectiveId, value || "Untitled");
      });
    } else {
      const id = await createBubbleNoteAction(effectiveId, value || "Untitled");
      setEditingNote({ id, title: value || "Untitled", content: null });
      setEditingNoteId(id);
    }
  };

  // --- Inline rename ---------------------------------------------------------
  const startRename = () => {
    setTitleDraft(current.title);
    setEditingTitle(true);
  };
  const submitRename = () => {
    const value = titleDraft.trim() || "Untitled";
    setEditingTitle(false);
    startTransition(() => {
      void renameBubbleAction(effectiveId, value);
    });
  };

  // --- Style -----------------------------------------------------------------
  const setStyle = (style: { emoji?: string | null; color?: string | null }) => {
    startTransition(() => {
      void updateBubbleStyleAction(effectiveId, style);
    });
  };

  // --- Delete ----------------------------------------------------------------
  const doDelete = () => {
    if (!current.parentId) return;
    const parentId = current.parentId;
    setConfirmingDelete(false);
    navigate(parentId);
    startTransition(() => {
      void deleteBubbleAction(current.id);
    });
  };

  const totalDescendants = (id: string): number => {
    const kids = childrenOf.get(id) ?? [];
    return kids.reduce((sum, k) => sum + 1 + totalDescendants(k.id), 0);
  };

  // --- Radial layout (shared by the live canvas + transition layers) --------
  type ChildNode = {
    child: BubbleData;
    i: number;
    x: number;
    y: number;
    d: number;
    noteCount: number;
    kidCount: number;
  };
  const computeLayout = (bid: string) => {
    const kids = childrenOf.get(bid) ?? [];
    const cx = dims.w / 2;
    const cy = dims.h / 2;
    const slots = Math.max(kids.length + 1, 1);
    const ringR = clamp(
      96,
      Math.min(dims.w, dims.h) * 0.4 - 20,
      Math.min(dims.w, dims.h) / 2 - 70,
    );
    const centerD = clamp(96, Math.min(dims.w, dims.h) * 0.26, 168);
    const pos = (i: number) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / slots;
      return { x: cx + ringR * Math.cos(a), y: cy + ringR * Math.sin(a) };
    };
    const kidNodes: ChildNode[] = kids.map((child, i) => {
      const noteCount = notesOf.get(child.id)?.length ?? 0;
      const kidCount = childrenOf.get(child.id)?.length ?? 0;
      const weight = noteCount + totalDescendants(child.id);
      const d = clamp(64, 70 + weight * 8, 132);
      const p = pos(i);
      return { child, i, x: p.x, y: p.y, d, noteCount, kidCount };
    });
    return {
      cx,
      cy,
      centerD,
      kidNodes,
      addPos: pos(kids.length),
      bubble: byId.get(bid),
    };
  };

  // The direct child of `targetId` on the path toward `fromId` (for zoom-out).
  const childTowards = (targetId: string, fromId: string): string | null => {
    let n = byId.get(fromId);
    const seen = new Set<string>();
    while (n && !seen.has(n.id)) {
      seen.add(n.id);
      if (n.parentId === targetId) return n.id;
      n = n.parentId ? byId.get(n.parentId) : undefined;
    }
    return null;
  };

  // Focal point in canvas coords for a transition (where we zoom toward).
  const focalPoint = (toId: string, fromId: string, dir: "in" | "out") => {
    if (dir === "out") {
      const towardId = childTowards(toId, fromId);
      const node = towardId
        ? computeLayout(toId).kidNodes.find((n) => n.child.id === towardId)
        : null;
      if (node) return { x: node.x, y: node.y };
    }
    return { x: dims.w / 2, y: dims.h / 2 };
  };

  // Render one bubble's radial layer. `interactive` enables clicks + add input.
  const renderLayer = (bid: string, interactive: boolean) => {
    const L = computeLayout(bid);
    if (!L.bubble) return null;
    const noteCount = notesOf.get(bid)?.length ?? 0;
    return (
      <>
        <svg className="absolute inset-0 h-full w-full text-neutral-200 dark:text-neutral-700">
          {L.kidNodes.map((n) => (
            <line
              key={n.child.id}
              x1={L.cx}
              y1={L.cy}
              x2={n.x}
              y2={n.y}
              stroke="currentColor"
              strokeWidth={1.5}
            />
          ))}
        </svg>

        {L.kidNodes.map((n) => (
          <button
            key={n.child.id}
            type="button"
            disabled={!interactive}
            onClick={
              interactive
                ? () => navigate(n.child.id, { x: n.x, y: n.y })
                : undefined
            }
            style={{ left: n.x, top: n.y, width: n.d, height: n.d }}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border p-2 text-center shadow-sm transition-transform duration-150 ${
              interactive ? "hover:scale-105 active:scale-95" : ""
            } ${colorClassFor(n.child, n.i)}`}
          >
            {n.child.emoji && (
              <span className="text-xl leading-none">{n.child.emoji}</span>
            )}
            <span className="line-clamp-2 px-1 text-xs font-medium leading-tight">
              {n.child.title || "Untitled"}
            </span>
            {(n.noteCount > 0 || n.kidCount > 0) && (
              <span className="flex items-center gap-1 text-[10px] opacity-70">
                {n.noteCount > 0 && <span>📝{n.noteCount}</span>}
                {n.kidCount > 0 && <span>◯{n.kidCount}</span>}
              </span>
            )}
          </button>
        ))}

        {interactive && adding === "bubble" ? (
          <div
            style={{ left: L.addPos.x, top: L.addPos.y, width: 84, height: 84 }}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-neutral-300 bg-white p-1 dark:border-neutral-600 dark:bg-neutral-900"
          >
            <input
              autoFocus
              value={addDraft}
              onChange={(e) => setAddDraft(e.target.value)}
              onBlur={() => (addDraft.trim() ? submitAdd() : setAdding(null))}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
                if (e.key === "Escape") setAdding(null);
              }}
              placeholder="Name…"
              className="w-full bg-transparent text-center text-xs outline-none"
            />
          </div>
        ) : (
          <button
            type="button"
            disabled={!interactive}
            onClick={interactive ? () => startAdd("bubble") : undefined}
            style={{ left: L.addPos.x, top: L.addPos.y, width: 72, height: 72 }}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 active:scale-95 dark:border-neutral-700 dark:hover:border-neutral-500"
          >
            <Plus className="h-5 w-5" />
            <span className="text-[10px]">bubble</span>
          </button>
        )}

        <div
          style={{ left: L.cx, top: L.cy, width: L.centerD, height: L.centerD }}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border bg-neutral-900 p-3 text-center text-white shadow-lg dark:bg-white dark:text-neutral-900"
        >
          {L.bubble.emoji && (
            <span className="text-2xl leading-none">{L.bubble.emoji}</span>
          )}
          <span className="line-clamp-3 px-1 text-sm font-semibold leading-tight">
            {L.bubble.title || "Untitled"}
          </span>
          {noteCount > 0 && (
            <span className="text-[11px] opacity-70">📝 {noteCount}</span>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 px-4 py-2.5 text-sm dark:border-neutral-800">
        {breadcrumb.map((b, i) => (
          <span key={b.id} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            )}
            <button
              type="button"
              onClick={() => navigate(b.id)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
                b.id === effectiveId
                  ? "font-semibold text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800"
              }`}
            >
              {b.emoji && <span>{b.emoji}</span>}
              {b.title || "Untitled"}
            </button>
          </span>
        ))}
      </nav>

      {/* Action bar for the current bubble */}
      <div className="relative flex items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        {current.emoji && <span className="text-lg">{current.emoji}</span>}
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="flex-1 border-b border-neutral-300 bg-transparent text-base font-semibold outline-none dark:border-neutral-600"
          />
        ) : (
          <h1
            onClick={startRename}
            className="flex-1 cursor-text truncate text-base font-semibold"
            title="Click to rename"
          >
            {current.title || "Untitled"}
          </h1>
        )}
        <button
          type="button"
          onClick={() => setStylePickerOpen((v) => !v)}
          aria-label="Bubble style"
          title="Emoji & color"
          className="rounded p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Palette className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={startRename}
          aria-label="Rename bubble"
          title="Rename"
          className="rounded p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Pencil className="h-4 w-4" />
        </button>
        {!isRoot && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete bubble"
            title="Delete bubble (and its subtree)"
            className="rounded p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {stylePickerOpen && (
          <StylePicker
            current={current}
            onPick={(style) => setStyle(style)}
            onClose={() => setStylePickerOpen(false)}
          />
        )}
      </div>

      {/* Canvas (left) + notes/editor pane (right) */}
      <div ref={rowRef} className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Radial bubble canvas */}
        <div
          ref={canvasRef}
          className={`relative min-h-0 flex-1 overflow-hidden ${
            editingNoteId ? "hidden md:block" : ""
          }`}
        >
        {dims.w > 0 && !transition && (
          <div className="absolute inset-0">{renderLayer(effectiveId, true)}</div>
        )}
        {dims.w > 0 && transition && (
          <div className="pointer-events-none absolute inset-0">
            <div ref={incomingRef} className="absolute inset-0 will-change-transform">
              {renderLayer(transition.toId, false)}
            </div>
            <div ref={outgoingRef} className="absolute inset-0 will-change-transform">
              {renderLayer(transition.fromId, false)}
            </div>
          </div>
        )}
      </div>

        {/* Drag handle to resize the pane (desktop only) */}
        <div
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-neutral-200 transition-colors hover:bg-blue-400 md:block dark:bg-neutral-800 dark:hover:bg-blue-500"
        />

        {/* Notes / editor pane (right on desktop, below on mobile) */}
        <div
          style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
          className={`flex min-h-0 flex-col border-t border-neutral-200 dark:border-neutral-800 md:border-t-0 md:w-[var(--panel-w)] md:flex-none ${
            editingNoteId ? "flex-1" : "h-56 md:h-auto"
          }`}
        >
          {editingNoteId ? (
            loadingNote || !editingNote ? (
              <div className="flex h-full items-center justify-center text-neutral-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <NoteEditor
                key={editingNote.id}
                noteId={editingNote.id}
                initialTitle={editingNote.title}
                initialContent={editingNote.content}
                onClose={closeEditor}
                trashAction={trashBubbleNoteAction}
                onTrashed={closeEditor}
              />
            )
          ) : (
            <>
              <h2 className="px-4 pt-3 pb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                {bubbleNotes.length > 0
                  ? `${bubbleNotes.length} note${
                      bubbleNotes.length === 1 ? "" : "s"
                    } here`
                  : "Notes"}
              </h2>
              <div className="flex flex-1 gap-4 overflow-x-auto px-4 pb-3 md:flex-wrap md:content-start md:overflow-x-hidden md:overflow-y-auto">
                {bubbleNotes.map((note) => (
                  <div key={note.id} className="shrink-0">
                    <NoteCard
                      title={note.title}
                      preview={note.preview}
                      onClick={() => openNote(note.id)}
                    />
                  </div>
                ))}
                <div className="shrink-0">
                  {adding === "note" ? (
                    <InlineCreate
                      shape="card"
                      placeholder="Note title…"
                      value={addDraft}
                      onChange={setAddDraft}
                      onSubmit={submitAdd}
                      onCancel={() => setAdding(null)}
                    />
                  ) : (
                    <AddTile
                      shape="card"
                      label="Add note"
                      onClick={() => startAdd("note")}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete “${current.title || "Untitled"}”?`}
          message={
            (() => {
              const d = totalDescendants(current.id);
              const n = bubbleNotes.length;
              const parts: string[] = [];
              if (d > 0) parts.push(`${d} nested bubble${d === 1 ? "" : "s"}`);
              if (n > 0) parts.push(`${n} note${n === 1 ? "" : "s"} here`);
              return parts.length
                ? `This also deletes ${parts.join(" and ")}. This can’t be undone.`
                : "This can’t be undone.";
            })()
          }
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NoteCard({
  title,
  preview,
  onClick,
}: {
  title: string;
  preview: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-24 flex-col items-center gap-2 sm:w-28"
    >
      <div className="relative h-28 w-20 overflow-hidden rounded-lg border border-neutral-200 bg-white p-2.5 text-left shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-active:scale-95 sm:h-32 sm:w-24 dark:border-neutral-700 dark:bg-neutral-800">
        <div
          className="absolute right-0 top-0 h-4 w-4 bg-neutral-100 dark:bg-neutral-700"
          style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
        />
        {preview ? (
          <p className="line-clamp-6 text-[9px] leading-snug text-neutral-500 dark:text-neutral-400">
            {preview}
          </p>
        ) : (
          <div className="space-y-2 pt-1">
            <div className="h-1.5 w-3/4 rounded bg-neutral-200 dark:bg-neutral-600" />
            <div className="h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-600" />
            <div className="h-1.5 w-5/6 rounded bg-neutral-200 dark:bg-neutral-600" />
          </div>
        )}
      </div>
      <span className="line-clamp-2 text-center text-xs font-medium leading-tight">
        {title || "Untitled"}
      </span>
    </button>
  );
}

function AddTile({
  shape,
  label,
  onClick,
}: {
  shape: "card" | "circle";
  label: string;
  onClick: () => void;
}) {
  const box =
    shape === "circle"
      ? "aspect-square w-28 rounded-full sm:w-32"
      : "h-28 w-20 rounded-lg sm:h-32 sm:w-24";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-24 flex-col items-center gap-2 sm:w-28"
    >
      <div
        className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 active:scale-95 dark:border-neutral-700 dark:hover:border-neutral-500 ${box}`}
      >
        <Plus className="h-6 w-6" />
        {shape === "circle" && <span className="text-xs">{label}</span>}
      </div>
      {shape === "card" && (
        <span className="text-center text-xs text-neutral-400">{label}</span>
      )}
    </button>
  );
}

function InlineCreate({
  shape,
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  shape: "card" | "circle";
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  // Guard so Enter + the resulting blur don't both fire.
  const doneRef = useRef(false);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit && value.trim()) onSubmit();
    else onCancel();
  };

  const input = (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      placeholder={placeholder}
      className="w-full bg-transparent text-center text-xs outline-none"
    />
  );

  // Circle (bubble): type inside the circle.
  if (shape === "circle") {
    return (
      <div className="flex w-24 flex-col items-center gap-2 sm:w-28">
        <div className="flex aspect-square w-28 items-center justify-center rounded-full border-2 border-neutral-300 p-2 sm:w-32 dark:border-neutral-600">
          {input}
        </div>
      </div>
    );
  }

  // Card (note): a blank page on top, type the title in its real place below.
  return (
    <div className="flex w-24 flex-col items-center gap-2 sm:w-28">
      <div className="h-28 w-20 rounded-lg border-2 border-dashed border-neutral-300 bg-white sm:h-32 sm:w-24 dark:border-neutral-600 dark:bg-neutral-800" />
      <div className="w-full border-b border-neutral-300 dark:border-neutral-600">
        {input}
      </div>
    </div>
  );
}

function StylePicker({
  current,
  onPick,
  onClose,
}: {
  current: BubbleData;
  onPick: (style: { emoji?: string | null; color?: string | null }) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-10 cursor-default"
      />
      <div className="absolute right-0 top-12 z-20 w-64 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-1 text-xs font-medium text-neutral-500">Emoji</div>
        <div className="mb-3 grid grid-cols-8 gap-1">
          <button
            type="button"
            onClick={() => onPick({ emoji: null })}
            className="flex h-7 items-center justify-center rounded text-xs text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="No emoji"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {EMOJI_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick({ emoji: e })}
              className={`flex h-7 items-center justify-center rounded text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                current.emoji === e ? "bg-neutral-100 dark:bg-neutral-800" : ""
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mb-1 text-xs font-medium text-neutral-500">Color</div>
        <div className="flex gap-2">
          {COLOR_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onPick({ color: name })}
              className={`h-6 w-6 rounded-full ${SWATCH[name]} ${
                current.color === name
                  ? "ring-2 ring-neutral-900 ring-offset-1 dark:ring-white"
                  : ""
              }`}
              aria-label={name}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-neutral-500">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            <Check className="h-4 w-4" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

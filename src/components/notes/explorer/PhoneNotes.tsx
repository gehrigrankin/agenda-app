"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  FilePlus,
  FileText,
  Files,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Palette,
  Pencil,
  Search,
  SquarePen,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { searchNoteBodiesAction } from "@/app/app/notes/actions";
import { BottomSheet } from "@/components/layout/BottomSheet";
import {
  SORT_LABELS,
  SORT_MODES,
  folderPath,
  highlightSegments,
  isInvalidFolderMove,
  titleMatches,
  type ExplorerNode,
  type FolderNodeX,
  type GroupMode,
  type NoteNodeX,
  type SortMode,
} from "@/lib/explorer-tree";
import type { MenuAction } from "./ExplorerMenus";
import { ColorIconPanel } from "./ExplorerMenus";
import type { DragItem } from "./ExplorerTree";
import { areaCss, folderIcon } from "./folder-style";

/**
 * The Notes screen on a phone (Notes Sidebars design §4c–§4g): the Explorer
 * IS the screen. At the root: filter field, the Today card, the root folders
 * (color-coded areas), then loose notes. Tapping a folder goes INTO it (a
 * hoist) with tappable path chips to jump back up; subfolders come before
 * notes. Long-press lifts a row: release in place for the action sheet (same
 * items as the desktop context menu), or drag it onto a folder — or a path
 * chip, to move it up — to move it.
 */

type Sheet =
  | { kind: "actions"; node: ExplorerNode }
  | { kind: "move"; node: ExplorerNode }
  | { kind: "color"; node: FolderNodeX }
  | { kind: "rename"; node: ExplorerNode }
  | { kind: "sort-folder"; node: FolderNodeX }
  | { kind: "sort-global" };

type Scope = "everywhere" | "folder" | "titles";

export interface PhoneNotesProps {
  tree: ExplorerNode[];
  index: Map<string, ExplorerNode>;
  folderId: string | null;
  onFolder: (id: string | null) => void;
  prefs: { sort: SortMode; group: GroupMode };
  onPrefs: (p: { sort: SortMode; group: GroupMode }) => void;
  today: { label: string; time: string } | null;
  onOpenToday: () => void;
  tabCount: number;
  onOpenSwitcher: () => void;
  onOpenNote: (id: string) => void;
  onNewNote: (folderId: string | null) => void;
  onNewFolder: (parentId: string | null) => void;
  onAction: (action: MenuAction, node: ExplorerNode) => void;
  onRename: (id: string, title: string | null) => void;
  onMove: (item: DragItem, folderId: string | null) => void;
  onStyle: (
    id: string,
    style: { color?: string | null; icon?: string | null },
  ) => void;
  onSortFolder: (id: string, mode: SortMode | null) => void;
  now: Date | null;
}

function when(iso: string, now: Date | null): string {
  if (!now) return "";
  const d = new Date(iso);
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PhoneNotes(props: PhoneNotesProps) {
  const { tree, index, folderId, onFolder, now } = props;
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("everywhere");
  const [bodyHits, setBodyHits] = useState<Map<string, string>>(new Map());

  const current = folderId ? index.get(folderId) : undefined;
  const folder = current?.kind === "folder" ? current : null;
  const items: ExplorerNode[] = folder ? folder.children : tree;
  const subfolders = items.filter((n): n is FolderNodeX => n.kind === "folder");
  const notesHere = items.filter((n): n is NoteNodeX => n.kind === "note");
  const path = folderPath(index, folder?.id ?? null);
  const parent = path.length > 1 ? path[path.length - 2] : null;

  // Body matches for the filter ("match in text").
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || scope === "titles") {
      setBodyHits(new Map());
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchNoteBodiesAction(q)
        .then((hits) => {
          if (!cancelled)
            setBodyHits(new Map(hits.map((h) => [h.id, h.snippet])));
        })
        .catch(() => {});
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, scope]);

  const drag = useLift(index, props.onMove, (node) =>
    setSheet({ kind: "actions", node }),
  );

  // While dragging, holding over a folder for a moment goes into it.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const t = drag.target;
    if (!drag.item || !t || t.chip || t.folderId === null) return;
    hoverTimer.current = setTimeout(() => onFolder(t.folderId), 800);
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, [drag.item, drag.target, onFolder]);

  if (filtering || query) {
    return (
      <PhoneFilter
        {...props}
        query={query}
        onQuery={setQuery}
        scope={scope}
        onScope={setScope}
        bodyHits={bodyHits}
        folder={folder}
        onCancel={() => {
          setQuery("");
          setFiltering(false);
        }}
      />
    );
  }

  const headerBtn =
    "flex h-11 w-11 items-center justify-center rounded-full text-ink-300 outline-none focus-visible:ring-1 focus-visible:ring-sage/60";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-canvas">
      {/* Header */}
      <div className="flex h-14 flex-none items-center gap-1 px-2">
        {folder ? (
          <button
            type="button"
            onClick={() => onFolder(parent?.id ?? null)}
            className="flex h-11 min-w-0 items-center gap-0.5 pr-2 text-[1rem] font-medium text-sage"
          >
            <ChevronLeft className="h-5 w-5 flex-none" />
            <span className="truncate">{parent?.title ?? "Notes"}</span>
          </button>
        ) : (
          <h1 className="px-2.5 text-[1.75rem] font-semibold text-ink-100">
            Notes
          </h1>
        )}
        <span className="flex-1" />
        <TabCountButton count={props.tabCount} onClick={props.onOpenSwitcher} />
        {folder ? (
          <button
            type="button"
            aria-label={`${folder.folder.title} actions`}
            onClick={() => setSheet({ kind: "actions", node: folder })}
            className={headerBtn}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Sort and group"
            onClick={() => setSheet({ kind: "sort-global" })}
            className={headerBtn}
          >
            <ArrowDownUp className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          aria-label="New note"
          onClick={() => props.onNewNote(folder?.id ?? null)}
          className={`${headerBtn} text-sage`}
        >
          <SquarePen className="h-5 w-5" />
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto pb-24"
        style={drag.item ? { touchAction: "none" } : undefined}
      >
        {folder ? (
          <div className="px-5 pt-1 pb-3">
            <h1 className="flex items-center gap-2.5 text-[1.75rem] leading-tight font-semibold text-ink-100">
              <FolderGlyph node={folder} open className="h-7 w-7" />
              <span className="min-w-0 truncate">
                {folder.folder.title || "Untitled"}
              </span>
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {path.map((p, i) => {
                const isLast = i === path.length - 1;
                const target =
                  drag.item &&
                  drag.target?.chip &&
                  drag.target.folderId === p.id;
                return (
                  <span key={p.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      data-drop-folder={p.id}
                      data-drop-chip="1"
                      onClick={() => onFolder(p.id)}
                      aria-current={isLast ? "page" : undefined}
                      className={`flex h-9 items-center rounded-lg px-2.5 text-[0.8125rem] ${
                        target
                          ? "bg-sage/16 text-sage ring-1 ring-sage"
                          : isLast
                            ? "bg-white/10 text-ink-100"
                            : "bg-white/5 text-ink-300"
                      }`}
                      style={
                        i === 0 && !target && areaCss(rootColor(index, p.id))
                          ? {
                              color:
                                areaCss(rootColor(index, p.id)) ?? undefined,
                            }
                          : undefined
                      }
                    >
                      {p.title}
                    </button>
                    {!isLast && (
                      <ChevronRight className="h-3.5 w-3.5 text-ink-700" />
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setFiltering(true)}
              className="mx-4 flex h-11 w-[calc(100%-2rem)] items-center gap-2.5 rounded-xl border border-white/8 bg-white/4 px-3.5 text-left text-[0.9375rem] text-ink-600"
            >
              <Search className="h-4 w-4" />
              Filter notes &amp; folders
            </button>
            <button
              type="button"
              onClick={props.onOpenToday}
              className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-sage/30 bg-sage/8 px-4 py-3 text-left"
            >
              <Sun className="h-5 w-5 flex-none text-sage" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[1rem] font-semibold text-ink-100">
                  {props.today?.label ?? "Today"}
                </span>
                <span className="text-[0.8125rem] text-ink-500">
                  Daily note{props.today?.time ? ` · ${props.today.time}` : ""}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-ink-500" />
            </button>
          </>
        )}

        {subfolders.length > 0 && (
          <PhoneSection label="Folders">
            {subfolders.map((f) => (
              <FolderRow
                key={f.id}
                node={f}
                root={!folder}
                drag={drag}
                onOpen={() => onFolder(f.id)}
              />
            ))}
          </PhoneSection>
        )}

        {notesHere.length > 0 && (
          <PhoneSection
            label={folder ? `Notes · ${notesHere.length}` : "Loose notes"}
            trailing={
              folder ? (
                <button
                  type="button"
                  onClick={() =>
                    setSheet({ kind: "sort-folder", node: folder })
                  }
                  className="text-[0.8125rem] text-ink-500"
                >
                  {SORT_LABELS[folder.folder.sortMode ?? props.prefs.sort]}
                </button>
              ) : undefined
            }
          >
            {notesHere.map((n) => (
              <NoteRow
                key={n.id}
                node={n}
                now={now}
                drag={drag}
                onOpen={() => props.onOpenNote(n.id)}
              />
            ))}
          </PhoneSection>
        )}

        {subfolders.length === 0 && notesHere.length === 0 && (
          <p className="px-5 py-8 text-center text-[0.9375rem] text-ink-500">
            {folder ? "Nothing in this folder yet." : "No notes yet."}
          </p>
        )}
      </div>

      {drag.item && (
        <>
          <div
            aria-hidden
            className="pointer-events-none fixed z-[80] w-[min(22rem,85vw)] -translate-x-1/2 -translate-y-1/2 rotate-[-1.5deg] rounded-xl border border-white/12 bg-panel px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
            style={{ left: drag.point.x, top: drag.point.y }}
          >
            <span className="flex items-center gap-2.5 text-[0.9375rem] font-medium text-ink-100">
              {drag.item.kind === "folder" ? (
                <Folder className="h-4 w-4 text-ink-400" />
              ) : (
                <FileText className="h-4 w-4 text-ink-400" />
              )}
              {titleOf(index.get(drag.item.id))}
            </span>
          </div>
          <div className="pointer-events-none fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[79] rounded-xl bg-panel/95 px-4 py-2.5 text-center text-[0.8125rem] text-ink-300 shadow-lg">
            Hold over a folder to open it · drop on the path to move up
          </div>
        </>
      )}

      {sheet && (
        <PhoneSheets
          sheet={sheet}
          setSheet={setSheet}
          {...props}
        />
      )}
    </div>
  );
}

function titleOf(n: ExplorerNode | undefined): string {
  if (!n) return "";
  return (n.kind === "folder" ? n.folder.title : n.note.title) || "Untitled";
}

function rootColor(
  index: Map<string, ExplorerNode>,
  id: string,
): string | null {
  const n = index.get(id);
  return n?.kind === "folder" ? n.folder.color : null;
}

export function TabCountButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Open notes (${count})`}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-sage/60"
    >
      <span className="flex h-6 min-w-6 items-center justify-center rounded-md border-[1.5px] border-ink-300 px-1 text-[0.75rem] font-semibold text-ink-200">
        {count}
      </span>
    </button>
  );
}

function PhoneSection({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <div className="flex items-center px-5 pb-1.5">
        <h2 className="flex-1 text-[0.75rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
          {label}
        </h2>
        {trailing}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function FolderGlyph({
  node,
  open,
  className,
}: {
  node: FolderNodeX;
  open?: boolean;
  className?: string;
}) {
  const color = areaCss(node.folder.color);
  const Icon = folderIcon(node.folder.icon) ?? (open ? FolderOpen : Folder);
  return (
    <Icon
      className={`flex-none ${color ? "" : "text-ink-400"} ${className ?? "h-5 w-5"}`}
      style={color ? { color } : undefined}
    />
  );
}

type Lift = ReturnType<typeof useLift>;

function FolderRow({
  node,
  root,
  drag,
  onOpen,
}: {
  node: FolderNodeX;
  root: boolean;
  drag: Lift;
  onOpen: () => void;
}) {
  const color = areaCss(node.folder.color);
  const isTarget =
    !!drag.item && !drag.target?.chip && drag.target?.folderId === node.id;
  const isSource = drag.item?.id === node.id;
  return (
    <button
      type="button"
      data-drop-folder={node.id}
      {...drag.handlers(node)}
      onClick={() => {
        if (!drag.consumeClick()) onOpen();
      }}
      className={`mx-2 flex min-h-[3.25rem] items-center gap-3 rounded-xl px-3 text-left select-none [-webkit-touch-callout:none] ${
        isTarget ? "bg-sage/12 ring-1 ring-sage" : "active:bg-white/5"
      } ${isSource ? "opacity-35" : ""}`}
    >
      <FolderGlyph node={node} />
      <span
        className={`min-w-0 flex-1 truncate ${
          root
            ? "text-[0.875rem] font-semibold tracking-[0.08em] uppercase"
            : "text-[1rem] text-ink-100"
        }`}
        style={root && color ? { color } : undefined}
      >
        {node.folder.title || "Untitled"}
      </span>
      {isTarget ? (
        <span className="text-[0.8125rem] font-medium text-sage">
          Drop to move
        </span>
      ) : (
        <>
          <span className="text-[0.8125rem] text-ink-600 tabular-nums">
            {node.noteCount}
          </span>
          <ChevronRight className="h-4 w-4 text-ink-600" />
        </>
      )}
    </button>
  );
}

function NoteRow({
  node,
  now,
  drag,
  onOpen,
}: {
  node: NoteNodeX;
  now: Date | null;
  drag: Lift;
  onOpen: () => void;
}) {
  const isSource = drag.item?.id === node.id;
  return (
    <button
      type="button"
      {...drag.handlers(node)}
      onClick={() => {
        if (!drag.consumeClick()) onOpen();
      }}
      className={`mx-2 flex items-start gap-3 rounded-xl border-b border-white/5 px-3 py-3 text-left select-none [-webkit-touch-callout:none] active:bg-white/5 ${
        isSource ? "opacity-35" : ""
      }`}
    >
      <FileText className="mt-0.5 h-5 w-5 flex-none text-ink-500" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[1rem] font-medium text-ink-100">
            {node.note.title || "Untitled"}
          </span>
          <span
            suppressHydrationWarning
            className="flex-none text-[0.8125rem] text-ink-600"
          >
            {when(node.note.updatedAt, now)}
          </span>
        </span>
        <span className="truncate text-[0.875rem] text-ink-500">
          {node.note.preview || "Empty note"}
        </span>
      </span>
    </button>
  );
}

/**
 * Long-press to lift a row. Release without moving → the action sheet; drag
 * → move onto whatever `[data-drop-folder]` is under the finger (a folder
 * row, or a path chip to move up). Pointer events, so a mouse can do it too.
 */
function useLift(
  index: Map<string, ExplorerNode>,
  onMove: (item: DragItem, folderId: string | null) => void,
  onSheet: (node: ExplorerNode) => void,
) {
  const [item, setItem] = useState<DragItem | null>(null);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState<{
    folderId: string | null;
    chip: boolean;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; node: ExplorerNode } | null>(
    null,
  );
  const lifted = useRef(false);
  const moved = useRef(false);
  const swallowClick = useRef(false);

  // Once lifted, the page must not scroll under the finger.
  useEffect(() => {
    if (!item) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", stop, { passive: false });
    return () => document.removeEventListener("touchmove", stop);
  }, [item]);

  const hitTest = (x: number, y: number, dragId: string) => {
    const el = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-drop-folder]");
    if (!el) return null;
    const id = el.dataset.dropFolder ?? null;
    const folderId = id === "root" ? null : id;
    const node = index.get(dragId);
    if (folderId === dragId) return null;
    if (node?.kind === "folder" && isInvalidFolderMove(index, dragId, folderId))
      return null;
    if (node && (node.ancestors.at(-1) ?? null) === folderId) return null;
    return { folderId, chip: el.dataset.dropChip === "1" };
  };

  const end = () => {
    if (timer.current) clearTimeout(timer.current);
    start.current = null;
    lifted.current = false;
    moved.current = false;
    setItem(null);
    setTarget(null);
  };

  return {
    item,
    point,
    target,
    /** True once for the click that ends a long-press (don't also open). */
    consumeClick: () => {
      const v = swallowClick.current;
      swallowClick.current = false;
      return v;
    },
    handlers: (node: ExplorerNode) => ({
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY, node };
        moved.current = false;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          lifted.current = true;
          swallowClick.current = true;
          setPoint({ x: start.current?.x ?? 0, y: start.current?.y ?? 0 });
          setItem({ id: node.id, kind: node.kind });
          try {
            navigator.vibrate?.(10);
          } catch {}
        }, 450);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = start.current;
        if (!s) return;
        const far = Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8;
        if (!lifted.current) {
          // Moving before the hold completes is a scroll, not a lift.
          if (far && timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
            start.current = null;
          }
          return;
        }
        if (far) moved.current = true;
        setPoint({ x: e.clientX, y: e.clientY });
        setTarget(hitTest(e.clientX, e.clientY, s.node.id));
      },
      onPointerUp: (e: React.PointerEvent) => {
        const s = start.current;
        const wasLifted = lifted.current;
        const didMove = moved.current;
        const t = s ? hitTest(e.clientX, e.clientY, s.node.id) : null;
        end();
        if (!s || !wasLifted) return;
        if (didMove && t)
          onMove({ id: s.node.id, kind: s.node.kind }, t.folderId);
        else if (!didMove) onSheet(s.node);
      },
      onPointerCancel: () => end(),
    }),
  };
}

// ── Filter (§4g) ─────────────────────────────────────────────────────────────

function PhoneFilter({
  index,
  query,
  onQuery,
  scope,
  onScope,
  bodyHits,
  folder,
  onCancel,
  onFolder,
  onOpenNote,
  now,
}: PhoneNotesProps & {
  query: string;
  onQuery: (q: string) => void;
  scope: Scope;
  onScope: (s: Scope) => void;
  bodyHits: Map<string, string>;
  folder: FolderNodeX | null;
  onCancel: () => void;
}) {
  const all = useMemo(() => Array.from(index.values()), [index]);
  const q = query.trim();
  const inScope = (n: ExplorerNode) =>
    scope !== "folder" || !folder || n.ancestors.includes(folder.id);
  const folders = q
    ? all.filter(
        (n): n is FolderNodeX =>
          n.kind === "folder" && inScope(n) && titleMatches(n.folder.title, q),
      )
    : [];
  const notes = q
    ? all.filter(
        (n): n is NoteNodeX =>
          n.kind === "note" &&
          inScope(n) &&
          (titleMatches(n.note.title, q) ||
            (scope !== "titles" && bodyHits.has(n.id))),
      )
    : [];
  const pathOf = (n: ExplorerNode) =>
    folderPath(index, n.ancestors.at(-1) ?? null)
      .map((p) => p.title)
      .join(" / ");

  const chip = (s: Scope, label: string) => (
    <button
      type="button"
      aria-pressed={scope === s}
      onClick={() => onScope(s)}
      className={`h-9 rounded-full px-3.5 text-[0.875rem] ${
        scope === s ? "bg-sage/16 text-sage" : "bg-white/6 text-ink-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex h-14 flex-none items-center px-5">
        <h1 className="flex-1 text-[1.75rem] font-semibold text-ink-100">
          Notes
        </h1>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 px-1 text-[1rem] text-sage"
        >
          Cancel
        </button>
      </div>
      <label className="mx-4 flex h-11 flex-none items-center gap-2.5 rounded-xl border border-sage/40 bg-white/4 px-3.5">
        <Search className="h-4 w-4 text-ink-500" />
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter notes & folders"
          aria-label="Filter notes and folders"
          className="min-w-0 flex-1 bg-transparent text-[1rem] text-ink-100 outline-none placeholder:text-ink-600"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => onQuery("")}
            className="text-ink-500"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </label>
      <div className="flex flex-none gap-2 overflow-x-auto px-4 pt-3 pb-1">
        {chip("everywhere", "Everywhere")}
        {folder && chip("folder", `In ${folder.folder.title || "this folder"}`)}
        {chip("titles", "Titles only")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {q && folders.length > 0 && (
          <PhoneSection label={`Folders · ${folders.length}`}>
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onCancel();
                  onFolder(f.id);
                }}
                className="mx-2 flex min-h-[3.25rem] items-center gap-3 rounded-xl px-3 text-left active:bg-white/5"
              >
                <FolderGlyph node={f} />
                <span className="min-w-0 flex-1 truncate text-[1rem] text-ink-100">
                  {f.folder.title}
                </span>
                <span className="max-w-[40%] truncate text-[0.8125rem] text-ink-500">
                  {pathOf(f)}
                </span>
                <ChevronRight className="h-4 w-4 text-ink-600" />
              </button>
            ))}
          </PhoneSection>
        )}
        {q && notes.length > 0 && (
          <PhoneSection label={`Notes · ${notes.length}`}>
            {notes.map((n) => {
              const inTitle = titleMatches(n.note.title, q);
              const snippet = bodyHits.get(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onOpenNote(n.id)}
                  className="mx-2 flex items-start gap-3 border-b border-white/5 px-3 py-3 text-left active:bg-white/5"
                >
                  <FileText className="mt-0.5 h-5 w-5 flex-none text-ink-500" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[1rem] font-medium text-ink-100">
                        <Highlighted
                          text={n.note.title || "Untitled"}
                          q={inTitle ? q : ""}
                        />
                      </span>
                      <span
                        suppressHydrationWarning
                        className="flex-none text-[0.8125rem] text-ink-600"
                      >
                        {when(n.note.updatedAt, now)}
                      </span>
                    </span>
                    <span className="truncate text-[0.8125rem] text-ink-500">
                      {pathOf(n) || "Loose notes"}
                      {!inTitle ? " · match in text" : ""}
                    </span>
                    <span className="truncate text-[0.875rem] text-ink-400">
                      {!inTitle && snippet ? (
                        <Highlighted text={snippet} q={q} />
                      ) : (
                        n.note.preview
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </PhoneSection>
        )}
        {q && folders.length === 0 && notes.length === 0 && (
          <p className="px-5 py-8 text-center text-[0.9375rem] text-ink-500">
            Nothing matches &ldquo;{q}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}

function Highlighted({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightSegments(text, q).map((s, i) =>
        s.hit ? (
          <mark
            key={i}
            className="rounded-[2px] bg-area-amber/30 px-px text-ink-100"
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

// ── Sheets (§4e) ─────────────────────────────────────────────────────────────

function PhoneSheets({
  sheet,
  setSheet,
  index,
  prefs,
  onPrefs,
  onNewNote,
  onNewFolder,
  onAction,
  onRename,
  onMove,
  onStyle,
  onSortFolder,
  onOpenNote,
}: PhoneNotesProps & {
  sheet: Sheet;
  setSheet: (s: Sheet | null) => void;
}) {
  const close = () => setSheet(null);

  if (sheet.kind === "sort-global" || sheet.kind === "sort-folder") {
    const isFolder = sheet.kind === "sort-folder";
    const value = isFolder ? sheet.node.folder.sortMode : prefs.sort;
    return (
      <BottomSheet
        label="Sort"
        onClose={close}
        header={
          <SheetTitle title={isFolder ? "Sort this folder" : "Sort & group"} />
        }
      >
        <div className="flex flex-col px-3 pb-2">
          {isFolder && (
            <CheckRow
              label="Same as everywhere"
              on={value === null}
              onClick={() => {
                onSortFolder(sheet.node.id, null);
                close();
              }}
            />
          )}
          {SORT_MODES.map((m) => (
            <CheckRow
              key={m}
              label={SORT_LABELS[m]}
              on={value === m}
              onClick={() => {
                if (isFolder) onSortFolder(sheet.node.id, m);
                else onPrefs({ ...prefs, sort: m });
                close();
              }}
            />
          ))}
          {!isFolder && (
            <>
              <div className="mx-3 my-2 h-px bg-white/8" />
              <CheckRow
                label="Folders first"
                on={prefs.group === "folders-first"}
                onClick={() => {
                  onPrefs({ ...prefs, group: "folders-first" });
                  close();
                }}
              />
              <CheckRow
                label="Mixed"
                on={prefs.group === "mixed"}
                onClick={() => {
                  onPrefs({ ...prefs, group: "mixed" });
                  close();
                }}
              />
            </>
          )}
        </div>
      </BottomSheet>
    );
  }

  const node = sheet.node;
  const title = titleOf(node);
  const pathText = folderPath(index, node.ancestors.at(-1) ?? null)
    .map((p) => p.title)
    .join(" / ");

  if (sheet.kind === "rename") {
    return (
      <BottomSheet
        label="Rename"
        onClose={close}
        header={<SheetTitle title="Rename" />}
      >
        <RenameForm
          initial={title === "Untitled" ? "" : title}
          onDone={(v) => {
            onRename(node.id, v);
            close();
          }}
        />
      </BottomSheet>
    );
  }

  if (sheet.kind === "color") {
    return (
      <BottomSheet
        label="Color and icon"
        onClose={close}
        header={<SheetTitle title="Color & icon" />}
      >
        <div className="px-4 pb-3">
          <ColorIconPanel
            bare
            color={sheet.node.folder.color}
            icon={sheet.node.folder.icon}
            onBack={close}
            onPick={(style) => {
              onStyle(node.id, style);
              setSheet({
                kind: "color",
                node: {
                  ...sheet.node,
                  folder: {
                    ...sheet.node.folder,
                    ...("color" in style ? { color: style.color ?? null } : {}),
                    ...("icon" in style ? { icon: style.icon ?? null } : {}),
                  },
                },
              });
            }}
          />
        </div>
      </BottomSheet>
    );
  }

  if (sheet.kind === "move") {
    const current = node.ancestors.at(-1) ?? null;
    const folders = Array.from(index.values())
      .filter((n): n is FolderNodeX => n.kind === "folder")
      .filter(
        (n) =>
          !(
            node.kind === "folder" && isInvalidFolderMove(index, node.id, n.id)
          ),
      )
      .map((n) => ({
        id: n.id,
        path: [
          ...folderPath(index, n.ancestors.at(-1) ?? null).map((p) => p.title),
          n.folder.title || "Untitled",
        ].join(" / "),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return (
      <BottomSheet
        label="Move to"
        onClose={close}
        header={<SheetTitle title={`Move “${title}”`} />}
      >
        <div className="flex flex-col px-3 pb-2">
          <CheckRow
            label="Top level (no folder)"
            on={current === null}
            onClick={() => {
              onMove({ id: node.id, kind: node.kind }, null);
              close();
            }}
          />
          {folders.map((f) => (
            <CheckRow
              key={f.id}
              label={f.path}
              on={current === f.id}
              onClick={() => {
                onMove({ id: node.id, kind: node.kind }, f.id);
                close();
              }}
            />
          ))}
        </div>
      </BottomSheet>
    );
  }

  // Actions: a grid of quick actions, then the full list — the desktop
  // context menu's items (§4e).
  const isFolder = node.kind === "folder";
  const quick: { label: string; icon: LucideIcon; run: () => void }[] = isFolder
    ? [
        {
          label: "New note",
          icon: FilePlus,
          run: () => {
            close();
            onNewNote(node.id);
          },
        },
        {
          label: "Subfolder",
          icon: FolderPlus,
          run: () => {
            close();
            onNewFolder(node.id);
          },
        },
        {
          label: "Move",
          icon: FolderInput,
          run: () => setSheet({ kind: "move", node }),
        },
        {
          label: "Color",
          icon: Palette,
          run: () => setSheet({ kind: "color", node: node as FolderNodeX }),
        },
      ]
    : [
        {
          label: "Open",
          icon: FileText,
          run: () => {
            close();
            onOpenNote(node.id);
          },
        },
        {
          label: "Move",
          icon: FolderInput,
          run: () => setSheet({ kind: "move", node }),
        },
        {
          label: "Duplicate",
          icon: CopyPlus,
          run: () => {
            close();
            onAction("duplicate", node);
          },
        },
        {
          label: "Copy link",
          icon: Copy,
          run: () => {
            close();
            onAction("copy-link", node);
          },
        },
      ];
  const list: {
    label: string;
    icon: LucideIcon;
    run: () => void;
    detail?: string;
    danger?: boolean;
  }[] = [
    ...(isFolder
      ? [
          {
            label: "Open all in tabs",
            icon: Files,
            run: () => {
              close();
              onAction("open-all", node);
            },
          },
        ]
      : []),
    {
      label: "Rename",
      icon: Pencil,
      run: () => setSheet({ kind: "rename", node }),
    },
    ...(isFolder
      ? [
          {
            label: "Sort this folder",
            icon: ArrowDownUp,
            detail:
              SORT_LABELS[(node as FolderNodeX).folder.sortMode ?? prefs.sort],
            run: () =>
              setSheet({ kind: "sort-folder", node: node as FolderNodeX }),
          },
          {
            label: "Copy link",
            icon: Copy,
            run: () => {
              close();
              onAction("copy-link", node);
            },
          },
        ]
      : []),
    {
      label: "Delete",
      icon: Trash2,
      danger: true,
      run: () => {
        close();
        onAction("delete", node);
      },
    },
  ];
  const count = isFolder ? (node as FolderNodeX).noteCount : 0;

  return (
    <BottomSheet
      label={`${title} actions`}
      onClose={close}
      header={
        <div className="flex items-center gap-3 border-b border-white/8 px-5 pt-1 pb-3">
          {isFolder ? (
            <FolderGlyph node={node as FolderNodeX} className="h-6 w-6" />
          ) : (
            <FileText className="h-6 w-6 text-ink-400" />
          )}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[1.0625rem] font-semibold text-ink-100">
              {title}
            </span>
            <span className="truncate text-[0.8125rem] text-ink-500">
              {[
                pathText || null,
                isFolder ? `${count} ${count === 1 ? "note" : "notes"}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Loose note"}
            </span>
          </span>
        </div>
      }
    >
      <div className="grid grid-cols-4 gap-2 px-4 pt-3 pb-2">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={q.run}
            className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl bg-white/6 px-1 text-[0.8125rem] text-ink-200 active:bg-white/10"
          >
            <q.icon className="h-5 w-5 text-ink-300" />
            {q.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col px-3 pb-2">
        {list.map((l) => (
          <button
            key={l.label}
            type="button"
            onClick={l.run}
            className={`flex min-h-12 items-center gap-3.5 rounded-xl px-3 text-left text-[1rem] active:bg-white/6 ${
              l.danger ? "text-overdue" : "text-ink-100"
            }`}
          >
            <l.icon className={`h-5 w-5 ${l.danger ? "" : "text-ink-400"}`} />
            <span className="flex-1">{l.label}</span>
            {l.detail && (
              <span className="text-[0.875rem] text-ink-500">{l.detail}</span>
            )}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

function SheetTitle({ title }: { title: string }) {
  return (
    <h2 className="truncate border-b border-white/8 px-5 pt-1 pb-3 text-[1.0625rem] font-semibold text-ink-100">
      {title}
    </h2>
  );
}

function CheckRow({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onClick}
      className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-[1rem] text-ink-100 active:bg-white/6"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {on && <span className="text-sage">✓</span>}
    </button>
  );
}

function RenameForm({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (v: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex flex-col gap-3 px-5 pt-3 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(value.trim() || null);
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Name"
        className="h-12 rounded-xl border border-white/10 bg-input px-3.5 text-[1rem] text-ink-100 outline-none focus:border-sage/60"
      />
      <button
        type="submit"
        className="h-12 rounded-xl bg-sage text-[1rem] font-semibold text-sage-ink"
      >
        Save
      </button>
    </form>
  );
}

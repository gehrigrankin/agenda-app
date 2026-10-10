"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  Check,
  ChevronRight,
  Copy,
  CopyPlus,
  Crosshair,
  ExternalLink,
  FilePlus,
  Files,
  FolderInput,
  FolderPlus,
  Palette,
  PanelRight,
  Pencil,
  PictureInPicture2,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  SORT_LABELS,
  SORT_MODES,
  type GroupMode,
  type SortMode,
} from "@/lib/explorer-tree";
import {
  AREA_COLORS,
  AREA_LABELS,
  FOLDER_ICON_NAMES,
  FOLDER_ICONS,
  areaColor,
} from "./folder-style";

/**
 * Explorer menus (Notes Sidebars design §3a/§3d): the right-click context
 * menu with single-key shortcuts and its Color & icon / Sort / Move to…
 * submenus, plus the header's Sort/Group menu. Keyboard: ↑/↓ move, → opens a
 * submenu, ← closes it, Enter runs, Esc closes, and each item's letter runs it
 * directly.
 */

export type MenuAction =
  | "new-note"
  | "new-subfolder"
  | "hoist"
  | "open-all"
  | "rename"
  | "move"
  | "copy-link"
  | "delete"
  | "open-split"
  | "open-tab"
  | "open-dock"
  | "duplicate";

interface Item {
  id: MenuAction | "color" | "sort";
  label: string;
  icon: LucideIcon;
  /** Display hint; `key` is what's matched. */
  hint?: string;
  key?: string;
  shift?: boolean;
  danger?: boolean;
  submenu?: boolean;
}

const FOLDER_ITEMS: (Item | "sep")[] = [
  { id: "new-note", label: "New note", icon: FilePlus, hint: "N", key: "n" },
  {
    id: "new-subfolder",
    label: "New subfolder",
    icon: FolderPlus,
    hint: "⇧N",
    key: "n",
    shift: true,
  },
  "sep",
  { id: "hoist", label: "Hoist folder", icon: Crosshair, hint: "H", key: "h" },
  { id: "open-all", label: "Open all in tabs", icon: Files },
  "sep",
  { id: "rename", label: "Rename", icon: Pencil, hint: "F2", key: "F2" },
  { id: "color", label: "Color & icon", icon: Palette, submenu: true },
  { id: "sort", label: "Sort", icon: ArrowDownUp, submenu: true },
  { id: "move", label: "Move to…", icon: FolderInput, hint: "M", key: "m" },
  { id: "copy-link", label: "Copy link", icon: Copy },
  "sep",
  {
    id: "delete",
    label: "Delete",
    icon: Trash2,
    hint: "⌫",
    key: "Backspace",
    danger: true,
  },
];

const NOTE_ITEMS: (Item | "sep")[] = [
  { id: "open-tab", label: "Open in new tab", icon: ExternalLink },
  { id: "open-split", label: "Open to the side", icon: PanelRight },
  {
    id: "open-dock",
    label: "Open in floating window",
    icon: PictureInPicture2,
  },
  "sep",
  { id: "rename", label: "Rename", icon: Pencil, hint: "F2", key: "F2" },
  { id: "move", label: "Move to…", icon: FolderInput, hint: "M", key: "m" },
  { id: "duplicate", label: "Duplicate", icon: CopyPlus },
  { id: "copy-link", label: "Copy link", icon: Copy },
  "sep",
  {
    id: "delete",
    label: "Delete",
    icon: Trash2,
    hint: "⌫",
    key: "Backspace",
    danger: true,
  },
];

/** Single-key shortcuts shared by the menu and the focused tree row. */
export function actionForKey(
  kind: "folder" | "note",
  e: { key: string; shiftKey: boolean },
): MenuAction | null {
  const items = (kind === "folder" ? FOLDER_ITEMS : NOTE_ITEMS).filter(
    (i): i is Item => i !== "sep" && !!i.key,
  );
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const hit = items.find(
    (i) =>
      (i.key === key || (key === "Delete" && i.key === "Backspace")) &&
      !!i.shift === e.shiftKey,
  );
  return (hit?.id as MenuAction | undefined) ?? null;
}

function useClampedPosition(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);
  return { ref, pos };
}

export interface ContextMenuProps {
  kind: "folder" | "note";
  title: string;
  x: number;
  y: number;
  color: string | null;
  icon: string | null;
  sortMode: SortMode | null;
  folders: { id: string; path: string; disabled?: boolean }[];
  currentFolderId: string | null;
  /** Open straight at a submenu (M on a tree row → Move to…). */
  initialSub?: "move" | null;
  onAction: (action: MenuAction) => void;
  onStyle: (style: { color?: string | null; icon?: string | null }) => void;
  onSort: (mode: SortMode | null) => void;
  onMoveTo: (folderId: string | null) => void;
  onClose: () => void;
}

export function ExplorerContextMenu(props: ContextMenuProps) {
  const { kind, x, y, onAction, onClose } = props;
  const items = kind === "folder" ? FOLDER_ITEMS : NOTE_ITEMS;
  const flat = items.filter((i): i is Item => i !== "sep");
  const [index, setIndex] = useState(0);
  const [sub, setSub] = useState<"color" | "sort" | "move" | null>(
    props.initialSub ?? null,
  );
  const { ref, pos } = useClampedPosition(x, y);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!sub) itemRefs.current[index]?.focus();
  }, [index, sub]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, ref]);

  const run = (item: Item) => {
    if (item.id === "color" || item.id === "sort") {
      setSub(item.id);
      return;
    }
    if (item.id === "move") {
      setSub("move");
      return;
    }
    onAction(item.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (sub) return; // the submenu handles its own keys
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setIndex((i) => (i + d + flat.length) % flat.length);
      return;
    }
    if (e.key === "ArrowRight" && flat[index]?.submenu) {
      e.preventDefault();
      run(flat[index]);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      run(flat[index]);
      return;
    }
    const action = actionForKey(kind, e);
    if (action) {
      e.preventDefault();
      const item = flat.find((i) => i.id === action);
      if (item) run(item);
    }
  };

  let flatIndex = -1;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${props.title} actions`}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="animate-pop-in fixed z-[70] w-[15.5rem] rounded-xl border border-white/10 bg-panel p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
      style={pos}
    >
      {items.map((item, i) => {
        if (item === "sep")
          return (
            <div
              key={`s${i}`}
              role="separator"
              className="my-1 h-px bg-white/7"
            />
          );
        flatIndex++;
        const fi = flatIndex;
        const Icon = item.icon;
        const open = sub === item.id || (item.id === "move" && sub === "move");
        return (
          <div key={item.id} className="relative">
            <button
              ref={(el) => {
                itemRefs.current[fi] = el;
              }}
              type="button"
              role="menuitem"
              aria-haspopup={
                item.submenu || item.id === "move" ? "menu" : undefined
              }
              aria-expanded={item.submenu ? open : undefined}
              aria-keyshortcuts={item.hint}
              tabIndex={fi === index ? 0 : -1}
              onMouseEnter={() => {
                setIndex(fi);
                if (item.submenu) setSub(item.id as "color" | "sort");
                else if (sub && sub !== "move") setSub(null);
              }}
              onClick={() => run(item)}
              className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] outline-none touch:h-11 ${
                item.danger ? "text-overdue" : "text-ink-200"
              } ${fi === index || open ? "bg-white/7" : ""}`}
            >
              <Icon className="h-4 w-4 flex-none opacity-80" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.submenu ? (
                <ChevronRight className="h-3.5 w-3.5 text-ink-500" />
              ) : item.hint ? (
                <kbd className="font-mono text-[0.72rem] text-ink-500">
                  {item.hint}
                </kbd>
              ) : null}
            </button>
            {open && item.id === "color" && (
              <ColorIconPanel
                color={props.color}
                icon={props.icon}
                onPick={(style) => props.onStyle(style)}
                onBack={() => setSub(null)}
              />
            )}
            {open && item.id === "sort" && (
              <SortPanel
                value={props.sortMode}
                onPick={(m) => {
                  props.onSort(m);
                  onClose();
                }}
                onBack={() => setSub(null)}
              />
            )}
          </div>
        );
      })}
      {sub === "move" && (
        <MoveToPanel
          folders={props.folders}
          currentFolderId={props.currentFolderId}
          onPick={(id) => {
            props.onMoveTo(id);
            onClose();
          }}
          onBack={() => setSub(null)}
        />
      )}
    </div>
  );
}

function SubPanel({
  children,
  onBack,
  label,
  className,
}: {
  children: React.ReactNode;
  onBack: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(
      "input,button:not([disabled])",
    );
    first?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "ArrowLeft") {
          if (
            e.key === "ArrowLeft" &&
            (e.target as HTMLElement).tagName === "INPUT"
          )
            return;
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const btns = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              "button:not([disabled])",
            ) ?? [],
          );
          const at = btns.indexOf(document.activeElement as HTMLElement);
          const next =
            btns[
              (at + (e.key === "ArrowDown" ? 1 : -1) + btns.length) %
                btns.length
            ];
          next?.focus();
          e.preventDefault();
        }
      }}
      className={`animate-pop-in absolute top-0 left-full z-[71] ml-1.5 rounded-xl border border-white/10 bg-panel p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)] ${className ?? "w-[13rem]"}`}
    >
      {children}
    </div>
  );
}

export function ColorIconPanel({
  color,
  icon,
  onPick,
  onBack,
  bare = false,
}: {
  color: string | null;
  icon: string | null;
  onPick: (style: { color?: string | null; icon?: string | null }) => void;
  onBack: () => void;
  /** Render just the grids (inside a phone sheet) instead of a submenu. */
  bare?: boolean;
}) {
  const current = areaColor(color);
  return (
    <ColorIconWrap bare={bare} onBack={onBack}>
      <p className="px-1.5 pt-1 pb-1.5 text-[0.68rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
        Color
      </p>
      <div className="flex flex-wrap gap-1.5 px-1.5 pb-2">
        <button
          type="button"
          aria-label="No color"
          aria-pressed={current === null}
          title="No color"
          onClick={() => onPick({ color: null })}
          className={`h-6 w-6 rounded-full border border-white/20 touch:h-9 touch:w-9 ${
            current === null
              ? "ring-2 ring-sage ring-offset-1 ring-offset-panel"
              : ""
          }`}
        />
        {AREA_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={AREA_LABELS[c]}
            aria-pressed={current === c}
            title={AREA_LABELS[c]}
            onClick={() => onPick({ color: c })}
            className={`h-6 w-6 rounded-full touch:h-9 touch:w-9 ${
              current === c
                ? "ring-2 ring-sage ring-offset-1 ring-offset-panel"
                : ""
            }`}
            style={{ background: `var(--area-${c})` }}
          />
        ))}
      </div>
      <p className="px-1.5 pt-1 pb-1.5 text-[0.68rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
        Icon
      </p>
      <div className="grid grid-cols-6 gap-1 px-1 pb-1">
        {FOLDER_ICON_NAMES.map((name) => {
          const Icon = FOLDER_ICONS[name];
          const on = (icon ?? "folder") === name;
          return (
            <button
              key={name}
              type="button"
              aria-label={`Icon: ${name}`}
              aria-pressed={on}
              title={name}
              onClick={() => onPick({ icon: name === "folder" ? null : name })}
              className={`flex h-8 w-8 items-center justify-center rounded-md touch:h-10 touch:w-10 ${
                on ? "bg-sage/16 text-sage" : "text-ink-300 hover:bg-white/7"
              }`}
              style={
                !on && current ? { color: `var(--area-${current})` } : undefined
              }
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </ColorIconWrap>
  );
}

function ColorIconWrap({
  bare,
  onBack,
  children,
}: {
  bare: boolean;
  onBack: () => void;
  children: React.ReactNode;
}) {
  if (bare) return <div className="flex flex-col">{children}</div>;
  return (
    <SubPanel onBack={onBack} label="Color & icon" className="w-[14.5rem]">
      {children}
    </SubPanel>
  );
}

function SortPanel({
  value,
  onPick,
  onBack,
}: {
  value: SortMode | null;
  onPick: (mode: SortMode | null) => void;
  onBack: () => void;
}) {
  return (
    <SubPanel onBack={onBack} label="Sort this folder">
      <p className="px-2 pt-1 pb-1 text-[0.68rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
        This folder
      </p>
      <MenuCheck
        label="Same as Explorer"
        on={value === null}
        onClick={() => onPick(null)}
      />
      {SORT_MODES.map((m) => (
        <MenuCheck
          key={m}
          label={SORT_LABELS[m]}
          on={value === m}
          onClick={() => onPick(m)}
        />
      ))}
    </SubPanel>
  );
}

function MoveToPanel({
  folders,
  currentFolderId,
  onPick,
  onBack,
}: {
  folders: { id: string; path: string; disabled?: boolean }[];
  currentFolderId: string | null;
  onPick: (folderId: string | null) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? folders.filter((f) => f.path.toLowerCase().includes(s))
      : folders;
  }, [folders, q]);
  return (
    <SubPanel onBack={onBack} label="Move to folder" className="w-[17rem]">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Move to folder…"
        aria-label="Filter folders"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const first = shown.find((f) => !f.disabled);
            if (first) onPick(first.id);
          }
        }}
        className="mb-1 h-8 w-full rounded-md bg-input px-2 text-[0.8125rem] text-ink-100 outline-none placeholder:text-ink-600 focus-visible:outline-1 focus-visible:outline-sage/60"
      />
      <div className="max-h-[16rem] overflow-y-auto">
        <MenuCheck
          label="Top level (no folder)"
          on={currentFolderId === null}
          onClick={() => onPick(null)}
        />
        {shown.map((f) => (
          <MenuCheck
            key={f.id}
            label={f.path}
            on={currentFolderId === f.id}
            disabled={f.disabled}
            onClick={() => onPick(f.id)}
          />
        ))}
      </div>
    </SubPanel>
  );
}

function MenuCheck({
  label,
  on,
  onClick,
  disabled,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[0.8125rem] text-ink-200 outline-none hover:bg-white/7 focus-visible:bg-white/7 disabled:opacity-35 touch:h-11"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {on && <Check className="h-3.5 w-3.5 flex-none text-sage" />}
    </button>
  );
}

/** The Explorer header's Sort/Group menu (§3a). */
export function ExplorerSortMenu({
  sort,
  group,
  onSort,
  onGroup,
  onClose,
  anchor,
}: {
  sort: SortMode;
  group: GroupMode;
  onSort: (m: SortMode) => void;
  onGroup: (g: GroupMode) => void;
  onClose: () => void;
  anchor: DOMRect;
}) {
  const { ref, pos } = useClampedPosition(anchor.left, anchor.bottom + 4);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose, ref]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Sort and group"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const btns = Array.from(
            ref.current?.querySelectorAll<HTMLElement>("button") ?? [],
          );
          const at = btns.indexOf(document.activeElement as HTMLElement);
          btns[
            (at + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length
          ]?.focus();
          e.preventDefault();
        }
      }}
      className="animate-pop-in fixed z-[70] w-[12.5rem] rounded-xl border border-white/10 bg-panel p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
      style={pos}
    >
      <p className="px-2.5 pt-1 pb-1 text-[0.68rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
        Sort
      </p>
      {SORT_MODES.map((m) => (
        <MenuCheck
          key={m}
          label={SORT_LABELS[m]}
          on={sort === m}
          onClick={() => onSort(m)}
        />
      ))}
      <div className="my-1 h-px bg-white/7" />
      <p className="px-2.5 pt-1 pb-1 text-[0.68rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
        Group
      </p>
      <MenuCheck
        label="Folders first"
        on={group === "folders-first"}
        onClick={() => onGroup("folders-first")}
      />
      <MenuCheck
        label="Mixed"
        on={group === "mixed"}
        onClick={() => onGroup("mixed")}
      />
    </div>
  );
}

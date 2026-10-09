"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownUp,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  FolderPlus,
  ListCollapse,
  Search,
  Sun,
  Trash2,
  X,
} from "lucide-react";

import { SidebarIconButton, SidebarSection } from "@/components/layout/sidebar";
import type {
  ExplorerNode,
  FilterResult,
  GroupMode,
  SortMode,
} from "@/lib/explorer-tree";
import type { OutlineItem } from "../NoteSurfaceContext";
import { ExplorerSortMenu } from "./ExplorerMenus";
import { ExplorerTree, type ExplorerTreeProps } from "./ExplorerTree";
import { areaCss, folderIcon } from "./folder-style";

/**
 * Sidebar 1 on Notes (Notes Sidebars design §2b): stacked, collapsible panes
 * like an IDE's sidebar — Open notes, Today (the daily note, pinned),
 * Explorer (the tree), Outline, Recent. While filtering, the panes give way
 * to one Results pane (§3b).
 */

export interface OpenNoteRow {
  id: string;
  title: string;
  path: string;
  pane: number;
  active: boolean;
}

export interface DailyRow {
  id: string;
  title: string;
  dailyDate: string;
}

export function NotesExplorerHeader({
  query,
  onQuery,
  filterOpen,
  onFilterOpen,
  onCollapse,
  inputRef,
}: {
  query: string;
  onQuery: (q: string) => void;
  filterOpen: boolean;
  onFilterOpen: (open: boolean) => void;
  onCollapse: React.ReactNode;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  if (!filterOpen && !query) {
    return (
      <>
        <h2 className="min-w-0 flex-1 truncate pl-2 text-[0.75rem] font-semibold tracking-[0.1em] text-ink-400 uppercase">
          Notes
        </h2>
        <SidebarIconButton
          icon={Search}
          label="Filter notes (⌘P)"
          onClick={() => onFilterOpen(true)}
        />
        {onCollapse}
      </>
    );
  }
  return (
    <>
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-input px-2.5 focus-within:border-sage/50 touch:h-11">
        <Search className="h-3.5 w-3.5 flex-none text-ink-500" />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onQuery("");
              onFilterOpen(false);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              document
                .querySelector<HTMLElement>('[role="tree"] [role="treeitem"]')
                ?.focus();
            }
          }}
          placeholder="Filter notes & folders"
          aria-label="Filter notes and folders"
          className="min-w-0 flex-1 bg-transparent text-[0.875rem] text-ink-100 outline-none placeholder:text-ink-600"
        />
        {(query || filterOpen) && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => {
              onQuery("");
              onFilterOpen(false);
            }}
            className="flex h-5 w-5 flex-none items-center justify-center rounded text-ink-500 hover:text-ink-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </label>
      {onCollapse}
    </>
  );
}

export function NotesExplorer({
  tree,
  query,
  filter,
  hoisted,
  onUnhoist,
  openNotes,
  onOpenNoteRow,
  onCloseOpenNote,
  onCloseAll,
  today,
  onOpenToday,
  outline,
  onOutline,
  recents,
  onOpenRecent,
  dailies,
  activeNoteId,
  sort,
  group,
  onSort,
  onGroup,
  onNewNote,
  onNewFolder,
  onCollapseAll,
}: {
  tree: ExplorerTreeProps;
  query: string;
  filter: FilterResult | null;
  hoisted: {
    id: string;
    title: string;
    color: string | null;
    icon: string | null;
  } | null;
  onUnhoist: () => void;
  openNotes: OpenNoteRow[];
  onOpenNoteRow: (row: OpenNoteRow) => void;
  onCloseOpenNote: (row: OpenNoteRow) => void;
  onCloseAll: () => void;
  today: { label: string; time: string; active: boolean } | null;
  onOpenToday: () => void;
  outline: OutlineItem[];
  onOutline: (item: OutlineItem) => void;
  recents: { id: string; title: string; when: string }[];
  onOpenRecent: (id: string, mods: { meta: boolean; alt: boolean }) => void;
  dailies: DailyRow[];
  activeNoteId: string | null;
  sort: SortMode;
  group: GroupMode;
  onSort: (m: SortMode) => void;
  onGroup: (g: GroupMode) => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onCollapseAll: () => void;
}) {
  const sortBtn = useRef<HTMLButtonElement>(null);
  const [sortAnchor, setSortAnchor] = useState<DOMRect | null>(null);

  if (filter) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-[2.25rem] flex-none items-center gap-2 pl-2.5 pr-2 touch:h-[3.4rem]">
          <ChevronDown className="h-3.5 w-3.5 text-ink-500" />
          <span className="text-[0.75rem] font-semibold tracking-[0.1em] text-ink-400 uppercase">
            Results
          </span>
          <span className="text-[0.75rem] text-ink-600">
            {filter.noteCount} {filter.noteCount === 1 ? "note" : "notes"} ·{" "}
            {filter.folderCount}{" "}
            {filter.folderCount === 1 ? "folder" : "folders"}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filter.nodes.length === 0 ? (
            <p className="px-4 py-3 text-[0.8125rem] text-ink-500">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ExplorerTree {...tree} />
          )}
        </div>
      </div>
    );
  }

  const HoistIcon = hoisted ? folderIcon(hoisted.icon) : null;
  const hoistColor = hoisted ? areaCss(hoisted.color) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarSection
        label="Open notes"
        count={openNotes.length || undefined}
        storageKey="notes.open"
        defaultOpen={false}
        className="border-b border-white/5"
        actions={
          openNotes.length > 0 ? (
            <SidebarIconButton
              icon={X}
              label="Close all notes"
              onClick={onCloseAll}
            />
          ) : undefined
        }
      >
        <div className="max-h-[11rem] overflow-y-auto pb-1">
          {openNotes.length === 0 ? (
            <p className="px-4 pb-2 text-[0.8125rem] text-ink-600">
              No open notes.
            </p>
          ) : (
            openNotes.map((row) => (
              <div
                key={row.id}
                className={`group/open relative flex h-(--row-h) items-center gap-2 pr-1.5 pl-4 [--row-h:2rem] touch:[--row-h:2.75rem] ${
                  row.active ? "bg-sage/13" : "hover:bg-white/4"
                }`}
              >
                {row.active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[2px] bg-sage"
                  />
                )}
                <button
                  type="button"
                  onClick={() => onOpenNoteRow(row)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline"
                >
                  <FileText
                    className={`h-3.5 w-3.5 flex-none ${row.active ? "text-sage" : "text-ink-500"}`}
                  />
                  <span className="truncate text-[0.875rem] text-ink-200">
                    {row.title || "Untitled"}
                  </span>
                  {row.path && (
                    <span className="truncate text-[0.75rem] text-ink-600">
                      {row.path}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${row.title || "Untitled"}`}
                  onClick={() => onCloseOpenNote(row)}
                  className="flex h-6 w-6 flex-none items-center justify-center rounded text-ink-500 opacity-0 group-hover/open:opacity-100 hover:bg-white/8 hover:text-ink-200 focus-visible:opacity-100 touch:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </SidebarSection>

      <SidebarSection
        label="Today"
        storageKey="notes.today"
        className="border-b border-white/5"
      >
        <div className="px-2.5 pb-2.5">
          <button
            type="button"
            onClick={onOpenToday}
            className={`flex h-9 w-full items-center gap-2.5 rounded-lg border px-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-sage/70 touch:h-12 ${
              today?.active
                ? "border-sage/45 bg-sage/14"
                : "border-sage/25 bg-sage/8 hover:bg-sage/12"
            }`}
          >
            <Sun className="h-3.5 w-3.5 flex-none text-sage" />
            <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-ink-100">
              {today?.label ?? "Today"}
            </span>
            <span className="flex-none text-[0.75rem] text-ink-500">
              {today?.time}
            </span>
          </button>
        </div>
      </SidebarSection>

      <SidebarSection
        label="Explorer"
        storageKey="notes.explorer"
        grow
        className="border-b border-white/5"
        actions={
          <>
            <SidebarIconButton
              icon={FilePlus}
              label="New note (N)"
              onClick={onNewNote}
            />
            <SidebarIconButton
              icon={FolderPlus}
              label="New folder (⇧N)"
              onClick={onNewFolder}
            />
            <SidebarIconButton
              ref={sortBtn}
              icon={ArrowDownUp}
              label="Sort and group"
              expanded={!!sortAnchor}
              active={!!sortAnchor}
              onClick={() =>
                setSortAnchor(sortBtn.current?.getBoundingClientRect() ?? null)
              }
            />
            <SidebarIconButton
              icon={ListCollapse}
              label="Collapse all folders"
              onClick={onCollapseAll}
            />
          </>
        }
      >
        {hoisted && (
          <div
            className="sticky top-0 z-30 mx-2 mb-1 flex h-8 items-center gap-2 rounded-md px-2 touch:h-11"
            style={{
              background: hoistColor
                ? `color-mix(in srgb, ${hoistColor} 16%, var(--sidebar))`
                : "color-mix(in srgb, var(--sage) 14%, var(--sidebar))",
            }}
          >
            <button
              type="button"
              aria-label="Leave hoisted folder"
              title="Back"
              onClick={onUnhoist}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-300 hover:bg-white/8 touch:h-9 touch:w-9"
              style={hoistColor ? { color: hoistColor } : undefined}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            {HoistIcon && (
              <HoistIcon
                className="h-3.5 w-3.5 flex-none"
                style={hoistColor ? { color: hoistColor } : undefined}
              />
            )}
            <span
              className="truncate text-[0.8rem] font-semibold tracking-[0.08em] uppercase"
              style={{ color: hoistColor ?? "var(--sage)" }}
            >
              {hoisted.title || "Untitled"}
            </span>
          </div>
        )}
        <div
          className={
            hoisted
              ? "[--sticky-top:2.25rem] touch:[--sticky-top:3rem]"
              : undefined
          }
        >
          <ExplorerTree {...tree} />
        </div>
        {!hoisted && dailies.length > 0 && (
          <DailiesGroup
            dailies={dailies}
            activeNoteId={activeNoteId}
            onOpen={onOpenRecent}
          />
        )}
        {!hoisted && (
          <Link
            href="/app/trash"
            className="mx-2 mt-1 mb-3 flex h-8 items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink-500 hover:bg-white/4 hover:text-ink-200 touch:h-11"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Trash
          </Link>
        )}
      </SidebarSection>

      <SidebarSection
        label="Outline"
        storageKey="notes.outline"
        defaultOpen={false}
        className="border-b border-white/5"
      >
        <div className="max-h-[12rem] overflow-y-auto pb-1.5">
          {outline.length === 0 ? (
            <p className="px-4 pb-2 text-[0.8125rem] text-ink-600">
              Headings in the open note show here.
            </p>
          ) : (
            outline.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onOutline(item)}
                className="flex h-7 w-full items-center gap-2 pr-3 text-left text-[0.84rem] text-ink-300 hover:bg-white/4 hover:text-ink-100 focus-visible:bg-white/6 focus-visible:outline-none touch:h-11"
                style={{
                  paddingLeft: `${0.9 + (Math.min(item.level, 4) - 1) * 0.9}rem`,
                }}
              >
                <span className="font-mono text-ink-600">#</span>
                <span className="truncate">{item.text}</span>
              </button>
            ))
          )}
        </div>
      </SidebarSection>

      <SidebarSection
        label="Recent"
        storageKey="notes.recent"
        defaultOpen={false}
      >
        <div className="max-h-[12rem] overflow-y-auto pb-1.5">
          {recents.length === 0 ? (
            <p className="px-4 pb-2 text-[0.8125rem] text-ink-600">
              Nothing opened yet.
            </p>
          ) : (
            recents.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={(e) =>
                  onOpenRecent(r.id, {
                    meta: e.metaKey || e.ctrlKey,
                    alt: e.altKey,
                  })
                }
                className="flex h-7 w-full items-center gap-2 pr-3 pl-4 text-left hover:bg-white/4 focus-visible:bg-white/6 focus-visible:outline-none touch:h-11"
              >
                <FileText className="h-3.5 w-3.5 flex-none text-ink-500" />
                <span className="min-w-0 flex-1 truncate text-[0.84rem] text-ink-300">
                  {r.title || "Untitled"}
                </span>
                <span
                  suppressHydrationWarning
                  className="flex-none text-[0.72rem] text-ink-600"
                >
                  {r.when}
                </span>
              </button>
            ))
          )}
        </div>
      </SidebarSection>

      {sortAnchor && (
        <ExplorerSortMenu
          anchor={sortAnchor}
          sort={sort}
          group={group}
          onSort={onSort}
          onGroup={onGroup}
          onClose={() => setSortAnchor(null)}
        />
      )}
    </div>
  );
}

/** Every daily note, folded under its own root label at the foot of the tree. */
function DailiesGroup({
  dailies,
  activeNoteId,
  onOpen,
}: {
  dailies: DailyRow[];
  activeNoteId: string | null;
  onOpen: (id: string, mods: { meta: boolean; alt: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="[--row-h:2rem] touch:[--row-h:2.75rem]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-(--row-h) w-full items-center pr-2 pl-[0.85rem] text-left text-ink-400 hover:bg-white/4 focus-visible:bg-white/6 focus-visible:outline-none"
      >
        <span className="flex w-[1.125rem] flex-none">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-ink-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-ink-500" />
          )}
        </span>
        <CalendarDays className="mr-2 h-[0.9375rem] w-[0.9375rem] flex-none text-ink-500" />
        <span className="flex-1 truncate text-[0.8rem] font-semibold tracking-[0.08em] uppercase">
          Daily notes
        </span>
        <span className="font-mono text-[0.72rem] text-ink-600">
          {dailies.length}
        </span>
      </button>
      {open &&
        dailies.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={(e) =>
              onOpen(d.id, { meta: e.metaKey || e.ctrlKey, alt: e.altKey })
            }
            className={`relative flex h-(--row-h) w-full items-center pr-2 pl-[calc(0.85rem+0.923rem+1.125rem)] text-left text-[0.875rem] hover:bg-white/4 focus-visible:bg-white/6 focus-visible:outline-none ${
              d.id === activeNoteId ? "bg-sage/13 text-ink-100" : "text-ink-300"
            }`}
          >
            {d.id === activeNoteId && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[2px] bg-sage"
              />
            )}
            <FileText className="mr-2 h-[0.9375rem] w-[0.9375rem] flex-none text-ink-500" />
            <span className="truncate">{d.title}</span>
          </button>
        ))}
    </div>
  );
}

/** Root-level helper for the shell: the deepest folders' names, "Music / Jazz". */
export function shortPath(titles: string[]): string {
  return titles.slice(-2).join(" / ");
}

export type { ExplorerNode };

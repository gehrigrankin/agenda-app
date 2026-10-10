"use client";

import { useEffect, useRef, useState } from "react";
import {
  Columns2,
  FileText,
  Maximize2,
  Minimize2,
  Plus,
  X,
} from "lucide-react";

import { SidebarIconButton } from "@/components/layout/sidebar";
import type { PanesState } from "@/lib/editor-panes";
import { NoteTabEditor } from "../NoteTabEditor";
import { NOTE_ID_DRAG_TYPE } from "./ExplorerTree";

/**
 * The Notes editor (Notes Sidebars design §2b/§3c): one or two panes side by
 * side, each with its own tab strip; the focused pane's active tab carries the
 * accent underline. Each pane hosts at most one live editor (its active tab).
 *
 * Which editor a pane mounts: the route's server-rendered page (`children`,
 * with logs and backlinks) when the pane's active tab IS the route's note and
 * hasn't been taken over client-side; a client-loaded NoteTabEditor
 * otherwise. See NotesShell for why that split exists.
 */
export function EditorPanes({
  state,
  routeId,
  clientIds,
  children,
  leading,
  onActivate,
  onClose,
  onFocusPane,
  onNewNote,
  onSplit,
  onUnsplit,
  onRatio,
  onTitle,
  onDropNote,
  focusMode,
  onToggleFocus,
  emptyState,
}: {
  state: PanesState;
  routeId: string | null;
  /** Notes that must keep a client editor even when they're the route's. */
  clientIds: ReadonlySet<string>;
  children: React.ReactNode;
  /** Left of the first pane's tabs (the Explorer's reopen toggle). */
  leading?: React.ReactNode;
  onActivate: (pane: number, id: string) => void;
  onClose: (pane: number, id: string) => void;
  onFocusPane: (pane: number) => void;
  onNewNote: (pane: number) => void;
  onSplit: () => void;
  onUnsplit: () => void;
  onRatio: (r: number) => void;
  onTitle: (id: string, title: string) => void;
  onDropNote: (pane: number, noteId: string) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  emptyState: React.ReactNode;
}) {
  const split = state.panes.length > 1;
  const rowRef = useRef<HTMLDivElement>(null);
  const [peekTabs, setPeekTabs] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );

  const showTabs = !focusMode || peekTabs;

  return (
    <div ref={rowRef} className="relative flex min-h-0 min-w-0 flex-1">
      {focusMode && (
        // Hovering the top edge brings the tabs back briefly (§3e).
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-40 h-3"
          onMouseEnter={() => {
            if (peekTimer.current) clearTimeout(peekTimer.current);
            setPeekTabs(true);
          }}
        />
      )}
      {state.panes.map((pane, i) => {
        const focused = i === state.focused;
        const active = pane.active;
        const showChildren =
          active !== null && active === routeId && !clientIds.has(active);
        return (
          <div
            key={i}
            className={`relative flex min-h-0 min-w-0 flex-col bg-canvas ${
              split && i === 1 ? "border-l border-white/7" : ""
            }`}
            style={{
              flex: split
                ? `${i === 0 ? state.ratio : 1 - state.ratio} 1 0%`
                : "1 1 0%",
            }}
            onPointerDownCapture={() => {
              if (!focused) onFocusPane(i);
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(NOTE_ID_DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(NOTE_ID_DRAG_TYPE);
              if (!id) return;
              e.preventDefault();
              onDropNote(i, id);
            }}
          >
            {showTabs && (
              <div
                className={`hidden h-[3.25rem] flex-none items-stretch border-b border-white/7 bg-sidebar md:flex touch:h-[3.75rem] ${
                  focusMode
                    ? "animate-pop-in absolute inset-x-0 top-0 z-40 shadow-lg"
                    : ""
                }`}
                onMouseLeave={() => {
                  if (!focusMode) return;
                  peekTimer.current = setTimeout(() => setPeekTabs(false), 900);
                }}
                onMouseEnter={() => {
                  if (peekTimer.current) clearTimeout(peekTimer.current);
                }}
              >
                {i === 0 && leading && (
                  <div className="flex flex-none items-center pl-1.5">
                    {leading}
                  </div>
                )}
                <div
                  role="tablist"
                  aria-label={split ? `Pane ${i + 1} tabs` : "Open notes"}
                  className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]"
                >
                  {pane.tabs.map((t) => {
                    const isActive = t.id === active;
                    return (
                      <div
                        key={t.id}
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        title={t.title || "Untitled"}
                        onClick={() => onActivate(i, t.id)}
                        onAuxClick={(e) => {
                          if (e.button === 1) onClose(i, t.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            onActivate(i, t.id);
                          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                            const at = pane.tabs.findIndex(
                              (x) => x.id === t.id,
                            );
                            const next =
                              pane.tabs[at + (e.key === "ArrowRight" ? 1 : -1)];
                            if (next) {
                              onActivate(i, next.id);
                              requestAnimationFrame(() =>
                                (
                                  e.currentTarget.parentElement?.querySelector(
                                    '[aria-selected="true"]',
                                  ) as HTMLElement | null
                                )?.focus(),
                              );
                            }
                          }
                        }}
                        className={`group/tab relative flex max-w-[14rem] min-w-[6rem] flex-none cursor-default items-center gap-2 border-r border-white/6 pr-1.5 pl-3.5 text-[0.84rem] outline-none focus-visible:bg-white/6 ${
                          isActive
                            ? "bg-canvas text-ink-100"
                            : "text-ink-400 hover:bg-white/3 hover:text-ink-200"
                        }`}
                      >
                        {isActive && (
                          <span
                            aria-hidden
                            className={`absolute inset-x-0 top-0 h-[2px] ${
                              focused ? "bg-sage" : "bg-ink-600"
                            }`}
                          />
                        )}
                        <FileText
                          className={`h-3.5 w-3.5 flex-none ${
                            isActive && focused ? "text-sage" : "text-ink-500"
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {t.title || "Untitled"}
                        </span>
                        <button
                          type="button"
                          aria-label={`Close ${t.title || "Untitled"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose(i, t.id);
                          }}
                          className={`flex h-6 w-6 flex-none items-center justify-center rounded text-ink-500 hover:bg-white/8 hover:text-ink-100 focus-visible:opacity-100 touch:h-9 touch:w-9 touch:opacity-100 ${
                            isActive
                              ? "opacity-100"
                              : "opacity-0 group-hover/tab:opacity-100"
                          }`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    aria-label="New note in a tab"
                    title="New note"
                    onClick={() => onNewNote(i)}
                    className="flex w-10 flex-none items-center justify-center text-ink-500 hover:text-ink-200 focus-visible:bg-white/6 focus-visible:outline-none touch:w-12"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-none items-center gap-0.5 px-2">
                  <SidebarIconButton
                    icon={Columns2}
                    label={split ? "Close split" : "Split editor"}
                    pressed={split}
                    onClick={split ? onUnsplit : onSplit}
                  />
                  {i === state.panes.length - 1 && (
                    <SidebarIconButton
                      icon={focusMode ? Minimize2 : Maximize2}
                      label={
                        focusMode ? "Exit focus mode (Esc)" : "Focus mode (⌘⇧F)"
                      }
                      pressed={focusMode}
                      onClick={onToggleFocus}
                    />
                  )}
                </div>
              </div>
            )}
            <div className="relative min-h-0 flex-1">
              {active === null ? (
                emptyState
              ) : showChildren ? (
                children
              ) : (
                <NoteTabEditor
                  key={active}
                  noteId={active}
                  onTitle={(title) => onTitle(active, title)}
                  onCloseTab={() => onClose(i, active)}
                />
              )}
            </div>
          </div>
        );
      })}
      {split && !focusMode && (
        <PaneDivider
          ratio={state.ratio}
          containerRef={rowRef}
          onRatio={onRatio}
        />
      )}
    </div>
  );
}

function PaneDivider({
  ratio,
  containerRef,
  onRatio,
}: {
  ratio: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onRatio: (r: number) => void;
}) {
  const dragging = useRef(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onRatio(ratio - 0.05);
        else if (e.key === "ArrowRight") onRatio(ratio + 0.05);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const box = containerRef.current?.getBoundingClientRect();
        if (box) onRatio((e.clientX - box.left) / box.width);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onDoubleClick={() => onRatio(0.5)}
      className="group absolute inset-y-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none"
      style={{ left: `${ratio * 100}%` }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-sage/50 group-focus-visible:bg-sage" />
      <span className="absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 touch:h-12 touch:w-1.5" />
    </div>
  );
}

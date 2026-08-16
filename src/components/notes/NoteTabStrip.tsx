"use client";

import { useEffect, useRef } from "react";
import { FileText, Plus, X } from "lucide-react";

/**
 * The IDE-style tab strip, shared by the floating note dock and the main note
 * view so the two read as one idea rather than two lookalikes.
 *
 * Purely presentational: the open set, which tab is focused, and what closing
 * one does all belong to whoever owns the tabs. The only behaviour that lives
 * here is scrolling the focused tab into view, because that's a fact about
 * this strip's own overflow, not about the caller's state.
 *
 * `activeSurface` is the colour of the pane the strip is joined to — the tab
 * has to match it to read as an edge of that pane rather than a pill on top
 * of it (the dock's window body, the note view's page canvas).
 */

export interface NoteTabItem {
  id: string;
  /** Live title; "" renders as "Untitled" (a tab may load before its note). */
  title: string;
}

export function NoteTabStrip({
  tabs,
  activeId,
  onActivate,
  onClose,
  onNew,
  newDisabled = false,
  newLabel = "New note tab",
  newTitle = "New note in a tab",
  activeSurface = "bg-card",
}: {
  tabs: NoteTabItem[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  newDisabled?: boolean;
  newLabel?: string;
  newTitle?: string;
  activeSurface?: string;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Keep the focused tab in view when it's opened from off-screen (a note
  // linked from the far end of a long strip).
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div
      ref={stripRef}
      role="tablist"
      className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto"
    >
      {tabs.map((t) => {
        const isActive = t.id === activeId;
        return (
          <div
            key={t.id}
            data-active={isActive ? "true" : undefined}
            onClick={() => onActivate(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate(t.id);
              }
            }}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            title={t.title || "Untitled"}
            // Barely rounded: a tab is a folder edge, and a big radius makes
            // it read as a floating pill rather than something joined to the
            // pane below it.
            className={`group flex max-w-[11rem] flex-none cursor-pointer items-center gap-1.5 rounded-t-[0.25rem] py-1.5 pl-2 pr-1 text-[0.75rem] ${
              isActive
                ? `${activeSurface} text-ink-100 shadow-[inset_0_2px_0_rgba(156,197,172,0.7)]`
                : "text-ink-500 hover:bg-white/5 hover:text-ink-300"
            }`}
          >
            <FileText
              className={`h-3 w-3 flex-none ${isActive ? "text-steel" : "text-ink-600"}`}
            />
            <span className="min-w-0 flex-1 truncate">
              {t.title || "Untitled"}
            </span>
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Close ${t.title || "Untitled"}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              className={`flex h-4 w-4 flex-none items-center justify-center rounded hover:bg-white/10 ${
                isActive ? "" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <X className="h-2.5 w-2.5" />
            </span>
          </div>
        );
      })}

      {/* New tab, where a code editor keeps it: after the last one. */}
      <button
        type="button"
        aria-label={newLabel}
        title={newTitle}
        disabled={newDisabled}
        onClick={onNew}
        className="mb-[0.1875rem] ml-0.5 flex h-5 w-5 flex-none items-center justify-center rounded text-ink-600 hover:bg-white/6 hover:text-ink-200 disabled:opacity-50"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

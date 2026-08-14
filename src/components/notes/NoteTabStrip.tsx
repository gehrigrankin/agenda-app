"use client";

import { useEffect, useRef } from "react";
import { FileText, Plus, X } from "lucide-react";

/**
 * IDE-style tab row — one tab per open note, plus a trailing "new tab"
 * button. Shared between the floating note dock and the main note view so
 * both get exactly the same look and interaction (active-tab highlight,
 * close-on-hover, auto-scroll to a newly focused tab); extracted from the
 * dock, which had it first.
 *
 * `activeBackgroundClassName` exists because the two hosts sit on different
 * backgrounds — the dock is a floating panel with its own dark fill, the main
 * view sits directly on the app canvas — and the active tab is meant to blend
 * into whichever pane is beneath it, like a folder tab joined to its page.
 */
export interface TabStripNote {
  id: string;
  title: string;
}

export function NoteTabStrip({
  notes,
  activeId,
  onActivate,
  onClose,
  onNewTab,
  newTabDisabled,
  activeBackgroundClassName = "bg-[#1B1E21]",
}: {
  notes: TabStripNote[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  newTabDisabled?: boolean;
  activeBackgroundClassName?: string;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Keep the focused tab in view when it's opened from off-screen (a note
  // linked from the far end of a long strip).
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div
      ref={stripRef}
      className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto"
    >
      {notes.map((n) => {
        const isActive = n.id === activeId;
        return (
          <div
            key={n.id}
            data-active={isActive ? "true" : undefined}
            onClick={() => onActivate(n.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate(n.id);
              }
            }}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            title={n.title || "Untitled"}
            // Barely rounded: a tab is a folder edge, and a big radius makes
            // it read as a floating pill rather than something joined to the
            // pane below it.
            className={`group flex max-w-[11rem] flex-none cursor-pointer items-center gap-1.5 rounded-t-[0.25rem] py-1.5 pl-2 pr-1 text-[0.75rem] ${
              isActive
                ? `${activeBackgroundClassName} text-ink-100 shadow-[inset_0_2px_0_rgba(156,197,172,0.7)]`
                : "text-ink-500 hover:bg-white/5 hover:text-ink-300"
            }`}
          >
            <FileText
              className={`h-3 w-3 flex-none ${isActive ? "text-steel" : "text-ink-600"}`}
            />
            <span className="min-w-0 flex-1 truncate">
              {n.title || "Untitled"}
            </span>
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Close ${n.title || "Untitled"}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(n.id);
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
        aria-label="New note tab"
        title="New note in a tab"
        disabled={newTabDisabled}
        onClick={onNewTab}
        className="mb-[0.1875rem] ml-0.5 flex h-5 w-5 flex-none items-center justify-center rounded text-ink-600 hover:bg-white/6 hover:text-ink-200 disabled:opacity-50"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

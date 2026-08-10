"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { $getRoot } from "lexical";
import { PictureInPicture2 } from "lucide-react";

import { useNoteDock } from "@/components/notes/NoteDockProvider";
import { QuickViewContext } from "@/components/notes/NotePreviewProvider";

import { $isLogHeadingNode } from "../nodes/LogHeadingNode";

/**
 * The "↳ logs to X" marker on a `[[+` heading, as a real button.
 *
 * The marker used to be a CSS ::after on the heading, which meant the one
 * thing you want to do with it — go look at the note you're logging into —
 * wasn't clickable. It can't become a node either: the heading holds real
 * editable text, and a decorator child would take that text away from the
 * editor (see LogHeadingNode).
 *
 * So it follows CollapsePlugin's gutter-chevron model: buttons portaled into
 * the editor's scroll container (position: relative) and positioned in CONTENT
 * coordinates, so they scroll with the heading for free. Position is measured
 * from a Range over the heading's contents rather than its box — the marker
 * belongs right after the text you typed, wherever that line ends.
 *
 * Clicking opens the target in a floating dock window, which is the point:
 * you can read what you've logged onto a note without leaving the note you're
 * writing in. Outside the app shell (no dock) it falls back to navigation.
 */

type Marker = {
  key: string;
  noteId: string;
  title: string;
  collapsed: boolean;
  top: number;
  left: number;
};

/** Chip height in px, used only to center it on the heading's last line. */
const CHIP_HEIGHT = 16;

function markersEqual(a: Marker[], b: Marker[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const n = b[i];
    return (
      m.key === n.key &&
      m.noteId === n.noteId &&
      m.title === n.title &&
      m.collapsed === n.collapsed &&
      m.top === n.top &&
      m.left === n.left
    );
  });
}

/**
 * Where the heading's text ends, in the scroll container's content
 * coordinates. An empty heading has no text rects at all, so fall back to the
 * start of its content box — never its right edge, which would fling the chip
 * across a full-width block.
 */
function anchorOf(
  el: HTMLElement,
  container: HTMLElement,
  containerRect: DOMRect,
): { top: number; left: number } {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  const last = rects.length > 0 ? rects[rects.length - 1] : null;

  let top: number;
  let right: number;
  let height: number;
  if (last) {
    top = last.top;
    right = last.right;
    height = last.height;
  } else {
    const box = el.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    top = box.top;
    right = box.left + padding;
    height = box.height;
  }

  const nudge = Math.max(0, (height - CHIP_HEIGHT) / 2);
  return {
    top: top - containerRect.top + container.scrollTop + nudge,
    left: right - containerRect.left + container.scrollLeft + 8,
  };
}

export function LogLinkPlugin() {
  const [editor] = useLexicalComposerContext();
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const router = useRouter();
  // The dock lives at the app-shell level, so it's reachable from any editor
  // surface; QuickViewContext is the same door from inside a dock window.
  const dock = useNoteDock();
  const quickView = useContext(QuickViewContext);

  const sync = useCallback(() => {
    const rootEl = editor.getRootElement();
    const container = rootEl?.parentElement ?? null;
    if (!rootEl || !container) {
      setMarkers([]);
      return;
    }

    const next: Marker[] = [];
    editor.getEditorState().read(() => {
      const containerRect = container.getBoundingClientRect();
      // Only top-level headings log (the same restriction collectLogSections
      // applies), so only those get a marker.
      for (const block of $getRoot().getChildren()) {
        if (!$isLogHeadingNode(block)) continue;
        const el = editor.getElementByKey(block.getKey());
        // offsetParent === null: inside a collapsed section, so display: none.
        if (!el || el.offsetParent === null) continue;
        next.push({
          key: block.getKey(),
          noteId: block.getNoteId(),
          title: block.getTitle(),
          collapsed: block.getCollapsed(),
          ...anchorOf(el, container, containerRect),
        });
      }
    });

    setMarkers((prev) => (markersEqual(prev, next) ? prev : next));
  }, [editor]);

  useEffect(
    () =>
      mergeRegister(
        editor.registerRootListener((rootEl) => {
          setPortalEl(rootEl?.parentElement ?? null);
        }),
        editor.registerUpdateListener(() => sync()),
      ),
    [editor, sync],
  );

  // Initial pass + reflow tracking: the marker rides the end of a line, so any
  // rewrap (container resize, font/density change) moves it.
  useEffect(() => {
    sync();
    if (!portalEl) return;
    const observer = new ResizeObserver(() => sync());
    observer.observe(portalEl);
    const rootEl = editor.getRootElement();
    if (rootEl) observer.observe(rootEl);
    return () => observer.disconnect();
  }, [editor, portalEl, sync]);

  const open = useCallback(
    (noteId: string, title: string) => {
      if (!noteId) return;
      if (dock) dock.open(noteId, title);
      else if (quickView) quickView.open(noteId);
      else router.push(`/app/notes/${noteId}`);
    },
    [dock, quickView, router],
  );

  if (!portalEl) return null;
  return createPortal(
    <>
      {markers.map((m) => (
        <button
          key={m.key}
          type="button"
          contentEditable={false}
          title={`Open ${m.title || "the note"} in a window`}
          // preventDefault keeps the editor's selection untouched by the click.
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            open(m.noteId, m.title);
          }}
          className="editor-log-link"
          style={{ top: m.top, left: m.left }}
        >
          {/* Collapsed headings show the fold's "…" cue in the chip: the
              heading's own ::after is suppressed for log headings so the two
              cues can't stack. */}
          <span className="truncate">
            {m.collapsed ? "… ↳ " : "↳ logs to "}
            {m.title || "note"}
          </span>
          <PictureInPicture2 className="h-2.5 w-2.5 flex-none" />
        </button>
      ))}
    </>,
    portalEl,
  );
}

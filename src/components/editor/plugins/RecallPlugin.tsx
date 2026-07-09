"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
} from "lexical";
import { CornerUpLeft, History, Link as LinkIcon } from "lucide-react";

import { recallAction } from "@/app/app/ai/actions";
import { QuickViewContext } from "@/components/notes/NotePreviewProvider";
import { $createNoteLinkNode } from "../nodes/NoteLinkNode";
import { NoteTaskContext } from "../nodes/TaskNode";

/**
 * Ambient recall (design 13b), daily editor only: while the user writes,
 * margin cards quietly surface related past notes, anchored to the paragraph
 * being typed. Fires at most one cheap server roundtrip per typing pause
 * (~1.4s after the last content change); any further edit fades the cards out
 * immediately. Cards never steal focus and never insert anything themselves —
 * the ⤺ button is the only mutation, appending an inline note-link to the end
 * of the anchor block.
 */

type RecallCard = Awaited<ReturnType<typeof recallAction>>[number];

const PAUSE_MS = 1400;
const MIN_PARAGRAPH_CHARS = 20;
const LEAVE_MS = 160;
const CARD_WIDTH_PX = 248; // w-[15.5rem]
const GAP_PX = 16;
const EDGE_MARGIN_PX = 8;
// Room needed between the content column and the PANEL edge for a card to fit
// inside the daily-note surface. Below this, skip recall entirely — cards must
// never spill over the panel border onto neighboring widgets.
const MIN_RIGHT_SPACE_PX = CARD_WIDTH_PX + GAP_PX + EDGE_MARGIN_PX;

/**
 * The rect the cards must stay inside: the editor's nearest clipping ancestor
 * (its scroll container, which sits inside the widget panel). Falls back to
 * the viewport when nothing clips.
 */
function boundsRectFor(rootElement: HTMLElement): DOMRect {
  let node = rootElement.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if (style.overflowY !== "visible" || style.overflowX !== "visible") {
      return node.getBoundingClientRect();
    }
    node = node.parentElement;
  }
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/** Space between the content column's right edge and the panel's right edge. */
function rightSpace(rootElement: HTMLElement): number {
  const bounds = boundsRectFor(rootElement);
  const right = Math.min(bounds.right, window.innerWidth);
  return right - rootElement.getBoundingClientRect().right;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-05-12" → "May 12" (falls back to the raw label). */
function formatDateLabel(label: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!m) return label;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : label;
}

interface RecallView {
  cards: RecallCard[];
  /** Node key of the top-level block that triggered the query. */
  blockKey: string;
}

export function RecallPlugin() {
  const [editor] = useLexicalComposerContext();
  const noteCtx = useContext(NoteTaskContext);
  const quickView = useContext(QuickViewContext);
  const router = useRouter();

  const [view, setView] = useState<RecallView | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // false while fading in/out; the container transitions opacity on it.
  const [shown, setShown] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<RecallView | null>(null);
  viewRef.current = view;
  const noteIdRef = useRef<string | null>(noteCtx?.noteId ?? null);
  noteIdRef.current = noteCtx?.noteId ?? null;

  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last paragraph text we queried for — a pause over unchanged text is free.
  const lastQueriedRef = useRef<string | null>(null);
  // Monotonic id so a slow response can't surface stale cards.
  const requestIdRef = useRef(0);

  /** Fade the cards out and unmount; instantly no-ops when nothing is shown. */
  const clearCards = useCallback(() => {
    requestIdRef.current += 1;
    if (!viewRef.current) return;
    setShown(false);
    if (leaveTimerRef.current === null) {
      leaveTimerRef.current = setTimeout(() => {
        leaveTimerRef.current = null;
        setView(null);
        setPos(null);
      }, LEAVE_MS);
    }
  }, []);

  const runQuery = useCallback(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;
    // No room inside the panel for a card — skip the roundtrip entirely.
    if (rightSpace(rootElement) < MIN_RIGHT_SPACE_PX) return;

    let paragraph: string | null = null;
    let blockKey: string | null = null;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const anchorNode = selection.anchor.getNode();
      let block;
      try {
        block = anchorNode.getTopLevelElementOrThrow();
      } catch {
        return; // anchor at root — nothing to anchor to
      }
      const text = block.getTextContent().trim();
      if (text.length < MIN_PARAGRAPH_CHARS) return;
      paragraph = text;
      blockKey = block.getKey();
    });
    if (paragraph === null || blockKey === null) return;
    if (paragraph === lastQueriedRef.current) return;
    lastQueriedRef.current = paragraph;

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const anchorKey = blockKey;
    recallAction(paragraph, noteIdRef.current)
      .then((cards) => {
        if (requestIdRef.current !== requestId) return; // user typed again
        if (cards.length === 0) return;
        if (leaveTimerRef.current !== null) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
        setView({ cards, blockKey: anchorKey });
      })
      .catch(() => {
        // Best-effort ambience: a dropped request (dev HMR, tab switch, flaky
        // network) must stay invisible — console.error here would pop the
        // Next dev overlay over a feature the user never asked to run.
      });
  }, [editor]);

  // Content changes: fade any cards out immediately and (re)arm the pause
  // timer — the query fires 1.4s after the LAST change.
  useEffect(() => {
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      clearCards();
      if (pauseTimerRef.current !== null) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => {
        pauseTimerRef.current = null;
        runQuery();
      }, PAUSE_MS);
    });
  }, [editor, clearCards, runQuery]);

  useEffect(
    () => () => {
      if (pauseTimerRef.current !== null) clearTimeout(pauseTimerRef.current);
      if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    },
    [],
  );

  // Position to the RIGHT of the editor content column, top-aligned with the
  // anchor block. Re-runs on scroll (capture, for the editor's inner scroll
  // container) and resize while visible.
  const reposition = useCallback(() => {
    const current = viewRef.current;
    if (!current) return;
    const rootElement = editor.getRootElement();
    const blockEl = editor.getElementByKey(current.blockKey);
    if (!rootElement || !blockEl) {
      setPos(null);
      return;
    }
    const rootRect = rootElement.getBoundingClientRect();
    if (rightSpace(rootElement) < MIN_RIGHT_SPACE_PX) {
      setPos(null); // no room inside the panel — don't render at all
      return;
    }
    // Fits inside the panel by construction; still clamp to the viewport as a
    // belt-and-suspenders (transformed ancestors, odd zoom states).
    const left = Math.min(
      rootRect.right + GAP_PX,
      window.innerWidth - CARD_WIDTH_PX - EDGE_MARGIN_PX,
    );
    // Vertical containment: top-align with the anchor block, but never let the
    // card stack cross the panel's bottom (or top) edge — anchored blocks near
    // the bottom would otherwise spill the cards over neighboring widgets.
    const bounds = boundsRectFor(rootElement);
    const blockRect = blockEl.getBoundingClientRect();
    if (blockRect.top > bounds.bottom || blockRect.bottom < bounds.top) {
      setPos(null); // anchor scrolled out of the panel
      return;
    }
    const stackHeight = containerRef.current?.offsetHeight ?? 220;
    const maxTop =
      Math.min(bounds.bottom, window.innerHeight) - stackHeight - EDGE_MARGIN_PX;
    const minTop = Math.max(bounds.top, 0) + EDGE_MARGIN_PX;
    const top = Math.max(Math.min(blockRect.top, maxTop), minTop);
    setPos({ top, left });
  }, [editor]);

  useEffect(() => {
    if (!view) return;
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [view, reposition]);

  // Gentle fade-in once mounted and positioned. The extra reposition runs
  // after the stack is actually in the DOM, so the bottom clamp uses the
  // measured height instead of the pre-render estimate.
  useEffect(() => {
    if (!view) return;
    const raf = requestAnimationFrame(() => {
      reposition();
      setShown(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [view, reposition]);

  // Clicking anywhere outside the cards, or focus leaving the editor for
  // anything but the cards, dismisses them.
  useEffect(() => {
    if (!view) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      clearCards();
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && containerRef.current?.contains(next)) return;
      clearCards();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    const rootElement = editor.getRootElement();
    rootElement?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      rootElement?.removeEventListener("focusout", onFocusOut);
    };
  }, [view, editor, clearCards]);

  const openNote = useCallback(
    (noteId: string) => {
      if (quickView) quickView.open(noteId);
      else router.push(`/app/notes/${noteId}`);
      clearCards();
    },
    [quickView, router, clearCards],
  );

  /** ⤺ — append an inline note-link (+ trailing space) to the anchor block. */
  const linkInline = useCallback(
    (card: RecallCard) => {
      const current = viewRef.current;
      if (!current) return;
      editor.update(() => {
        const block = $getNodeByKey(current.blockKey);
        if (!block || !$isElementNode(block)) return;
        const linkNode = $createNoteLinkNode({
          noteId: card.noteId,
          title: card.title || "Untitled",
        });
        block.append(linkNode, $createTextNode(" "));
      });
      // The update listener fades the cards; drop them for good right away.
      clearCards();
    },
    [editor, clearCards],
  );

  if (typeof document === "undefined" || !view || !pos) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="pointer-events-none fixed z-40 flex w-[15.5rem] flex-col gap-2 transition-opacity duration-300"
      style={{ top: pos.top, left: pos.left, opacity: shown ? 1 : 0 }}
    >
      {view.cards.map((card) => {
        const decision = card.kind === "decision";
        const HeaderIcon = decision ? History : LinkIcon;
        return (
          <div
            key={card.noteId}
            role="button"
            tabIndex={-1}
            onClick={() => openNote(card.noteId)}
            onMouseDown={(e) => e.preventDefault()} // never steal focus
            className={
              decision
                ? "pointer-events-auto cursor-pointer rounded-[10px] border border-steel/25 bg-steel/5 px-3 py-2.5 transition-colors hover:border-steel/50"
                : "pointer-events-auto cursor-pointer rounded-[10px] border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 opacity-75 transition-[opacity,border-color] hover:border-steel/35 hover:opacity-100"
            }
          >
            <div className="mb-[5px] flex items-center gap-1.5">
              <HeaderIcon
                className={`h-[11px] w-[11px] shrink-0 ${decision ? "text-steel" : "text-ink-400"}`}
              />
              <span
                className={`text-[10px] font-medium leading-none ${decision ? "text-steel" : "text-ink-400"}`}
              >
                {decision ? "you decided this once" : "related"}
              </span>
              <button
                type="button"
                aria-label="Link the note inline"
                title="Link the note inline"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  linkInline(card);
                }}
                className="ml-auto shrink-0 text-ink-600 hover:text-ink-300"
              >
                <CornerUpLeft className="h-[11px] w-[11px]" />
              </button>
            </div>
            <p className="text-[11.5px] font-medium leading-[1.35] text-ink-200">
              {card.title || "Untitled"}
            </p>
            <p className="mt-[3px] text-[10.5px] leading-normal text-ink-500">
              {card.dateLabel ? `${formatDateLabel(card.dateLabel)} — ` : ""}
              {card.snippet}
            </p>
          </div>
        );
      })}
      <span className="px-1 text-[9.5px] leading-normal text-ink-700">
        appears only while you pause · never inserts anything itself
      </span>
    </div>,
    document.body,
  );
}

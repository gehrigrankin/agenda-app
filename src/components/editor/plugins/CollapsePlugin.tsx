"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $isHeadingNode, type HeadingTagType } from "@lexical/rich-text";
import { mergeRegister } from "@lexical/utils";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  type LexicalNode,
} from "lexical";
import { ChevronDown } from "lucide-react";

import {
  $isCollapsibleHeadingNode,
  CollapsibleHeadingNode,
} from "../nodes/CollapsibleHeadingNode";
import {
  $isCollapsibleListItemNode,
  CollapsibleListItemNode,
} from "../nodes/CollapsibleListItemNode";

/**
 * Folding for headings and nested bullets, in every editor surface.
 *
 * Three responsibilities, all re-run after every editor update:
 *
 * 1. SECTION HIDING (headings). Collapsed state lives on the node (persisted
 *    in the note JSON), but a heading's "section" — the following top-level
 *    blocks up to the next heading of the same or higher level — can't be
 *    reached by CSS from the heading element. So this plugin walks the root's
 *    children and stamps `data-section-hidden` on covered blocks;
 *    `.editor-content > [data-section-hidden]` hides them. The reconciler
 *    can recreate any block's element at any time, which is why the stamps
 *    are reapplied on every update. (Bullet folding needs no JS pass: the
 *    sublist wrapper <li> always immediately follows its row, so a CSS
 *    sibling selector on the row's `data-collapsed` handles it.)
 *
 * 2. GUTTER CHEVRONS. Real <button>s in an overlay portaled into the editor's
 *    scroll container (which is `position: relative`), positioned with
 *    offsetTop/offsetLeft so they scroll with the content for free — the
 *    TimestampPlugin gutter model, upgraded to clickable elements. Injecting
 *    buttons into Lexical's own element DOM would confuse the reconciler's
 *    child bookkeeping, hence the overlay. Chevrons render for every heading
 *    and every list row that actually has a sublist.
 *
 * 3. CARET SAFETY. Nothing may type into hidden content: if an update lands
 *    the selection inside a hidden region (Enter at the end of a collapsed
 *    heading, programmatic selection moves), the covering fold auto-expands.
 *    Symmetrically, collapsing a region the caret is inside moves the caret
 *    to the fold's row first. Chevron mousedown is prevented so a click
 *    doesn't disturb the selection at all.
 *
 * Hotkeys: Mod+. folds/unfolds the heading or bullet row the caret is on;
 * Mod+/ toggles every fold in the document — collapse all if any target is
 * expanded, otherwise expand all. Double-clicking a row's text is the mouse
 * equivalent of Mod+. (rides on the browser's word-select, see below).
 */

type Chevron = {
  key: string;
  top: number;
  left: number;
  collapsed: boolean;
};

function levelOf(tag: HeadingTagType): number {
  return Number(tag.slice(1)) || 6;
}

const CHEVRON_SIZE = 16;

/**
 * Position in the scroll container's CONTENT coordinates, from client rects —
 * not offsetTop/offsetLeft, which break whenever a positioned ancestor sits
 * between the block and the container (e.g. checklist wrapper <li>s are
 * position:relative for their checkbox pseudo-elements).
 */
function chevronFor(
  el: HTMLElement,
  container: HTMLElement,
  containerRect: DOMRect,
  key: string,
  collapsed: boolean,
  kind: "heading" | "item",
): Chevron {
  // Center on the first line; bullets sit further out so the chevron clears
  // the list marker.
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
  const nudge = Number.isFinite(lineHeight)
    ? Math.max(0, (lineHeight - CHEVRON_SIZE) / 2)
    : 2;
  const rect = el.getBoundingClientRect();
  return {
    key,
    top: rect.top - containerRect.top + container.scrollTop + nudge,
    left: Math.max(
      0,
      rect.left -
        containerRect.left +
        container.scrollLeft -
        (kind === "item" ? 36 : 26),
    ),
    collapsed,
  };
}

function chevronsEqual(a: Chevron[], b: Chevron[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((c, i) => {
    const d = b[i];
    return (
      c.key === d.key &&
      c.top === d.top &&
      c.left === d.left &&
      c.collapsed === d.collapsed
    );
  });
}

/** Is `next` the <li> wrapper holding `item`'s nested sublist? */
function $isSublistWrapper(next: LexicalNode | null): boolean {
  return $isListItemNode(next) && $isListNode(next.getFirstChild());
}

/**
 * The fold a gesture at `node` addresses: the nearest enclosing heading, or
 * the nearest list ROW — but a row only counts when it actually has a sublist
 * to fold. Rows stop the walk either way so a gesture on a childless nested
 * bullet never collapses its parent by surprise.
 */
function $collapsibleKeyFor(node: LexicalNode | null): string | null {
  for (let n = node; n; n = n.getParent()) {
    if ($isCollapsibleHeadingNode(n)) return n.getKey();
    if ($isCollapsibleListItemNode(n) && !$isListNode(n.getFirstChild())) {
      return $isSublistWrapper(n.getNextSibling()) ? n.getKey() : null;
    }
  }
  return null;
}

/** Mod+. — fold/unfold the heading or bullet row the caret is on. */
function isCollapseHotkey(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === "Period";
}

/** Mod+/ — collapse every fold in the document, or expand all. */
function isCollapseAllHotkey(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === "Slash";
}

export function CollapsePlugin() {
  const [editor] = useLexicalComposerContext();
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [chevrons, setChevrons] = useState<Chevron[]>([]);

  const sync = useCallback(() => {
    const rootEl = editor.getRootElement();
    const container = rootEl?.parentElement ?? null;
    if (!rootEl || !container) {
      setChevrons([]);
      return;
    }

    const next: Chevron[] = [];
    // Folds covering the current selection; expanded right after the read.
    const reveal = new Set<string>();

    editor.getEditorState().read(() => {
      // --- 1. Section hiding + map of block → covering collapsed heading.
      const hiderOf = new Map<string, string>();
      let hider: CollapsibleHeadingNode | null = null;
      for (const block of $getRoot().getChildren()) {
        if (
          hider &&
          $isHeadingNode(block) &&
          levelOf(block.getTag()) <= levelOf(hider.getTag())
        ) {
          hider = null;
        }
        const el = editor.getElementByKey(block.getKey());
        if (hider) {
          el?.setAttribute("data-section-hidden", "1");
          hiderOf.set(block.getKey(), hider.getKey());
        } else {
          el?.removeAttribute("data-section-hidden");
        }
        if (!hider && $isCollapsibleHeadingNode(block) && block.getCollapsed()) {
          hider = block;
        }
      }

      // --- 2. Chevron targets (skip anything currently display:none).
      const containerRect = container.getBoundingClientRect();
      for (const block of $getRoot().getChildren()) {
        if (!$isCollapsibleHeadingNode(block)) continue;
        const el = editor.getElementByKey(block.getKey());
        if (!el || el.offsetParent === null) continue;
        next.push(
          chevronFor(
            el,
            container,
            containerRect,
            block.getKey(),
            block.getCollapsed(),
            "heading",
          ),
        );
      }
      for (const item of $nodesOfType(CollapsibleListItemNode)) {
        if (!item.isAttached() || !$isSublistWrapper(item.getNextSibling())) {
          continue;
        }
        const el = editor.getElementByKey(item.getKey());
        if (!el || el.offsetParent === null) continue;
        next.push(
          chevronFor(
            el,
            container,
            containerRect,
            item.getKey(),
            item.getCollapsed(),
            "item",
          ),
        );
      }

      // --- 3. Caret safety: expand any fold hiding either selection end.
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        for (const point of [selection.anchor, selection.focus]) {
          const pointNode = point.getNode();
          const topLevel = pointNode.getTopLevelElement();
          const headingKey = topLevel
            ? hiderOf.get(topLevel.getKey())
            : undefined;
          if (headingKey !== undefined) reveal.add(headingKey);
          for (let n: LexicalNode | null = pointNode; n; n = n.getParent()) {
            if ($isListItemNode(n) && $isListNode(n.getFirstChild())) {
              const row = n.getPreviousSibling();
              if ($isCollapsibleListItemNode(row) && row.getCollapsed()) {
                reveal.add(row.getKey());
              }
            }
          }
        }
      }
    });

    setChevrons((prev) => (chevronsEqual(prev, next) ? prev : next));

    if (reveal.size > 0) {
      editor.update(() => {
        for (const key of reveal) {
          const node = $getNodeByKey(key);
          if ($isCollapsibleHeadingNode(node) || $isCollapsibleListItemNode(node)) {
            node.setCollapsed(false);
          }
        }
      });
    }
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

  // Initial pass + reflow tracking (density changes, container resizes).
  useEffect(() => {
    sync();
    if (!portalEl) return;
    const observer = new ResizeObserver(() => sync());
    observer.observe(portalEl);
    const rootEl = editor.getRootElement();
    if (rootEl) observer.observe(rootEl);
    return () => observer.disconnect();
  }, [editor, portalEl, sync]);

  const toggle = useCallback(
    (key: string) => {
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (
          !$isCollapsibleHeadingNode(node) &&
          !$isCollapsibleListItemNode(node)
        ) {
          return;
        }
        const collapsing = !node.getCollapsed();
        if (collapsing) $moveCaretOutOf(node);
        node.setCollapsed(collapsing);
      });
    },
    [editor],
  );

  /**
   * Mod+/: every fold target in the document — all top-level headings plus
   * list rows that actually have a sublist. If ANY is expanded, collapse all;
   * only when everything is already folded, expand all. When collapsing,
   * rows go first and headings bottom-up, so each $moveCaretOutOf parks the
   * caret on a row a later (earlier-in-document) fold still covers and
   * re-parks — the caret can't end up stranded in hidden content, which the
   * caret-safety pass would instantly reopen.
   */
  const toggleAll = useCallback(() => {
    editor.update(() => {
      const headings = $getRoot()
        .getChildren()
        .filter($isCollapsibleHeadingNode);
      const items = $nodesOfType(CollapsibleListItemNode).filter(
        (item) =>
          item.isAttached() &&
          !$isListNode(item.getFirstChild()) &&
          $isSublistWrapper(item.getNextSibling()),
      );
      const targets = [...headings, ...items];
      if (targets.length === 0) return;

      if (targets.every((n) => n.getCollapsed())) {
        for (const n of targets) n.setCollapsed(false);
        return;
      }
      for (const n of [...items, ...headings.reverse()]) {
        if (n.getCollapsed()) continue;
        $moveCaretOutOf(n);
        n.setCollapsed(true);
      }
    });
  }, [editor]);

  // Fold gestures: double-click a heading or a bullet row (only rows that
  // actually have a sublist), Mod+. with the caret on/in one, or Mod+/ to
  // toggle every fold in the document. The dblclick rides on the browser's
  // word-select (no preventDefault) — accepted trade-off for a one-gesture
  // fold; the chevron remains the precision control.
  useEffect(() => {
    const onDblClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // editor.read, NOT editorState.read: DOM→node lookup needs an active
      // EDITOR (keys live on DOM props namespaced by editor._key), and
      // editorState.read sets none — $getNearestNodeFromDOMNode would throw.
      const key = editor.read(() =>
        $collapsibleKeyFor($getNearestNodeFromDOMNode(target)),
      );
      if (key !== null) toggle(key);
    };
    return mergeRegister(
      // Root listener (not a one-time addEventListener) so the handler
      // follows Lexical root swaps; teardown calls back with (null, prev).
      editor.registerRootListener((rootEl, prevRootEl) => {
        prevRootEl?.removeEventListener("dblclick", onDblClick);
        rootEl?.addEventListener("dblclick", onDblClick);
      }),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          if (isCollapseAllHotkey(event)) {
            event.preventDefault();
            toggleAll();
            return true;
          }
          if (!isCollapseHotkey(event)) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          const key = $collapsibleKeyFor(selection.anchor.getNode());
          if (key === null) return false;
          event.preventDefault();
          toggle(key);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, toggle, toggleAll]);

  if (!portalEl) return null;
  return createPortal(
    <>
      {chevrons.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-label={c.collapsed ? "Expand" : "Collapse"}
          aria-expanded={!c.collapsed}
          contentEditable={false}
          // preventDefault keeps the editor's selection untouched by the click.
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            toggle(c.key);
          }}
          className="editor-collapse-btn"
          data-collapsed={c.collapsed ? "true" : undefined}
          style={{ top: c.top, left: c.left }}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      ))}
    </>,
    portalEl,
  );
}

/**
 * Collapsing a region the caret lives in would strand it in display:none
 * content (and the caret-safety pass would instantly reopen the fold, making
 * collapse impossible). Park the caret on the fold's own row first.
 */
function $moveCaretOutOf(
  node: CollapsibleHeadingNode | CollapsibleListItemNode,
): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  // Either end of a (possibly backwards) range counts as "inside".
  const points = [selection.anchor.getNode(), selection.focus.getNode()];

  if ($isCollapsibleHeadingNode(node)) {
    const level = levelOf(node.getTag());
    const topLevelKeys = new Set(
      points.map((p) => p.getTopLevelElement()?.getKey()).filter(Boolean),
    );
    for (
      let sibling = node.getNextSibling();
      sibling && !($isHeadingNode(sibling) && levelOf(sibling.getTag()) <= level);
      sibling = sibling.getNextSibling()
    ) {
      if (topLevelKeys.has(sibling.getKey())) {
        node.selectEnd();
        return;
      }
    }
    return;
  }

  const wrapper = node.getNextSibling();
  if (!$isListItemNode(wrapper)) return;
  for (const point of points) {
    for (let n: LexicalNode | null = point; n; n = n.getParent()) {
      if (n.getKey() === wrapper.getKey()) {
        node.selectEnd();
        return;
      }
    }
  }
}

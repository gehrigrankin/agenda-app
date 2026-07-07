"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $isHeadingNode, type HeadingTagType } from "@lexical/rich-text";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
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

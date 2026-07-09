"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";
import { $getNearestNodeFromDOMNode, $getNodeByKey } from "lexical";
import { ListTodo, Strikethrough } from "lucide-react";

import { $toggleRowStrikethrough } from "./CrossOffPlugin";
import { $listItemToTask } from "./TaskShortcutsPlugin";

/**
 * Click a bullet's marker → a small action menu for that row ("Turn into
 * task", "Cross off").
 *
 * The `::marker` pseudo-element isn't a DOM node — it can't be listened to,
 * and (rendered `outside`, in the list's margin gutter) a click on it usually
 * targets an ancestor, not even the <li>. So the plugin listens for mousedown
 * on the editor root and hit-tests geometrically: the click counts as a
 * marker click when its x falls LEFT of the row's text box (the first
 * text-bearing child's rect) but within MARKER_GUTTER px of the <li>'s own
 * left edge, and its y is inside the <li>. The mousedown is preventDefault-ed
 * so the caret never jumps into the row.
 *
 * Only real bulleted rows qualify: checklist rows have their own checkbox
 * affordance, sublist wrapper <li>s render no marker (`list-none`) and span
 * the whole sublist, and the DOM hit is re-verified against the editor state
 * (ListItemNode inside a "bullet" list) before the menu opens. No collision
 * with CollapsePlugin's gutter chevrons: those are real buttons portaled
 * OUTSIDE the editor root, so their clicks never reach this listener.
 */

/** How far left of the <li> box a click still counts as "on the marker". */
const MARKER_GUTTER = 24;

/** Left edge of the row's own text box (its first text-bearing child). */
function textLeft(li: HTMLElement): number {
  for (const child of li.childNodes) {
    if (child instanceof HTMLUListElement || child instanceof HTMLOListElement) {
      break; // reached a nested sublist — no own text before it
    }
    if (child instanceof HTMLElement) return child.getBoundingClientRect().left;
    if (child.nodeType === Node.TEXT_NODE && child.textContent) {
      const range = document.createRange();
      range.selectNodeContents(child);
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) return rect.left;
    }
  }
  // Empty row (just a <br>): the content box's left edge stands in.
  return li.getBoundingClientRect().left;
}

/** The bullet <li> whose marker gutter contains (x, y), or null. */
function markerHit(root: HTMLElement, x: number, y: number): HTMLElement | null {
  for (const li of root.querySelectorAll<HTMLElement>("ul > li")) {
    // Checklist rows (checkbox pseudo-elements own that gutter).
    if (
      li.classList.contains("editor-checked") ||
      li.classList.contains("editor-unchecked")
    ) {
      continue;
    }
    // Sublist wrapper <li>s: no marker, and their rect spans the sublist.
    const firstEl = li.firstElementChild;
    if (firstEl instanceof HTMLUListElement || firstEl instanceof HTMLOListElement) {
      continue;
    }
    const rect = li.getBoundingClientRect();
    if (y < rect.top || y > rect.bottom) continue;
    if (x >= rect.left - MARKER_GUTTER && x < textLeft(li)) return li;
  }
  return null;
}

type MenuState = {
  /** Lexical key of the clicked row. */
  nodeKey: string;
  x: number;
  y: number;
  /** Near the viewport bottom the menu opens upward from the row instead. */
  openUp: boolean;
};

export function BulletMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const root = editor.getRootElement();
      if (!root) return;
      const li = markerHit(root, event.clientX, event.clientY);
      if (!li) return;
      // Re-verify against the editor state: a row of a plain bulleted list.
      // Must be editor.read() (not editorState.read()) — $getNearestNodeFromDOMNode
      // needs an active editor to resolve DOM keys.
      let key: string | null = null;
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(li);
        if ($isListItemNode(node) && !$isListNode(node.getFirstChild())) {
          const list = node.getParent();
          if ($isListNode(list) && list.getListType() === "bullet") {
            key = node.getKey();
          }
        }
      });
      if (key === null) return;
      // Keep the browser from moving the caret into the row.
      event.preventDefault();
      const rect = li.getBoundingClientRect();
      const openUp = rect.bottom + 96 > window.innerHeight;
      setMenu({
        nodeKey: key,
        x: Math.max(8, rect.left - MARKER_GUTTER),
        y: openUp ? rect.top - 4 : rect.bottom + 4,
        openUp,
      });
    };
    // Root listener (not a one-time addEventListener) so the handler follows
    // Lexical root swaps; capture so it runs before Lexical's own handlers.
    return editor.registerRootListener((rootEl, prevRootEl) => {
      prevRootEl?.removeEventListener("mousedown", onMouseDown, true);
      rootEl?.addEventListener("mousedown", onMouseDown, true);
    });
  }, [editor]);

  // Escape closes (outside clicks close via the backdrop button).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  if (!menu) return null;

  /** Close the menu, then run `fn` on the clicked row in an editor update. */
  const withRow = (fn: (item: ListItemNode) => void) => {
    const key = menu.nodeKey;
    setMenu(null);
    editor.update(() => {
      const node = $getNodeByKey(key);
      if ($isListItemNode(node)) fn(node);
    });
  };

  const ITEM =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60";

  // App popover pattern (see NoteContextMenu in NotesListPane.tsx): a
  // full-screen backdrop button closes it; menu chrome matches the slash menu.
  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close menu"
        onMouseDown={() => setMenu(null)}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        style={{ left: menu.x, top: menu.y }}
        className={`fixed z-50 w-44 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 ${
          menu.openUp ? "-translate-y-full" : ""
        }`}
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => withRow((item) => $listItemToTask(item))}
          className={ITEM}
        >
          <ListTodo className="h-4 w-4 text-neutral-500" />
          Turn into task
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            withRow((item) => {
              // Collapse the helper's row-wide range to a caret at the end.
              if ($toggleRowStrikethrough(item)) item.selectEnd();
            })
          }
          className={ITEM}
        >
          <Strikethrough className="h-4 w-4 text-neutral-500" />
          Cross off
        </button>
      </div>
    </>,
    document.body,
  );
}

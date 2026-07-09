"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $findMatchingParent } from "@lexical/utils";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { $isCodeNode } from "@lexical/code";

/**
 * Mod+Enter "cross off": strikethrough for whole rows without selecting
 * first. With a collapsed caret the entire line the caret sits on (bullet row,
 * paragraph, heading) toggles; with a real selection it behaves like the
 * floating toolbar's strikethrough button.
 */

/**
 * Shared with the task chip's title input (which swallows keystrokes before
 * Lexical sees them) so Mod+Enter crosses a task off there too.
 */
export function isCrossOffHotkey(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === "Enter";
}

/** The "row" a caret position belongs to: its list row, else its top-level block. */
function $rowOf(node: LexicalNode): ElementNode | null {
  const item = $findMatchingParent(node, (n) => {
    // The nearest real list ROW — not the wrapper <li> that only holds a
    // nested sublist.
    return $isListItemNode(n) && !$isListNode(n.getFirstChild());
  });
  if (item !== null) return item as ElementNode;
  const top = node.getTopLevelElement();
  return $isElementNode(top) ? top : null;
}

/**
 * Toggle strikethrough across all of `row`'s text: selects the row's text and
 * formats it, leaving that range selected — the caller owns putting the caret
 * back. Shared with BulletMenuPlugin's "Cross off" action.
 */
export function $toggleRowStrikethrough(row: ElementNode): boolean {
  if ($isCodeNode(row)) return false;
  const textNodes = row.getAllTextNodes();
  if (textNodes.length === 0) return false;
  const first = textNodes[0];
  const last = textNodes[textNodes.length - 1];
  const rowSelection = first.select(0, 0);
  rowSelection.focus.set(last.getKey(), last.getTextContentSize(), "text");
  rowSelection.formatText("strikethrough");
  return true;
}

function $crossOffRow(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  // A real selection: plain strikethrough toggle on it.
  if (!selection.isCollapsed()) {
    selection.formatText("strikethrough");
    return true;
  }

  const anchorNode = selection.anchor.getNode();
  const row = $rowOf(anchorNode);
  if (row === null) return false;

  // Remember the caret as an absolute character offset in the row, so it can
  // be put back after formatText rebuilds the row's text nodes.
  const textNodes = row.getAllTextNodes();
  let caretOffset: number | null = null;
  if ($isTextNode(anchorNode)) {
    caretOffset = 0;
    for (const t of textNodes) {
      if (t.is(anchorNode)) {
        caretOffset += selection.anchor.offset;
        break;
      }
      caretOffset += t.getTextContentSize();
    }
  }

  if (!$toggleRowStrikethrough(row)) return false;

  // Restore the caret.
  if (caretOffset !== null) {
    let remaining = caretOffset;
    for (const t of row.getAllTextNodes()) {
      const size = t.getTextContentSize();
      if (remaining <= size) {
        t.select(remaining, remaining);
        return true;
      }
      remaining -= size;
    }
  }
  row.selectEnd();
  return true;
}

export function CrossOffPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          if (!isCrossOffHotkey(event)) return false;
          // Chip inputs (task title, dates) own their keystrokes.
          const target = event.target;
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
          ) {
            return false;
          }
          // Swallow the hotkey even when nothing toggled (empty row, code
          // block): returning false would hand the event to RichText's
          // KEY_ENTER_COMMAND, which inserts a paragraph break.
          event.preventDefault();
          $crossOffRow();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );

  return null;
}

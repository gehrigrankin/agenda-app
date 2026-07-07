"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
} from "@lexical/list";
import type { ElementTransformer } from "@lexical/markdown";
import { $findMatchingParent } from "@lexical/utils";
import {
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { $isCodeNode } from "@lexical/code";

import { $createTaskNode, $isTaskNode, TaskNode } from "../nodes/TaskNode";
import { $replaceBlockWithParagraph, isTaskToggleHotkey } from "../taskHotkey";

/**
 * Fast paths for turning a row into a first-class task:
 *
 * - Typing "[] " at the start of a line converts it the moment the space
 *   lands (a markdown ElementTransformer — see TASK_TRANSFORMER, registered
 *   via Editor.tsx's MarkdownShortcutPlugin). Distinct from the stock
 *   CHECK_LIST transformer, which owns "[ ] "/"[x] " and makes @lexical/list
 *   checklist items, not TaskNodes.
 * - Mod+Shift+X toggles the block the caret is on: paragraph/heading/quote or
 *   bullet → task, and a (keyboard-)selected task back → paragraph. The task
 *   chip's own inputs handle the same hotkey internally (they swallow
 *   keystrokes), so a chip being typed in toggles back too.
 *
 * Both directions convert by REPLACING the block: TaskNode is a decorator
 * holding a plain title string, so a bullet's text becomes the task title and
 * a task's title becomes paragraph text. The new chip opens pre-filled in its
 * title input; committing (Enter/blur) creates the DB row exactly like the
 * slash-command flow.
 */

const textOf = (nodes: LexicalNode[]) =>
  nodes
    .map((n) => ($isListNode(n) ? "" : n.getTextContent()))
    .join("")
    .trim();

export const TASK_TRANSFORMER: ElementTransformer = {
  dependencies: [TaskNode],
  // Markdown export renders a task as a checklist line.
  export: (node) =>
    $isTaskNode(node)
      ? `- [${node.exportJSON().completed ? "x" : " "}] ${node.getTextContent()}`
      : null,
  regExp: /^\[\]\s$/,
  replace: (parentNode, children, _match, isImport) => {
    // Only a live typing shortcut; markdown imports keep "[]" literal.
    if (isImport) return false;
    parentNode.replace($createTaskNode({ title: textOf(children) }));
  },
  type: "element",
};

/** Bullet → task: pull the row out of its list, splitting the list if needed. */
function $listItemToTask(item: ListItemNode): boolean {
  const list = item.getParent();
  if (!$isListNode(list)) return false;
  // Own text only — a nested sublist under this row stays a list.
  const task = $createTaskNode({ title: textOf(item.getChildren()) });
  const following = item.getNextSiblings();
  item.remove();
  if (list.getChildrenSize() === 0) {
    list.replace(task);
  } else if (following.length === 0) {
    list.insertAfter(task);
  } else if (following.length === list.getChildrenSize()) {
    list.insertBefore(task);
  } else {
    // Middle row: split the remainder into a sibling list after the task.
    const tail = $createListNode(list.getListType());
    tail.append(...following);
    list.insertAfter(tail);
    list.insertAfter(task);
  }
  return true;
}

function $toggleTaskAtSelection(): boolean {
  const selection = $getSelection();

  // A task selected as a block (keyboard navigation) toggles back to text.
  if ($isNodeSelection(selection)) {
    const nodes = selection.getNodes();
    if (nodes.length === 1 && $isTaskNode(nodes[0])) {
      $replaceBlockWithParagraph(nodes[0], nodes[0].getTextContent());
      return true;
    }
    return false;
  }

  if (!$isRangeSelection(selection)) return false;
  const anchor = selection.anchor.getNode();

  const item = $findMatchingParent(anchor, $isListItemNode);
  if (item !== null) return $listItemToTask(item as ListItemNode);

  const block: ElementNode | null = anchor.getTopLevelElement();
  if (block === null || $isCodeNode(block)) return false;
  const text = block.getTextContent().trim();
  block.replace($createTaskNode(text ? { title: text } : {}));
  return true;
}

export function TaskShortcutsPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          if (!isTaskToggleHotkey(event)) return false;
          // Keystrokes inside chip inputs (task title, date) are the chip's
          // to handle — Lexical's selection is stale there.
          const target = event.target;
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
          ) {
            return false;
          }
          if ($toggleTaskAtSelection()) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );

  return null;
}

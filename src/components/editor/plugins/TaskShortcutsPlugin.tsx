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
  $setSelection,
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
 *   via Editor.tsx's MarkdownShortcutPlugin). No collision with checklists:
 *   the stock TRANSFORMERS set does not include CHECK_LIST, so "[ ] " has no
 *   markdown meaning in this editor.
 * - Mod+E toggles the block the caret is on: paragraph/heading/quote or
 *   bullet → task, and a (keyboard-)selected task back → paragraph. The task
 *   chip's own inputs handle the same hotkey internally (they swallow
 *   keystrokes), so a chip being typed in toggles back too.
 *
 * Both directions convert by REPLACING the block: TaskNode is a decorator
 * holding a plain title string, so a bullet's text becomes the task title and
 * a task's title becomes paragraph text. The new chip opens pre-filled in its
 * title input; committing (Enter/blur) creates the DB row exactly like the
 * slash-command flow.
 *
 * Every text→task conversion ends with `$setSelection(null)`: the caret was
 * anchored in text that the replace detaches, and Lexical aborts the whole
 * update ("selection has been lost") if the pending selection still points at
 * detached nodes. Null is correct here — the chip's title input autofocuses.
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
  // No $ anchor: the shortcut runner tests the whole first text node (with
  // the caret required right after the match), so an anchored regex would
  // never fire on "[] existing text".
  regExp: /^\[\]\s/,
  // Runs for typing and markdown import alike; either way the line's
  // remaining text becomes the (draft) task title.
  replace: (parentNode, children) => {
    parentNode.replace($createTaskNode({ title: textOf(children) }));
    $setSelection(null);
  },
  type: "element",
};

/**
 * Meeting-notes shorthand (design 14c): a line starting with "@someone "
 * becomes an action item, keeping the @mention in the title as the assignee
 * label. Requires the mention plus a space so plain emails/handles mid-thought
 * don't convert.
 */
export const AT_TASK_TRANSFORMER: ElementTransformer = {
  dependencies: [TaskNode],
  export: () => null, // TASK_TRANSFORMER owns markdown export for tasks
  regExp: /^@[a-zA-Z][\w.-]*\s/,
  replace: (parentNode, children, match) => {
    const rest = textOf(children);
    const mention = match[0].trim();
    parentNode.replace(
      $createTaskNode({ title: rest ? `${mention} ${rest}` : mention }),
    );
    $setSelection(null);
  },
  type: "element",
};

/**
 * Bullet → task: pull the row out of its list, splitting the list if needed.
 * Shared with BulletMenuPlugin's "Turn into task" action.
 */
export function $listItemToTask(item: ListItemNode): boolean {
  const list = item.getParent();
  if (!$isListNode(list)) return false;
  // Own text only — a nested sublist under this row stays a list.
  const task = $createTaskNode({ title: textOf(item.getChildren()) });
  if (list.getChildrenSize() === 1) {
    // Sole row: the task takes the whole list's place. (Removing the item
    // first would cascade-remove the then-empty list out from under us —
    // ListNode.canBeEmpty() is false.)
    list.replace(task);
  } else {
    const following = item.getNextSiblings();
    if (following.length === 0) {
      list.insertAfter(task);
    } else if (following.length === list.getChildrenSize() - 1) {
      list.insertBefore(task);
    } else {
      // Middle row: move the remainder into a sibling list after the task.
      const tail = $createListNode(list.getListType());
      tail.append(...following);
      list.insertAfter(tail);
      list.insertAfter(task);
    }
    // Remove LAST, after the row's neighbors are settled: with no next
    // sibling left, ListItemNode.remove()'s sublist-merging side effect
    // can't fire, and the list can no longer end up empty here.
    item.remove();
  }
  $setSelection(null);
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
  $setSelection(null);
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

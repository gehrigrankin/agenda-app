import {
  $createListItemNode,
  $createListNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  createEditor,
} from "lexical";
import { describe, expect, it, vi } from "vitest";

import { $isTaskNode, TaskNode } from "../nodes/TaskNode";
import {
  $applyTaskConversion,
  $collectSelectedListItems,
  $listItemOwnText,
  $selectionIsListsOnly,
} from "./SelectionActionsPlugin";

// TaskNode.tsx (imported above, and by SelectionActionsPlugin.tsx) pulls in
// src/app/app/actions.ts (createTaskAction etc.), a "use server" module whose
// repo layer imports the `server-only` package — that throws unconditionally
// outside Next's "react-server" bundler condition, which Vitest doesn't
// apply. Mocking the module (hoisted above these imports by Vitest) keeps
// this a pure node-tree test without pulling in Next/Clerk/the DB.
vi.mock("@/app/app/actions", () => ({
  createTaskAction: vi.fn(),
  renameTaskAction: vi.fn(),
  setTaskDueAction: vi.fn(),
  setTaskImportantAction: vi.fn(),
  toggleTaskAction: vi.fn(),
  getOrCreateTodayNoteAction: vi.fn(),
  moveBlocksToNoteAction: vi.fn(),
  searchAction: vi.fn(),
  turnListItemsIntoTasksAction: vi.fn(),
}));

function makeEditor() {
  return createEditor({
    namespace: "selection-actions-test",
    nodes: [ListNode, ListItemNode, TaskNode],
    onError: (error) => {
      throw error;
    },
  });
}

describe("$collectSelectedListItems / $listItemOwnText / $selectionIsListsOnly", () => {
  it("collects only the list items a selection touches, in document order, with their own text", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const list = $createListNode("bullet");
        const item1 = $createListItemNode();
        item1.append($createTextNode("First"));
        const item2 = $createListItemNode();
        item2.append($createTextNode("Second"));
        const item3 = $createListItemNode();
        item3.append($createTextNode("Third"));
        list.append(item1, item2, item3);
        $getRoot().append(list);

        const start = item1.getFirstChild()!;
        const end = item2.getFirstChild()!;
        const selection = $createRangeSelection();
        selection.anchor.set(start.getKey(), 0, "text");
        selection.focus.set(end.getKey(), end.getTextContentSize(), "text");

        const items = $collectSelectedListItems(selection);
        expect(items.map((i) => i.getKey())).toEqual([item1.getKey(), item2.getKey()]);
        expect($listItemOwnText(items[0])).toBe("First");
        expect($listItemOwnText(items[1])).toBe("Second");
        expect($selectionIsListsOnly(selection)).toBe(true);
      },
      { discrete: true },
    );
  });

  it("is false once the selection's top-level range includes a non-list block", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("Some prose"));
        const list = $createListNode("bullet");
        const item = $createListItemNode();
        item.append($createTextNode("Only item"));
        list.append(item);
        $getRoot().append(paragraph, list);

        const selection = $createRangeSelection();
        const proseText = paragraph.getFirstChild()!;
        const itemText = item.getFirstChild()!;
        selection.anchor.set(proseText.getKey(), 0, "text");
        selection.focus.set(itemText.getKey(), itemText.getTextContentSize(), "text");
        expect($selectionIsListsOnly(selection)).toBe(false);
      },
      { discrete: true },
    );
  });
});

describe("$applyTaskConversion", () => {
  it("replaces a flat list's items with real tasks, in order, dropping the emptied list", () => {
    const editor = makeEditor();
    const keys: string[] = [];
    editor.update(
      () => {
        const list = $createListNode("bullet");
        const item1 = $createListItemNode();
        item1.append($createTextNode("Buy milk"));
        const item2 = $createListItemNode();
        item2.append($createTextNode("Walk dog"));
        list.append(item1, item2);
        $getRoot().append(list);
        keys.push(item1.getKey(), item2.getKey());
      },
      { discrete: true },
    );

    editor.update(
      () => {
        $applyTaskConversion([
          { key: keys[0], taskId: "task-1", title: "Buy milk" },
          { key: keys[1], taskId: "task-2", title: "Walk dog" },
        ]);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(2);
      expect($isTaskNode(children[0])).toBe(true);
      expect($isTaskNode(children[1])).toBe(true);
      const task1 = children[0] as TaskNode;
      const task2 = children[1] as TaskNode;
      expect(task1.__taskId).toBe("task-1");
      expect(task1.getTextContent()).toBe("Buy milk");
      expect(task2.__taskId).toBe("task-2");
      expect(task2.getTextContent()).toBe("Walk dog");
    });
  });

  it("hoists a nested bullet's task above a later top-level sibling's, cleans up the emptied sublist, and leaves the untouched parent row alone", () => {
    const editor = makeEditor();
    const keys = { child: "", sibling: "" };
    editor.update(
      () => {
        const list = $createListNode("bullet");

        const parentItem = $createListItemNode();
        parentItem.append($createTextNode("Parent"));
        const nested = $createListNode("bullet");
        const childItem = $createListItemNode();
        childItem.append($createTextNode("Child"));
        nested.append(childItem);
        parentItem.append(nested);

        const siblingItem = $createListItemNode();
        siblingItem.append($createTextNode("Sibling"));

        list.append(parentItem, siblingItem);
        $getRoot().append(list);

        keys.child = childItem.getKey();
        keys.sibling = siblingItem.getKey();
      },
      { discrete: true },
    );

    // Document order is [child, sibling]; passed in that order, same as
    // $collectSelectedListItems would produce for a selection spanning both.
    editor.update(
      () => {
        $applyTaskConversion([
          { key: keys.child, taskId: "task-child", title: "Child" },
          { key: keys.sibling, taskId: "task-sibling", title: "Sibling" },
        ]);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      // [list (only the untouched "Parent" row left), task-child, task-sibling]
      expect(children).toHaveLength(3);
      expect($isListNode(children[0])).toBe(true);
      const list = children[0] as ListNode;
      expect(list.getChildrenSize()).toBe(1);
      expect(list.getFirstChild()!.getTextContent()).toBe("Parent");

      expect($isTaskNode(children[1])).toBe(true);
      expect((children[1] as TaskNode).__taskId).toBe("task-child");
      expect($isTaskNode(children[2])).toBe(true);
      expect((children[2] as TaskNode).__taskId).toBe("task-sibling");
    });
  });
});

"use client";

import { useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { Check, ListTree } from "lucide-react";

import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import {
  planTaskReparent,
  taskParentCandidates,
  taskParentIndex,
} from "@/lib/task-tree";
import { $applyTaskReparent, $rootTaskBlocks } from "./taskReparent";

/**
 * "Nest this task under…" — the mouse equivalent of Tab, for the case Tab
 * can't express: a parent that isn't the row directly above.
 *
 * It stores NOTHING. Picking a parent writes an indent and, when the task
 * isn't already sitting in that parent's run, moves the block (with its whole
 * subtree) to the end of it — see `planTaskReparent`. Structure stays derived
 * from indent + document order, which is what lets the same task be nested
 * differently in every note it appears in.
 *
 * The menu is built fresh on each open by reading the editor state, so it can
 * never offer a stale row, and it only lists parents the plan actually accepts:
 * the task's own descendants are absent (nesting a task under its own child
 * would orphan the subtree) and so is anything that would push the run past
 * the maximum depth.
 */

type ParentOption = {
  key: string;
  label: string;
  depth: number;
  /** Below the task in the document: picking it MOVES the task, not just indents it. */
  below: boolean;
};

type MenuState = {
  options: ParentOption[];
  /** Node key of the task's current parent, for the tick. */
  currentKey: string | null;
  /** Already a root — "Top level" is the current choice. */
  atTopLevel: boolean;
};

export function TaskParentPicker({
  nodeKey,
  maxIndent,
}: {
  nodeKey: string;
  maxIndent: number;
}) {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  useOutsideClose(menu !== null, containerRef, () => setMenu(null));

  const open = () => {
    setMenu(
      editor.getEditorState().read(() => {
        const { nodes, blocks } = $rootTaskBlocks();
        const index = nodes.findIndex((n) => n.getKey() === nodeKey);
        if (index < 0) return null;
        const parent = taskParentIndex(blocks, index);
        return {
          options: taskParentCandidates(blocks, index, maxIndent).map((i) => ({
            key: nodes[i].getKey(),
            label: nodes[i].getTextContent().trim() || "Untitled task",
            depth: blocks[i].indent,
            below: i > index,
          })),
          currentKey: parent === null ? null : nodes[parent].getKey(),
          atTopLevel: parent === null && blocks[index].indent === 0,
        };
      }),
    );
  };

  /** `parentKey` null = "Top level". */
  const choose = (parentKey: string | null) => {
    setMenu(null);
    editor.update(() => {
      // Re-read rather than trust the state the menu was built from: the
      // document may have changed under an open menu.
      const { nodes, blocks } = $rootTaskBlocks();
      const index = nodes.findIndex((n) => n.getKey() === nodeKey);
      if (index < 0) return;
      let parentIndex: number | null = null;
      if (parentKey !== null) {
        parentIndex = nodes.findIndex((n) => n.getKey() === parentKey);
        if (parentIndex < 0) return;
      }
      const plan = planTaskReparent(blocks, index, parentIndex, maxIndent);
      if (plan) $applyTaskReparent(nodes, plan);
    });
  };

  const ROW =
    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.78125rem] text-ink-200 hover:bg-white/6";

  return (
    <span
      ref={containerRef}
      className="relative flex shrink-0 items-center"
      // The chip lives inside a contenteditable; no control in it is a
      // selection gesture.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label="Nest under another task"
        title="Nest under another task"
        onClick={() => (menu === null ? open() : setMenu(null))}
        className={`rounded p-1 ${
          menu !== null ? "text-ink-300" : "text-ink-600 hover:text-ink-300"
        }`}
      >
        <ListTree className="h-4 w-4" />
      </button>

      {menu !== null && (
        <div
          role="menu"
          className="animate-pop-in absolute right-0 top-full z-50 mt-1.5 max-h-64 w-60 overflow-y-auto rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl"
        >
          <p className="px-2 pb-1 pt-0.5 text-[0.65625rem] font-medium uppercase tracking-wide text-ink-500">
            Nest under
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(null)}
            className={ROW}
          >
            <span className="w-3 shrink-0 text-sage">
              {menu.atTopLevel && <Check className="h-3 w-3" />}
            </span>
            <span className="truncate">Top level</span>
          </button>
          {menu.options.length === 0 ? (
            <p className="px-2 py-1.5 text-[0.71875rem] text-ink-500">
              No other task can hold this one.
            </p>
          ) : (
            menu.options.map((option) => (
              <button
                key={option.key}
                type="button"
                role="menuitem"
                onClick={() => choose(option.key)}
                title={option.label}
                className={ROW}
              >
                <span className="w-3 shrink-0 text-sage">
                  {option.key === menu.currentKey && (
                    <Check className="h-3 w-3" />
                  )}
                </span>
                {/* The candidate's own depth, so a menu of a dozen rows still
                    reads as the outline it came from. */}
                <span
                  className="truncate"
                  style={{ paddingInlineStart: `${option.depth * 0.625}rem` }}
                >
                  {option.label}
                </span>
                {option.below && (
                  <span className="ml-auto shrink-0 text-[0.65625rem] text-ink-600">
                    below
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </span>
  );
}

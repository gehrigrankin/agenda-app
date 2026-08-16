"use client";

import { $getRoot, $isElementNode, type LexicalNode } from "lexical";
import { $isListNode } from "@lexical/list";

import { $isTaskNode } from "./nodes/TaskNode";
import type { TaskBlock, TaskReparentPlan } from "@/lib/task-tree";

/**
 * The Lexical half of the parent picker: read the document into the pure
 * nesting model (`lib/task-tree`), and write a plan from it back out.
 *
 * There is no parent pointer to write — a task can live in several notes at
 * once, so its nesting is a fact about THIS document. "Make X a child of Y"
 * is therefore performed as exactly what Tab performs: a depth on the block,
 * plus (when the task isn't already in the right place) a move of the block
 * run within the root's children. Everything downstream — folding, the
 * chevrons, the serialized note — keeps deriving structure the way it always
 * did, and no schema learns about parents.
 */

/**
 * How deep a top-level block reads.
 *
 * Mirrors CollapsePlugin's `$depthOf`, and must stay in step with it: a LIST
 * draws its own indentation from its markers and cannot be indented as a block
 * (Tab inside one nests a sublist), so a bullet list typed under a task counts
 * one level deeper than the prose around it. That is what makes bullets under
 * a task part of its child run at all — and what a reparent has to preserve
 * when it carries them along.
 */
function $depthOf(block: LexicalNode): number {
  if ($isTaskNode(block)) return block.getIndentLevel();
  const indent = $isElementNode(block) ? block.getIndent() : 0;
  return $isListNode(block) ? indent + 1 : indent;
}

/** Write a depth back, undoing the list adjustment above. */
function $setDepth(block: LexicalNode, depth: number): void {
  if ($isTaskNode(block)) {
    block.setIndentLevel(depth);
    return;
  }
  if (!$isElementNode(block)) return;
  block.setIndent(Math.max(0, $isListNode(block) ? depth - 1 : depth));
}

/** The root's children plus their pure-model view, index-aligned. */
export function $rootTaskBlocks(): {
  nodes: LexicalNode[];
  blocks: TaskBlock[];
} {
  const nodes = $getRoot().getChildren();
  return {
    nodes,
    blocks: nodes.map((node) => ({
      isTask: $isTaskNode(node),
      indent: $depthOf(node),
      collapsed: $isTaskNode(node) ? node.getCollapsed() : false,
    })),
  };
}

/**
 * Apply a plan from `planTaskReparent` to the nodes it was computed against.
 *
 * Depths first, then the move: `insertAfter` indexes the ORIGINAL list, so the
 * anchor has to be resolved before anything shifts. The run is re-inserted in
 * order behind a walking cursor — `insertAfter` detaches the node from its old
 * position for us, so a task carries its children whether it is moving down
 * the document or up it.
 */
export function $applyTaskReparent(
  nodes: LexicalNode[],
  plan: TaskReparentPlan,
): void {
  const run = nodes.slice(plan.moved.start, plan.moved.end);
  if (run.length === 0) return;

  run.forEach((node, i) => $setDepth(node, plan.indents[i]));
  if (!plan.moves) return;

  const anchor = plan.insertAfter === null ? null : nodes[plan.insertAfter];
  if (plan.insertAfter !== null && !anchor) return;
  let cursor: LexicalNode | null = anchor ?? null;
  for (const node of run) {
    if (cursor === null) {
      // Landing at the very top of the document.
      const first = $getRoot().getFirstChild();
      if (first === null || first === node) $getRoot().append(node);
      else first.insertBefore(node);
    } else {
      cursor.insertAfter(node);
    }
    cursor = node;
  }
}

/**
 * Task nesting, derived from indent + document order.
 *
 * A task block carries an `indent` depth and nothing else — there is no parent
 * pointer, here or in the database, and that is deliberate. `note_tasks` is
 * many-to-many with shared completion, so one task can sit in several notes;
 * a global `parent_id` would force a single nesting on a task that is
 * legitimately nested differently in each of them. Structure therefore belongs
 * to the DOCUMENT, exactly as it does for log sections and card anchors.
 *
 * The rule: a task's children are the CONSECUTIVE run of following blocks —
 * tasks OR not — with a greater indent. The run stops at the first block at
 * the same-or-shallower depth, whatever kind it is.
 *
 * Indent, not block type, is what decides. A bullet list or a paragraph the
 * user pushed in under a task is written as belonging to that task, and folding
 * the task should take it along; a paragraph left at the task's own depth is
 * prose belonging to the NOTE, and it still terminates the run, so folding a
 * parent never swallows writing the user put between two tasks. (The older rule
 * — any non-task ends the run — got the second case right and the first wrong.)
 *
 * Pure: no Lexical runtime, no DOM. Callers map their nodes into `TaskBlock`,
 * and they own the translation of "how deep does this look" into `indent` (a
 * bullet list draws its own indent, so its depth is not just its indent field).
 */

/** The only three things nesting depends on. */
export interface TaskBlock {
  isTask: boolean;
  /** Depth of the block. Meaningful for tasks and non-tasks alike. */
  indent: number;
  /** Whether this task is folded. Ignored when `isTask` is false. */
  collapsed: boolean;
}

export interface TaskFoldState {
  /** Indices hidden because some ancestor above them is collapsed. */
  hidden: Set<number>;
  /** Indices of tasks that have at least one child (so they get a chevron). */
  hasChildren: Set<number>;
}

/**
 * Half-open range `[start, end)` of the blocks nested under `index`, or null
 * when that index isn't a task. `start === end` means "a task with no
 * children" — a real answer, not a missing one.
 */
export function taskChildRange(
  blocks: TaskBlock[],
  index: number,
): { start: number; end: number } | null {
  if (!Array.isArray(blocks)) return null;
  const parent = blocks[index];
  if (!parent || !parent.isTask) return null;

  const start = index + 1;
  let end = start;
  while (end < blocks.length) {
    const block = blocks[end];
    if (!block) break;
    if (block.indent <= parent.indent) break;
    end += 1;
  }
  return { start, end };
}

/**
 * Which blocks are folded away, and which tasks are foldable.
 *
 * Nested collapses union rather than fight: a collapsed grandparent hides its
 * whole subtree whatever the parent's own state is, so expanding an inner task
 * that is itself inside a collapsed one does not make it reappear.
 */
export function taskFoldState(blocks: TaskBlock[]): TaskFoldState {
  const hidden = new Set<number>();
  const hasChildren = new Set<number>();
  if (!Array.isArray(blocks)) return { hidden, hasChildren };

  for (let i = 0; i < blocks.length; i += 1) {
    const range = taskChildRange(blocks, i);
    if (!range || range.start === range.end) continue;
    hasChildren.add(i);
    if (!blocks[i].collapsed) continue;
    for (let j = range.start; j < range.end; j += 1) hidden.add(j);
  }
  return { hidden, hasChildren };
}

/**
 * Indices of every TASK nested under `index`, at any depth — what "complete
 * this parent" or "delete this parent" would reach.
 *
 * The subtree range is already consecutive, so this is just a filter over it:
 * the bullets and paragraphs in the range fold with the parent but have no
 * completion to propagate to, so they are left out. [] for a childless task.
 */
export function taskDescendants(blocks: TaskBlock[], index: number): number[] {
  const range = taskChildRange(blocks, index);
  if (!range) return [];
  const out: number[] = [];
  for (let i = range.start; i < range.end; i += 1) {
    if (blocks[i]?.isTask) out.push(i);
  }
  return out;
}

/**
 * Clamp a would-be indent to one the document can actually express: a task may
 * be at most one level deeper than the task above it. Without this, tabbing a
 * task twice in a row would create a "child" of nothing — it would render
 * indented but have no parent, and fold with neither.
 *
 * `previousIndent` is null when no task precedes this one, which forces 0: the
 * first task in a run is always a root.
 */
export function clampToParentDepth(
  desired: number,
  previousIndent: number | null,
  max: number,
): number {
  const ceiling = previousIndent === null ? 0 : Math.min(previousIndent + 1, max);
  return Math.max(0, Math.min(desired, ceiling));
}

/**
 * The task `index` currently hangs off, or null when it is a root.
 *
 * The mirror image of `taskChildRange`: walk back to the first block that is
 * shallower than this one. If it's a task, that's the parent; if it's prose or
 * a bullet at a shallower depth, the run this task sits in was never any
 * task's child run, so the answer is null rather than "the task above that".
 */
export function taskParentIndex(
  blocks: TaskBlock[],
  index: number,
): number | null {
  if (!Array.isArray(blocks)) return null;
  const block = blocks[index];
  if (!block || !block.isTask) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = blocks[i];
    if (!candidate) break;
    if (candidate.indent >= block.indent) continue;
    return candidate.isTask ? i : null;
  }
  return null;
}

/**
 * What a "pick a parent" gesture does to the document.
 *
 * Deliberately expressed as indent + position and nothing else: a stored
 * `parent_id` is the thing this feature must NOT introduce (see the header),
 * so choosing a parent has to be a rewrite of the same two facts Tab and
 * document order already carry.
 */
export interface TaskReparentPlan {
  /**
   * The blocks that travel, half-open `[start, end)` — the task plus its whole
   * child run, so a moved parent always brings its subtree.
   */
  moved: { start: number; end: number };
  /** The task's new depth. Equals `indents[0]`. */
  indent: number;
  /** New depth for each block in `moved`, index-aligned with it. */
  indents: number[];
  /**
   * Index (in the ORIGINAL block list) of the block the run is re-inserted
   * after; null means "at the very top of the document". Never points inside
   * `moved`. Meaningless when `moves` is false.
   */
  insertAfter: number | null;
  /** False when the run is already in the right place and only depth changes. */
  moves: boolean;
}

/**
 * Plan the move that makes `index` a child of `parentIndex` (or a root, when
 * `parentIndex` is null). Pure: the caller applies the plan to its nodes.
 *
 * The task lands as the parent's LAST child — immediately after the parent's
 * existing subtree — which is the only placement that both makes the derived
 * structure say what the user picked and leaves the parent's other children
 * alone. "Top level" is the same rule one step out: the run is parked directly
 * after the root subtree it was living in, so unnesting never leaves the task
 * sitting in the middle of its old siblings where the blocks below it would
 * silently become ITS children.
 *
 * Returns null when the choice is not expressible, rather than doing something
 * approximate:
 *
 * - `index` isn't a task (or the index is out of range).
 * - `parentIndex` isn't a task.
 * - `parentIndex` is the task itself or one of its DESCENDANTS. A descendant
 *   travels inside `moved`, so "nest under it" would ask the run to be both
 *   inside itself and after itself; the honest answer is that the subtree
 *   would be orphaned. Callers filter descendants out of the menu
 *   (`taskParentCandidates`) so this is a guard, not a user-facing error.
 * - The subtree would not fit: the parent is already at `max`, or the deepest
 *   block in the run would be pushed past it. Clamping instead would flatten a
 *   grandchild up to its parent's depth and quietly re-parent it.
 */
export function planTaskReparent(
  blocks: TaskBlock[],
  index: number,
  parentIndex: number | null,
  max: number,
): TaskReparentPlan | null {
  if (!Array.isArray(blocks)) return null;
  const range = taskChildRange(blocks, index);
  if (!range) return null;
  const moved = { start: index, end: range.end };

  let targetIndent = 0;
  if (parentIndex !== null) {
    const parent = blocks[parentIndex];
    if (!parent || !parent.isTask) return null;
    // Self or descendant: both live inside the run that is about to move.
    if (parentIndex >= moved.start && parentIndex < moved.end) return null;
    targetIndent = parent.indent + 1;
    if (targetIndent > max) return null;
  }

  const delta = targetIndent - blocks[index].indent;
  const indents: number[] = [];
  for (let i = moved.start; i < moved.end; i += 1) {
    const next = blocks[i].indent + delta;
    if (next > max) return null;
    indents.push(Math.max(0, next));
  }

  // Already hanging off this parent: honour the pick without shuffling the
  // user's ordering. (Also covers "Top level" on a task that is already root.)
  if (parentIndex === taskParentIndex(blocks, index)) {
    return {
      moved,
      indent: indents[0],
      indents,
      insertAfter: moved.start - 1 >= 0 ? moved.start - 1 : null,
      moves: false,
    };
  }

  // Where the run lands is decided on the document WITHOUT it: removing the
  // run can extend the target's subtree (the blocks that followed the run may
  // themselves be the target's children), and the anchor must never be a block
  // that is travelling.
  const restIndex: number[] = [];
  const rest: TaskBlock[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    if (i >= moved.start && i < moved.end) continue;
    restIndex.push(i);
    rest.push(blocks[i]);
  }

  let anchor: number | null = null;
  if (parentIndex !== null) {
    anchor = restIndex.indexOf(parentIndex);
  } else {
    // Unnest: park after the subtree of the root this task was living under.
    for (let i = moved.start - 1; i >= 0; i -= 1) {
      if (blocks[i].isTask && blocks[i].indent === 0) {
        anchor = restIndex.indexOf(i);
        break;
      }
    }
  }
  let insertAfter: number | null = null;
  if (anchor !== null && anchor >= 0) {
    const anchorRange = taskChildRange(rest, anchor);
    insertAfter = restIndex[(anchorRange ? anchorRange.end : anchor + 1) - 1];
  } else if (moved.start > 0) {
    // No anchor to speak of (a stray indented task with no root above it):
    // leave the run where it is and just fix the depth.
    insertAfter = moved.start - 1;
  }

  return {
    moved,
    indent: indents[0],
    indents,
    insertAfter,
    moves: (insertAfter ?? -1) !== moved.start - 1,
  };
}

/**
 * Every task `index` could legally be nested under, in document order —
 * exactly the rows a parent picker should offer besides "Top level".
 *
 * Defined as "the plan exists", so the menu and the move can never disagree
 * about what is legal. Tasks BELOW `index` are included: picking one is a
 * perfectly clear instruction, it just moves the task instead of only
 * indenting it.
 */
export function taskParentCandidates(
  blocks: TaskBlock[],
  index: number,
  max: number,
): number[] {
  if (!Array.isArray(blocks)) return [];
  const out: number[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    if (!blocks[i]?.isTask) continue;
    if (planTaskReparent(blocks, index, i, max) !== null) out.push(i);
  }
  return out;
}

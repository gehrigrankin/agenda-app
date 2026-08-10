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
 * The rule: a task's children are the CONSECUTIVE run of following task blocks
 * with a greater indent. The run stops at the first block that is not a task,
 * or the first task at the same-or-shallower depth.
 *
 * Non-tasks ending a run is the part worth defending. Prose between two tasks
 * reads as belonging to the note, not to the task above it, so folding a
 * parent must never swallow a paragraph the user wrote in between. The looser
 * "everything until the next shallower task" rule would do exactly that.
 *
 * Pure: no Lexical runtime, no DOM. Callers map their nodes into `TaskBlock`.
 */

/** The only three things nesting depends on. */
export interface TaskBlock {
  isTask: boolean;
  /** Depth for a task block; ignored when `isTask` is false. */
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
    if (!block?.isTask) break;
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
 * Indices of every task nested under `index`, at any depth — what "complete
 * this parent" or "delete this parent" would reach.
 *
 * Separate from `taskChildRange` because that range is already the whole
 * subtree (deeper tasks are consecutive and deeper by definition); this just
 * spells it out as a list, and returns [] for a task with no children.
 */
export function taskDescendants(blocks: TaskBlock[], index: number): number[] {
  const range = taskChildRange(blocks, index);
  if (!range) return [];
  const out: number[] = [];
  for (let i = range.start; i < range.end; i += 1) out.push(i);
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

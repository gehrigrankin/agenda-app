/**
 * Pure tree builder for task nesting (ROADMAP: "Tasks with parent/child").
 *
 * Nesting is scoped to whatever flat list of tasks it's given — the Tasks
 * page shows several buckets (Today, Upcoming, Unscheduled, ...) drawn from
 * the same tasks table, and a parent only visually folds a child when both
 * land in the same bucket. A child whose parent isn't in the given list
 * surfaces as its own root; this is a display choice, not data loss, since
 * `parentId` is still stored server-side.
 */

export interface TaskTreeInputRow {
  id: string;
  parentId: string | null;
}

export interface TaskNode<T extends TaskTreeInputRow> {
  task: T;
  depth: number;
  children: TaskNode<T>[];
}

export function buildTaskTree<T extends TaskTreeInputRow>(
  rows: T[],
): TaskNode<T>[] {
  const ids = new Set(rows.map((r) => r.id));
  const childrenOf = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    const list = childrenOf.get(key);
    if (list) list.push(row);
    else childrenOf.set(key, [row]);
  }

  // `seen` guards against a corrupt parent cycle ever looping the build.
  const seen = new Set<string>();
  const build = (row: T, depth: number): TaskNode<T> => {
    seen.add(row.id);
    const kids = (childrenOf.get(row.id) ?? [])
      .filter((r) => !seen.has(r.id))
      .map((r) => build(r, depth + 1));
    return { task: row, depth, children: kids };
  };

  const roots = (childrenOf.get(null) ?? []).map((r) => build(r, 0));

  // A corrupt parent cycle leaves its members unreachable from any root;
  // surface them as top-level rather than silently dropping them.
  const orphans = rows.filter((r) => !seen.has(r.id));
  for (const orphan of orphans) {
    if (!seen.has(orphan.id)) roots.push(build(orphan, 0));
  }

  return roots;
}

/** Flatten a forest back to task order, depth-first — what a list renders. */
export function flattenTaskTree<T extends TaskTreeInputRow>(
  nodes: TaskNode<T>[],
  collapsed: ReadonlySet<string>,
): TaskNode<T>[] {
  const out: TaskNode<T>[] = [];
  const walk = (list: TaskNode<T>[]) => {
    for (const node of list) {
      out.push(node);
      if (!collapsed.has(node.task.id)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Would setting `taskId`'s parent to `candidateParentId` create a cycle?
 * Walks up from the candidate through `parentOf` looking for `taskId`.
 * `parentOf` is a plain lookup (id -> parent id or null/undefined) rather
 * than a live query, so this stays pure and callable with a Map already
 * loaded by the caller. `maxDepth` is a backstop against corrupt data that
 * already contains a cycle — it must never spin forever.
 */
export function wouldCreateCycle(
  taskId: string,
  candidateParentId: string,
  parentOf: (id: string) => string | null | undefined,
  maxDepth = 1000,
): boolean {
  if (candidateParentId === taskId) return true;
  let cur: string | null | undefined = candidateParentId;
  let depth = 0;
  while (cur != null && depth < maxDepth) {
    if (cur === taskId) return true;
    cur = parentOf(cur);
    depth++;
  }
  return false;
}

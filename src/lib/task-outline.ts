/**
 * Pure indent/section math for nested task rows in the editor. Kept
 * Lexical-free so it's unit-testable without a headless editor; TaskNode
 * (indenting, cascade-check) and CollapsePlugin (folding) are thin glue that
 * collect sibling rows and call into this.
 *
 * A row's "section" mirrors CollapsibleHeadingNode's section semantics
 * (everything after it up to the next row at the same-or-shallower level)
 * but keyed on indent depth instead of heading level — the same rule bullet
 * lists get for free from real tree nesting, reproduced here because
 * TaskNode is a flat sibling, not a container.
 */

export type OutlineRow = { indent: number; isTask: boolean };

/** Tab/Shift+Tab clamp: can only indent one level deeper than the previous row. */
export function clampTaskIndent(
  currentIndent: number,
  previousIndent: number | null,
  direction: 1 | -1,
): number {
  if (direction < 0) return Math.max(0, currentIndent - 1);
  const maxIndent = previousIndent === null ? 0 : previousIndent + 1;
  return Math.min(currentIndent + 1, maxIndent);
}

/**
 * Indices of `rows` that fall under `rows[parentIndex]` — everything after it
 * up to (not including) the next row at the same or shallower indent, or the
 * end of the list.
 */
export function taskSectionIndices(
  rows: OutlineRow[],
  parentIndex: number,
): number[] {
  const parent = rows[parentIndex];
  if (!parent) return [];
  const out: number[] = [];
  for (let i = parentIndex + 1; i < rows.length; i++) {
    if (rows[i].indent <= parent.indent) break;
    out.push(i);
  }
  return out;
}

/** Whether folding `rows[parentIndex]` would actually hide anything. */
export function taskHasSection(rows: OutlineRow[], parentIndex: number): boolean {
  return taskSectionIndices(rows, parentIndex).length > 0;
}

/** Task-row indices nested under `rows[parentIndex]` — cascade-check targets. */
export function descendantTaskIndices(
  rows: OutlineRow[],
  parentIndex: number,
): number[] {
  return taskSectionIndices(rows, parentIndex).filter((i) => rows[i].isTask);
}

/**
 * Pure tree builder for the Notes folder system (design Turn 19b/20a).
 *
 * Folders are bubbles flagged `isFolder`. Their `parentId` points anywhere in
 * the bubble map (usually the root bubble, sometimes another folder). Here we
 * normalize that to a folders-only tree: a folder nests under its parent only
 * when the parent is itself a folder; otherwise it surfaces as a top-level
 * section. Counts roll up so a section badge shows its whole subtree.
 */

export interface FolderTreeInputRow {
  id: string;
  title: string;
  emoji: string | null;
  color: string | null;
  parentId: string | null;
  sortOrder: number;
}

export interface FolderNode {
  id: string;
  title: string;
  emoji: string | null;
  color: string | null;
  depth: number; // 0 = top-level section
  children: FolderNode[];
  /** Live notes directly inside this folder. */
  directCount: number;
  /** Live notes in this folder plus all descendant folders. */
  totalCount: number;
}

export function buildFolderTree(
  rows: FolderTreeInputRow[],
  countsByBubbleId: ReadonlyMap<string, number>,
): FolderNode[] {
  const folderIds = new Set(rows.map((r) => r.id));
  const childrenOf = new Map<string | null, FolderTreeInputRow[]>();
  for (const row of rows) {
    // Parent outside the folder set (root bubble, plain bubble) → top level.
    const key =
      row.parentId && folderIds.has(row.parentId) ? row.parentId : null;
    const list = childrenOf.get(key);
    if (list) list.push(row);
    else childrenOf.set(key, [row]);
  }

  const byOrder = (a: FolderTreeInputRow, b: FolderTreeInputRow) =>
    a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);

  // `seen` guards against a corrupt parent cycle ever looping the build.
  const seen = new Set<string>();
  const build = (row: FolderTreeInputRow, depth: number): FolderNode => {
    seen.add(row.id);
    const kids = (childrenOf.get(row.id) ?? [])
      .filter((r) => !seen.has(r.id))
      .sort(byOrder)
      .map((r) => build(r, depth + 1));
    const directCount = countsByBubbleId.get(row.id) ?? 0;
    return {
      id: row.id,
      title: row.title,
      emoji: row.emoji,
      color: row.color,
      depth,
      children: kids,
      directCount,
      totalCount: directCount + kids.reduce((sum, k) => sum + k.totalCount, 0),
    };
  };

  const roots = (childrenOf.get(null) ?? []).sort(byOrder).map((r) => build(r, 0));

  // A corrupt parent cycle leaves its members unreachable from any root;
  // surface them as top-level rather than silently dropping them.
  const orphans = rows.filter((r) => !seen.has(r.id)).sort(byOrder);
  for (const orphan of orphans) {
    if (!seen.has(orphan.id)) roots.push(build(orphan, 0));
  }

  return roots;
}

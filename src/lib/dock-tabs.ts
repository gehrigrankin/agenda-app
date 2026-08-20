/**
 * Pure reconciliation for the note dock's restored-tab verification (#79).
 *
 * A dock tab is just a note id round-tripped through sessionStorage — nothing
 * guarantees the id still names a live note this owner can see. This computes
 * the surviving tab list (and refreshed titles) from a live-title lookup,
 * dropping ids that were checked and came back dead while leaving any id
 * outside `checkedIds` untouched. The caller only reaches this function when
 * the lookup succeeded — on a failed lookup it skips this step entirely, so
 * the tabs are left alone rather than treated as dead. Closing a tab is a
 * separate, ordinary removal from the `notes` array upstream of this — once
 * gone, a dead id here can't resurrect it.
 */

export interface DockTabLike {
  id: string;
  title: string;
}

/**
 * @param notes Current dock tabs.
 * @param checkedIds Ids that were sent to the live-title lookup.
 * @param live Map of id -> title for ids confirmed still live.
 */
export function reconcileDockTabs<T extends DockTabLike>(
  notes: T[],
  checkedIds: ReadonlySet<string>,
  live: ReadonlyMap<string, string>,
): T[] {
  return notes
    .filter((n) => !checkedIds.has(n.id) || live.has(n.id))
    .map((n) => {
      const title = live.get(n.id);
      return title !== undefined && title !== n.title ? { ...n, title } : n;
    });
}

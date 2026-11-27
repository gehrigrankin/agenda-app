/**
 * Last step of `reconcileNoteTasks`.
 *
 * A checkbox leaving a note is treated as deleting that task. Subtasks are a
 * different structure — `tasks.parent_id`, created in the task details panel,
 * never serialized as note nodes. That FK is ON DELETE CASCADE, so deleting
 * the parent would wipe the checklist unless children are detached first.
 * Neon HTTP has no transactions: detach, then delete.
 */
export function orphanHardDeletePlan(orphanIds: readonly string[]): {
  detachChildrenOf: string[];
  deleteIds: string[];
} | null {
  if (orphanIds.length === 0) return null;
  const ids = [...orphanIds];
  return { detachChildrenOf: ids, deleteIds: ids };
}

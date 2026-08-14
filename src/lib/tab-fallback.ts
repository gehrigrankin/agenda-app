/**
 * Which tab should take focus after closing one, the way a code editor
 * picks: the tab that slid into the closed one's slot, else the tab before
 * it, else whichever tab is now last. `null` means no tabs are left. Shared
 * by the note dock and the main note view's tab strip so both close the same
 * way.
 */
export function pickTabFallback<T extends { id: string }>(
  tabs: T[],
  closedId: string,
): string | null {
  const index = tabs.findIndex((t) => t.id === closedId);
  if (index === -1) return null;
  const remaining = tabs.filter((t) => t.id !== closedId);
  const fallback = remaining[index] ?? remaining[index - 1] ?? remaining[remaining.length - 1];
  return fallback?.id ?? null;
}

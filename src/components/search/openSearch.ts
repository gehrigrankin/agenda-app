/**
 * Window event that opens the command palette from anywhere (the mobile
 * Search tab, the Notes page search field) without threading state through
 * the tree — the always-mounted CommandPalette listens for it.
 */
export const OPEN_SEARCH_EVENT = "agenda:open-search";

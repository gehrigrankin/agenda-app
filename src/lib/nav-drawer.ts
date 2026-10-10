/** Phone: open the main-nav drawer (pages reached from More use it as "back"). */
export const OPEN_NAV_DRAWER_EVENT = "agenda:open-nav-drawer";

export function openNavDrawer(): void {
  window.dispatchEvent(new CustomEvent(OPEN_NAV_DRAWER_EVENT));
}

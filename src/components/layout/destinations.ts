import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  CircleDashed,
  Flame,
  GitCommitVertical,
  Inbox,
  LayoutGrid,
  NotebookText,
  Settings,
  Sprout,
  SquareCheck,
  Sun,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";

/**
 * The single source of truth for app navigation. The docked main nav
 * (MainNav) and the phone tab bar / More sheet (AppShell) both render from
 * this list, so labels, icons and item sets cannot drift apart again — they
 * used to be two hand-maintained arrays and `/app` ended up as "Home" (House)
 * on desktop and "Today" (Sun) on the phone.
 *
 * Tiers (Notes Sidebars design §1):
 * - `primary` — the main nav's items, in order.
 * - `more`    — the More menu's first group (Threads moved here from the nav).
 * - `extra`   — the More menu's second group, below a divider: pages the
 *               design doesn't place, kept reachable.
 *
 * Phone tabs are the explicit `MOBILE_TAB_HREFS` subset of the primary tier;
 * the phone More sheet is every destination not in the tabs, in list order.
 */

export type DestinationTier = "primary" | "more" | "extra";

export interface Destination {
  href: string;
  label: string;
  icon: LucideIcon;
  tier: DestinationTier;
}

export const DESTINATIONS: readonly Destination[] = [
  { href: "/app", label: "Today", icon: Sun, tier: "primary" },
  { href: "/app/notes", label: "Notes", icon: NotebookText, tier: "primary" },
  { href: "/app/tasks", label: "Tasks", icon: SquareCheck, tier: "primary" },
  {
    href: "/app/calendar",
    label: "Calendar",
    icon: CalendarDays,
    tier: "primary",
  },
  { href: "/app/people", label: "People", icon: Users, tier: "primary" },
  { href: "/app/inbox", label: "Inbox", icon: Inbox, tier: "primary" },

  {
    href: "/app/threads",
    label: "Threads",
    icon: GitCommitVertical,
    tier: "more",
  },
  { href: "/app/trash", label: "Trash", icon: Trash2, tier: "more" },
  { href: "/app/settings", label: "Settings", icon: Settings, tier: "more" },

  { href: "/app/bubbles", label: "Canvas", icon: CircleDashed, tier: "extra" },
  { href: "/app/automations", label: "Rules", icon: Wand2, tier: "extra" },
  { href: "/app/gardener", label: "Garden", icon: Sprout, tier: "extra" },
  { href: "/app/habits", label: "Habits", icon: Flame, tier: "extra" },
  { href: "/app/boards", label: "Folders", icon: LayoutGrid, tier: "extra" },
] as const;

/** The four primary destinations that get their own phone tab, in bar order
 *  (the fifth tab is More, which opens the nav drawer). */
export const MOBILE_TAB_HREFS = [
  "/app",
  "/app/notes",
  "/app/tasks",
  "/app/calendar",
] as const;

/** `/app` matches exactly (every route is under it); everything else by prefix. */
export function isDestinationActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

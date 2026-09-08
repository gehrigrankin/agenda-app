import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  CircleDashed,
  Flame,
  GitCommitVertical,
  Inbox,
  LayoutGrid,
  NotebookText,
  Sprout,
  SquareCheck,
  Sun,
  Trash2,
  UserRound,
  Users,
  Wand2,
} from "lucide-react";

/**
 * The single source of truth for app navigation. The desktop rail (NavRail)
 * and the phone tab bar / More sheet (AppShell) both render from this list, so
 * labels, icons and item sets cannot drift apart again — they used to be two
 * hand-maintained arrays and `/app` ended up as "Home" (House) on desktop and
 * "Today" (Sun) on the phone.
 *
 * Tiers:
 * - `primary`   — the rail's top group.
 * - `utility`   — the rail's bottom group.
 * - `secondary` — reachable only from the phone More sheet (and the desktop
 *                 top bar / folder switcher); never shown on the rail.
 *
 * Phone tabs are the explicit `MOBILE_TAB_HREFS` subset of the primary tier;
 * the More sheet is every destination not in the tabs, in list order.
 */

export type DestinationTier = "primary" | "utility" | "secondary";

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
  {
    href: "/app/threads",
    label: "Threads",
    icon: GitCommitVertical,
    tier: "primary",
  },
  { href: "/app/people", label: "People", icon: Users, tier: "primary" },
  { href: "/app/inbox", label: "Inbox", icon: Inbox, tier: "primary" },

  {
    href: "/app/bubbles",
    label: "Canvas",
    icon: CircleDashed,
    tier: "utility",
  },
  { href: "/app/automations", label: "Rules", icon: Wand2, tier: "utility" },
  { href: "/app/gardener", label: "Garden", icon: Sprout, tier: "utility" },
  { href: "/app/trash", label: "Trash", icon: Trash2, tier: "utility" },

  {
    href: "/app/boards",
    label: "Folders",
    icon: LayoutGrid,
    tier: "secondary",
  },
  { href: "/app/habits", label: "Habits", icon: Flame, tier: "secondary" },
  {
    href: "/app/settings",
    label: "Profile",
    icon: UserRound,
    tier: "secondary",
  },
] as const;

/** The four primary destinations that get their own phone tab, in bar order. */
export const MOBILE_TAB_HREFS = [
  "/app",
  "/app/notes",
  "/app/calendar",
  "/app/tasks",
] as const;

/** `/app` matches exactly (every route is under it); everything else by prefix. */
export function isDestinationActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import {
  CalendarDays,
  Hash,
  NotebookPen,
  Search,
  Trash2,
} from "lucide-react";

/**
 * App sidebar scaffold. The folder/tag tree, pinned folders, and note list are
 * MVP features that render here — they're stubbed for now so the shell and
 * navigation exist. Data wiring lands with Note CRUD + the tag tree.
 */
export function Sidebar() {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2 px-4 py-3">
        <NotebookPen className="h-5 w-5" />
        <span className="font-semibold">Agenda</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 text-sm">
        <SidebarLink href="/app" icon={<CalendarDays className="h-4 w-4" />}>
          Today
        </SidebarLink>
        <SidebarLink href="/app" icon={<Search className="h-4 w-4" />}>
          Search
          <kbd className="ml-auto rounded border border-neutral-300 px-1 text-[10px] text-neutral-500 dark:border-neutral-700">
            ⌘K
          </kbd>
        </SidebarLink>
        <SidebarLink href="/app" icon={<Trash2 className="h-4 w-4" />}>
          Trash
        </SidebarLink>
      </nav>

      <div className="mt-4 px-4 text-xs font-medium uppercase tracking-wide text-neutral-400">
        Folders
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2 text-sm">
        {/* Placeholder tree — replaced by the tag hierarchy in the MVP. */}
        <div className="flex items-center gap-2 rounded px-2 py-1 text-neutral-400">
          <Hash className="h-4 w-4" />
          <span className="italic">No folders yet</span>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <UserButton afterSignOutUrl="/" />
        <span className="text-xs text-neutral-500">Account</span>
      </div>
    </aside>
  );
}

function SidebarLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {icon}
      {children}
    </Link>
  );
}

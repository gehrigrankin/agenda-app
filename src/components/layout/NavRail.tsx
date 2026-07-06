"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  CircleDashed,
  FileText,
  History,
  House,
  Loader2,
  Plus,
  SquareCheck,
  Trash2,
} from "lucide-react";

import { createNoteAction } from "@/app/app/actions";

/**
 * Floating left rail (desktop only): three glassy groups over the canvas —
 * primary nav, create/recents, utilities. Mobile navigation lives in the
 * bottom bar instead (see AppShell).
 */

export interface RecentNote {
  id: string;
  title: string;
}

const GROUP =
  "pointer-events-auto flex flex-col gap-1 rounded-2xl border border-white/10 bg-bar/92 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-[10px]";

function RailTile({
  href,
  icon,
  label,
  active,
  disabled,
  title,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const className = `flex w-[3.25rem] flex-col items-center gap-1 rounded-[0.6875rem] px-0 pb-[0.4375rem] pt-2 ${
    active
      ? "bg-sage/16 text-sage"
      : disabled
        ? "text-ink-400 opacity-40"
        : "text-ink-400 hover:bg-white/6"
  }`;
  const body = (
    <>
      {icon}
      <span
        className={`text-[0.5625rem] ${active ? "font-semibold" : "font-medium"}`}
      >
        {label}
      </span>
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <div className={className} title={title}>
      {body}
    </div>
  );
}

export function NavRail({ recents }: { recents: RecentNote[] }) {
  const pathname = usePathname();
  const [isCreating, startCreate] = useTransition();

  const isActive = (prefix: string) =>
    prefix === "/app" ? pathname === "/app" : pathname.startsWith(prefix);

  return (
    <div className="pointer-events-none absolute inset-y-0 left-[0.875rem] z-40 hidden flex-col justify-between py-4 md:flex">
      <div className="flex flex-col gap-2">
        {/* Primary nav */}
        <div className={GROUP}>
          <RailTile
            href="/app"
            active={isActive("/app")}
            icon={<House className="h-[1.0625rem] w-[1.0625rem]" />}
            label="Home"
          />
          <RailTile
            href="/app/notes"
            active={isActive("/app/notes")}
            icon={<FileText className="h-[1.0625rem] w-[1.0625rem]" />}
            label="Notes"
          />
          <RailTile
            href="/app/tasks"
            active={isActive("/app/tasks")}
            icon={<SquareCheck className="h-[1.0625rem] w-[1.0625rem]" />}
            label="Tasks"
          />
          <RailTile
            disabled
            title="Coming soon"
            icon={<CalendarDays className="h-[1.0625rem] w-[1.0625rem]" />}
            label="Calendar"
          />
        </div>

        {/* Create */}
        <div className={GROUP}>
          <button
            type="button"
            disabled={isCreating}
            onClick={() => startCreate(() => createNoteAction())}
            aria-label="New note"
            className="flex w-[3.25rem] flex-col items-center gap-[0.1875rem] rounded-[0.6875rem] bg-sage/16 pb-1.5 pt-2 text-sage hover:bg-sage/24 disabled:opacity-60"
          >
            {isCreating ? (
              <Loader2 className="h-[1.0625rem] w-[1.0625rem] animate-spin" />
            ) : (
              <Plus className="h-[1.0625rem] w-[1.0625rem]" />
            )}
            <ChevronDown className="h-2.5 w-2.5 opacity-70" />
          </button>
        </div>

        {/* Recents */}
        {recents.length > 0 && (
          <div className={GROUP}>
            <div className="flex w-[3.25rem] flex-col items-center rounded-[0.6875rem] pb-1.5 pt-[0.4375rem]">
              <History className="h-[0.8125rem] w-[0.8125rem] text-ink-600" />
            </div>
            {recents.map((n) => (
              <Link
                key={n.id}
                href={`/app/notes/${n.id}`}
                className="flex w-[3.25rem] flex-col items-center gap-1 rounded-[0.6875rem] px-0.5 pb-1.5 pt-[0.4375rem] text-ink-400 hover:bg-white/6"
              >
                <FileText className="h-[0.9375rem] w-[0.9375rem]" />
                <span className="max-w-[3rem] truncate text-[0.53125rem] font-medium">
                  {n.title || "Untitled"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Utilities */}
      <div className={GROUP}>
        <RailTile
          href="/app/bubbles"
          active={isActive("/app/bubbles")}
          icon={<CircleDashed className="h-4 w-4" />}
          label="Scratch"
        />
        <RailTile
          href="/app/trash"
          active={isActive("/app/trash")}
          icon={<Trash2 className="h-4 w-4" />}
          label="Trash"
        />
      </div>
    </div>
  );
}

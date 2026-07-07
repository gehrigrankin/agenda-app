"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  CircleDashed,
  FileText,
  GitCommitVertical,
  History,
  House,
  Inbox,
  Layers,
  Loader2,
  Plus,
  Sprout,
  SquareCheck,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";

import { createNoteAction, createStandaloneTaskAction } from "@/app/app/actions";
import { createBoardAction } from "@/app/app/bubbles/actions";
import { localDateString } from "@/lib/dates";
import type { BoardEntry } from "./TopBar";

/** Fired after a task is created outside the widgets, so they can refetch. */
export const TASKS_CHANGED_EVENT = "agenda:tasks-changed";

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

/**
 * The rail's + button: a create menu (note / task / board; calendar events
 * once they exist). Note creation redirects to the new note; task and board
 * ask for a title inline before creating.
 */
function CreateMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // null = plain menu; otherwise an inline title prompt for that kind.
  const [prompt, setPrompt] = useState<null | "task" | "board">(null);
  const [draft, setDraft] = useState("");
  const [isCreating, startCreate] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setPrompt(null);
    setDraft("");
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (prompt) inputRef.current?.focus();
  }, [prompt]);

  const submitPrompt = () => {
    const title = draft.trim();
    if (!title || isCreating) return;
    const kind = prompt;
    startCreate(async () => {
      try {
        if (kind === "task") {
          await createStandaloneTaskAction(title, localDateString());
          window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
        } else if (kind === "board") {
          const id = await createBoardAction(title);
          router.push(`/app/bubbles?b=${id}`);
        }
        close();
      } catch (err) {
        console.error("[create] failed:", err);
      }
    });
  };

  const ITEM =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.78125rem] text-ink-200 hover:bg-white/6";

  return (
    <div className="relative">
      <button
        type="button"
        disabled={isCreating}
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Create…"
        aria-expanded={open}
        className="flex w-[3.25rem] flex-col items-center gap-[0.1875rem] rounded-[0.6875rem] bg-sage/16 pb-1.5 pt-2 text-sage hover:bg-sage/24 disabled:opacity-60"
      >
        {isCreating ? (
          <Loader2 className="h-[1.0625rem] w-[1.0625rem] animate-spin" />
        ) : (
          <Plus className="h-[1.0625rem] w-[1.0625rem]" />
        )}
        <ChevronDown className="h-2.5 w-2.5 opacity-70" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close create menu"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="animate-pop-in absolute left-full top-0 z-50 ml-2 w-48 rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl">
            {prompt === null ? (
              <>
                <button
                  type="button"
                  disabled={isCreating}
                  onClick={() => {
                    // Close first: the action redirects, so its promise never
                    // resolves on the client — an open menu (and its full-
                    // screen backdrop) would survive navigation and swallow
                    // the first click on the new page.
                    close();
                    startCreate(() => createNoteAction());
                  }}
                  className={ITEM}
                >
                  <FileText className="h-3.5 w-3.5 text-sage" />
                  New note
                </button>
                <button
                  type="button"
                  onClick={() => setPrompt("task")}
                  className={ITEM}
                >
                  <SquareCheck className="h-3.5 w-3.5 text-sage" />
                  New task
                </button>
                <button
                  type="button"
                  onClick={() => setPrompt("board")}
                  className={ITEM}
                >
                  <Layers className="h-3.5 w-3.5 text-sage" />
                  New board
                </button>
                <div
                  title="Coming soon"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.78125rem] text-ink-600 opacity-60"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  New event
                  <span className="ml-auto text-[0.59375rem] uppercase tracking-wide">
                    soon
                  </span>
                </div>
              </>
            ) : (
              <div className="px-2 py-1.5">
                <p className="pb-1 text-[0.65625rem] font-medium uppercase tracking-wide text-ink-500">
                  {prompt === "task" ? "New task (due today)" : "New board"}
                </p>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitPrompt();
                  }}
                  placeholder={prompt === "task" ? "Task title…" : "Board name…"}
                  className="w-full border-b border-sage/50 bg-transparent px-0.5 py-1 text-[0.78125rem] text-ink-100 outline-none placeholder:text-ink-600"
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The rail's board switcher: same chrome as the + button but with the accent
 * dot, dropping down the list of boards (folder bubbles) to jump between.
 */
function BoardsRailMenu({ folders }: { folders: BoardEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch board…"
        aria-expanded={open}
        className="flex w-[3.25rem] flex-col items-center gap-[0.1875rem] rounded-[0.6875rem] bg-sage/16 pb-1.5 pt-2 text-sage hover:bg-sage/24"
      >
        <span className="flex h-[1.0625rem] w-[1.0625rem] items-center justify-center">
          <span className="h-2.5 w-2.5 rounded-full bg-sage" />
        </span>
        <ChevronDown className="h-2.5 w-2.5 opacity-70" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close boards menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="animate-pop-in absolute left-full top-0 z-50 ml-2 w-56 rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl">
            {folders.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-ink-500">
                No boards yet — mark a bubble as a folder to pin it here.
              </p>
            ) : (
              folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/app/bubbles?b=${f.id}`);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.78125rem] text-ink-200 hover:bg-white/6"
                >
                  {f.emoji ? (
                    <span className="w-4 text-center text-sm leading-none">
                      {f.emoji}
                    </span>
                  ) : (
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ background: f.color ?? "#9CC5AC" }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{f.title}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function NavRail({
  recents,
  folders,
}: {
  recents: RecentNote[];
  folders: BoardEntry[];
}) {
  const pathname = usePathname();

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
            href="/app/calendar"
            active={isActive("/app/calendar")}
            icon={<CalendarDays className="h-[1.0625rem] w-[1.0625rem]" />}
            label="Calendar"
          />
          <RailTile
            href="/app/threads"
            active={isActive("/app/threads")}
            icon={<GitCommitVertical className="h-[1.0625rem] w-[1.0625rem]" />}
            label="Threads"
          />
          <RailTile
            href="/app/people"
            active={isActive("/app/people")}
            icon={<Users className="h-[1.0625rem] w-[1.0625rem]" />}
            label="People"
          />
          <RailTile
            href="/app/inbox"
            active={isActive("/app/inbox")}
            icon={<Inbox className="h-[1.0625rem] w-[1.0625rem]" />}
            label="Inbox"
          />
        </div>

        {/* Create */}
        <div className={GROUP}>
          <CreateMenu />
        </div>

        {/* Board switcher */}
        <div className={GROUP}>
          <BoardsRailMenu folders={folders} />
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
          href="/app/automations"
          active={isActive("/app/automations")}
          icon={<Wand2 className="h-4 w-4" />}
          label="Rules"
        />
        <RailTile
          href="/app/gardener"
          active={isActive("/app/gardener")}
          icon={<Sprout className="h-4 w-4" />}
          label="Garden"
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

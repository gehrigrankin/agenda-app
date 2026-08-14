"use client";

import Link from "next/link";
import { Loader2, Plus } from "lucide-react";

import { CreateMenu } from "@/components/layout/CreateMenu";

/**
 * Boards page (design Turn 17l): a card per board (folder bubble) with its
 * note count and two freshest note titles. Tapping a card opens the board on
 * the bubbles canvas. Exists chiefly for the phone tab bar — on desktop the
 * rail's board switcher does the same job — but renders fine at any width.
 */

export interface BoardCard {
  id: string;
  title: string;
  emoji: string | null;
  color: string | null;
  count: number;
  recent: string[];
}

export function BoardsGrid({ boards }: { boards: BoardCard[] }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-2xl px-5 pb-6">
        <div className="flex items-center pb-3 pt-3.5">
          <h1 className="text-2xl font-semibold text-ink-100">Folders</h1>
          <span className="ml-auto text-xs text-ink-600">
            {boards.length} {boards.length === 1 ? "folder" : "folders"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {boards.map((b) => (
            <Link
              key={b.id}
              href={`/app/bubbles?b=${b.id}`}
              className="flex min-h-[8.125rem] flex-col gap-2 rounded-2xl border border-white/8 bg-white/3 p-3.5 hover:bg-white/5"
            >
              {b.emoji ? (
                <span className="text-[0.9375rem] leading-none">{b.emoji}</span>
              ) : (
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: b.color ?? "#9CC5AC" }}
                />
              )}
              <span className="text-[0.9375rem] font-semibold leading-tight text-ink-100">
                {b.title}
              </span>
              <span className="text-[0.6875rem] text-ink-600">
                {b.count} {b.count === 1 ? "note" : "notes"}
              </span>
              {b.recent.length > 0 && (
                <span className="mt-auto flex flex-col gap-1">
                  {b.recent.map((title, i) => (
                    <span
                      key={i}
                      className="truncate text-[0.71875rem] text-ink-400"
                    >
                      {title || "Untitled"}
                    </span>
                  ))}
                </span>
              )}
            </Link>
          ))}

          <NewBoardCard />
        </div>
      </div>
    </div>
  );
}

/**
 * The grid's trailing dashed row. It used to be a single-purpose "new folder"
 * prompt, which made the boards page the one surface where the + could only
 * make one kind of thing; it now opens the app's shared create menu and keeps
 * folders as one item in it.
 */
function NewBoardCard() {
  return (
    <div className="col-span-full">
      <CreateMenu
        placement="below-left"
        trigger={({ open, busy, toggle }) => (
          <button
            type="button"
            disabled={busy}
            onClick={toggle}
            aria-expanded={open}
            className="flex w-full min-h-14 items-center justify-center gap-2 rounded-2xl border border-dashed border-white/14 hover:bg-white/3 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
            ) : (
              <Plus className="h-4 w-4 text-ink-400" />
            )}
            <span className="text-[0.8125rem] font-medium text-ink-400">
              Create…
            </span>
          </button>
        )}
      />
    </div>
  );
}

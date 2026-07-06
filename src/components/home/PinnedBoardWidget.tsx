"use client";

import Link from "next/link";
import { Maximize2 } from "lucide-react";

/**
 * Pinned board (bottom widget row): the first folder bubble with two of its
 * note cards; the maximize control opens the board on the bubble map.
 */

export interface BoardData {
  id: string;
  title: string;
  color: string | null;
  notes: { id: string; title: string; preview: string }[];
}

export function PinnedBoardWidget({ board }: { board: BoardData | null }) {
  if (!board) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center">
        <p className="text-[0.6875rem] text-ink-600">
          Pin a board here — mark a bubble as a folder in Scratch.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 px-3 pb-1.5 pt-2.5">
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: board.color ?? "#9CC5AC" }}
        />
        <span className="truncate text-[0.78125rem] font-semibold text-ink-100">
          {board.title}
        </span>
        <span className="flex-none text-[0.65625rem] text-ink-600">
          pinned board
        </span>
        <Link
          href={`/app/bubbles?b=${board.id}`}
          aria-label="Open board"
          className="ml-auto flex h-5 w-5 flex-none items-center justify-center rounded-md hover:bg-white/6"
        >
          <Maximize2 className="h-[0.6875rem] w-[0.6875rem] text-ink-600" />
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden px-3 pb-2.5 pt-0.5">
        {board.notes.length === 0 ? (
          <p className="text-[0.6875rem] text-ink-600">No notes on this board yet.</p>
        ) : (
          board.notes.map((n) => (
            <Link
              key={n.id}
              href={`/app/notes/${n.id}`}
              className="min-w-0 flex-1 rounded-lg border border-white/7 bg-card-alt p-2.5 hover:border-white/15"
            >
              <p className="truncate text-[0.65625rem] font-medium leading-[1.3] text-ink-200">
                {n.title || "Untitled"}
              </p>
              <p className="mt-1 line-clamp-3 text-[0.5625rem] leading-[1.45] text-[#7B837F]">
                {n.preview || "Empty note"}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

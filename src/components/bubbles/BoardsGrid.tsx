"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { createBoardAction } from "@/app/app/bubbles/actions";

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
          <h1 className="text-2xl font-semibold text-ink-100">Boards</h1>
          <span className="ml-auto text-xs text-ink-600">
            {boards.length} {boards.length === 1 ? "board" : "boards"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {boards.map((b) => (
            <Link
              key={b.id}
              href={`/app/bubbles?b=${b.id}`}
              className="flex min-h-[8.125rem] flex-col gap-2 rounded-[0.8125rem] border border-white/8 bg-white/3 p-3.5 hover:bg-white/5"
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

function NewBoardCard() {
  const router = useRouter();
  const [prompting, setPrompting] = useState(false);
  const [draft, setDraft] = useState("");
  const [isCreating, startCreate] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prompting) inputRef.current?.focus();
  }, [prompting]);

  const submit = () => {
    const title = draft.trim();
    if (!title || isCreating) return;
    startCreate(async () => {
      try {
        const id = await createBoardAction(title);
        router.push(`/app/bubbles?b=${id}`);
      } catch (err) {
        console.error("[boards] create failed:", err);
      }
    });
  };

  if (prompting) {
    return (
      <div className="col-span-full flex min-h-14 items-center gap-2.5 rounded-[0.8125rem] border border-dashed border-white/14 px-4">
        <input
          ref={inputRef}
          value={draft}
          disabled={isCreating}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              setPrompting(false);
              setDraft("");
            }
          }}
          placeholder="Board name…"
          className="min-w-0 flex-1 border-b border-sage/50 bg-transparent py-1 text-sm text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-60"
        />
        {isCreating && (
          <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPrompting(true)}
      className="col-span-full flex min-h-14 items-center justify-center gap-2 rounded-[0.8125rem] border border-dashed border-white/14 hover:bg-white/3"
    >
      <Plus className="h-4 w-4 text-ink-400" />
      <span className="text-[0.8125rem] font-medium text-ink-400">
        New board
      </span>
    </button>
  );
}

"use client";

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { LexicalEditor } from "lexical";
import { $createTextNode, $getRoot } from "lexical";
import { $createHeadingNode } from "@lexical/rich-text";
import { Check, GitCommitVertical, NotebookText } from "lucide-react";
import Link from "next/link";

import {
  getWeekReviewAction,
  markWeekReviewInsertedAction,
  type WeekReviewResult,
} from "@/app/app/ai/actions";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { addDays, parseLocalDate } from "@/lib/dates";

/**
 * 14d — week in review: Sunday's daily note opens with a drafted retrospective
 * built from the week's daily notes (done / still open / threads that moved).
 * Renders only when the viewed day is a Sunday; fetches (and caches server
 * side) on mount, and offers a one-shot insert into the day's editor.
 */

/** "Jun 30" — month/day, no weekday (matches the caption's date range). */
function formatShort(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** "Thu" — short weekday label for a day-reference chip. */
function formatWeekday(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

function DayChips({ days }: { days: string[] }) {
  const unique = Array.from(new Set(days));
  if (unique.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {unique.map((d) => (
        <Link
          key={d}
          href={`/app?d=${d}`}
          className="rounded-md border border-steel/25 bg-steel/8 px-1.5 py-0.5 text-[0.65625rem] font-medium text-steel hover:bg-steel/15"
        >
          {formatWeekday(d)}
        </Link>
      ))}
    </div>
  );
}

export function WeekReviewCard({
  viewedDate,
  editorRef,
  dailyNoteId,
}: {
  viewedDate: string | null;
  editorRef: MutableRefObject<LexicalEditor | null>;
  dailyNoteId: string | null;
}) {
  const isSunday = useMemo(() => {
    if (!viewedDate) return false;
    return new Date(`${viewedDate}T00:00:00`).getDay() === 0;
  }, [viewedDate]);

  const weekStart = viewedDate && isSunday ? addDays(viewedDate, -6) : null;
  const weekEnd = viewedDate;

  // undefined = loading, null = nothing to show (unconfigured / empty draft).
  const [result, setResult] = useState<WeekReviewResult | null | undefined>(
    undefined,
  );
  const [inserted, setInserted] = useState(false);

  useEffect(() => {
    if (!weekStart || !weekEnd) return;
    let cancelled = false;
    setResult(undefined);
    setInserted(false);
    const startIso = new Date(`${weekStart}T00:00:00`).toISOString();
    const endIso = new Date(
      `${addDays(weekEnd, 1)}T00:00:00`,
    ).toISOString();
    getWeekReviewAction(weekStart, startIso, endIso)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        console.error("[week-review] load failed:", err);
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd]);

  if (!isSunday || !weekStart || !weekEnd) return null;

  if (result === undefined) {
    return (
      <div className="rounded-2xl border border-white/9 bg-panel/94 p-5 shadow-[0_14px_34px_rgba(0,0,0,0.35)]">
        <p className="animate-pulse text-[0.8125rem] text-ink-500">
          drafting your week…
        </p>
      </div>
    );
  }

  if (!result || (!result.content.done && !result.content.stillOpen)) {
    return null;
  }

  const { content } = result;
  const showInserted = inserted || result.inserted;

  const insert = () => {
    const editor = editorRef.current;
    if (!editor || !dailyNoteId || showInserted) return;
    editor.update(() => {
      const root = $getRoot();

      const h = $createHeadingNode("h2");
      h.append($createTextNode("Week in review"));
      root.append(h);

      const done = $createTimedParagraphNode();
      done.append($createTextNode(`Done — ${content.done}`));
      root.append(done);

      const stillOpen = $createTimedParagraphNode();
      stillOpen.append($createTextNode(`Still open — ${content.stillOpen}`));
      root.append(stillOpen);

      if (content.threads.length > 0) {
        const threads = $createTimedParagraphNode();
        threads.append(
          $createTextNode(
            `Threads that moved: ${content.threads
              .map((t) => `${t.topic} (${t.mentions})`)
              .join(" · ")}`,
          ),
        );
        root.append(threads);
      }
    });
    markWeekReviewInsertedAction(weekStart, dailyNoteId).catch((err) => {
      console.error("[week-review] mark inserted failed:", err);
    });
    setInserted(true);
  };

  return (
    <div className="rounded-2xl border border-white/9 bg-panel/94 shadow-[0_14px_34px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2.5 border-b border-white/7 px-4 py-3">
        <NotebookText className="h-3.5 w-3.5 flex-none text-sage" />
        <span className="text-[0.84375rem] font-semibold text-ink-100">
          Your week
        </span>
        <span className="text-[0.6875rem] text-ink-600">
          {formatShort(weekStart)} – {formatShort(weekEnd)} · drafted for your
          weekly review
        </span>
        <button
          type="button"
          onClick={insert}
          disabled={!editorRef.current || !dailyNoteId || showInserted}
          className="ml-auto flex flex-none items-center gap-1.5 rounded-lg bg-sage px-2.5 py-1.5 text-[0.65625rem] font-semibold text-sage-ink disabled:opacity-50"
        >
          <Check className="h-[0.6875rem] w-[0.6875rem] text-sage-ink" />
          {showInserted ? "Inserted ✓" : "Insert into Sunday"}
        </button>
      </div>

      <div className="flex flex-col gap-3.5 px-[1.375rem] py-4">
        {content.done && (
          <div>
            <div className="mb-1.5 text-[0.625rem] font-medium uppercase tracking-[0.09em] text-sage">
              Done
            </div>
            <p className="text-[0.8125rem] leading-[1.7] text-ink-300">
              {content.done}
            </p>
            <DayChips days={content.doneDays} />
          </div>
        )}

        {content.stillOpen && (
          <div>
            <div className="mb-1.5 text-[0.625rem] font-medium uppercase tracking-[0.09em] text-[#d9938a]">
              Still open
            </div>
            <p className="text-[0.8125rem] leading-[1.7] text-ink-300">
              {content.stillOpen}
            </p>
            <DayChips days={content.openDays} />
          </div>
        )}

        {content.threads.length > 0 && (
          <div>
            <div className="mb-1.5 text-[0.625rem] font-medium uppercase tracking-[0.09em] text-steel">
              Threads that moved
            </div>
            <div className="flex flex-wrap gap-1.5">
              {content.threads.map((t) => (
                <span
                  key={t.topic}
                  className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/4 px-2.5 py-1.5 text-[0.6875rem] font-medium text-ink-300"
                >
                  <GitCommitVertical className="h-[0.6875rem] w-[0.6875rem] text-steel" />
                  {t.topic} · {t.mentions} mention{t.mentions === 1 ? "" : "s"}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History, Maximize2 } from "lucide-react";

import { getDaySummaryAction, type DaySummaryResult } from "@/app/app/actions";
import { addDays, formatShortDate, localDayBounds } from "@/lib/dates";

/**
 * Yesterday recap (bottom widget row): note/link/task counts + the first line
 * of yesterday's daily note. The maximize control views that day on the home.
 */
export function YesterdayWidget({ today }: { today: string | null }) {
  const [summary, setSummary] = useState<DaySummaryResult | null>(null);
  const yesterday = today ? addDays(today, -1) : null;

  useEffect(() => {
    if (!yesterday) return;
    let cancelled = false;
    const { start, end } = localDayBounds(yesterday);
    getDaySummaryAction(yesterday, start.toISOString(), end.toISOString())
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err) => console.error("[yesterday] load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [yesterday]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 px-3 pb-1.5 pt-2.5">
        <History className="h-[0.8125rem] w-[0.8125rem] text-ink-400" />
        <span className="text-[0.78125rem] font-semibold text-ink-300">
          Yesterday
        </span>
        {yesterday && (
          <span className="whitespace-nowrap text-[0.65625rem] text-ink-600">
            {formatShortDate(yesterday)}
          </span>
        )}
        {yesterday && (
          <Link
            href={`/app?d=${yesterday}`}
            aria-label="View yesterday"
            className="ml-auto flex h-5 w-5 items-center justify-center rounded-md hover:bg-white/6"
          >
            <Maximize2 className="h-[0.6875rem] w-[0.6875rem] text-ink-600" />
          </Link>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 pb-2.5 pt-0.5">
        {summary === null ? (
          <span className="text-[0.6875rem] text-ink-600">—</span>
        ) : (
          <>
            <span className="text-[0.6875rem] leading-normal text-[#7B837F]">
              {summary.notesEdited} note{summary.notesEdited === 1 ? "" : "s"} ·{" "}
              {summary.linksCreated} link{summary.linksCreated === 1 ? "" : "s"}{" "}
              · {summary.tasksDone} task{summary.tasksDone === 1 ? "" : "s"}{" "}
              done
            </span>
            {summary.firstLine && (
              <span className="line-clamp-2 text-[0.6875rem] leading-normal text-ink-600">
                “{summary.firstLine}”
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

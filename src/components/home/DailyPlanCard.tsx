"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import { Bell, Check, Repeat, Sparkles, X } from "lucide-react";

import {
  listTasksDueAction,
  listTasksUpcomingAction,
  type DueTaskResult,
} from "@/app/app/actions";
import { $createTaskNode } from "@/components/editor/nodes/TaskNode";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { addDays } from "@/lib/dates";
import { recurrenceChipLabel, formatTimeShort } from "@/lib/recurrence";

/**
 * Deterministic "morning plan" proposal shown inside an empty today's daily
 * note (design Turn 11b): carried-over tasks, tasks due today (including
 * materialized recurring occurrences), and tasks due tomorrow — pruned by the
 * user, then inserted as real task checkboxes. No AI, no writes until accept.
 */

const DISMISSED_KEY = "daily-plan-dismissed";
const MAX_ROWS = 6;

type RowKind = "carried" | "today" | "tomorrow";

type ProposalRow = {
  id: string;
  title: string;
  dueAt: string;
  kind: RowKind;
  remindAt: string | null;
  recurring: DueTaskResult["recurring"];
  carriedDays: number;
};

/** Whole calendar days between two YYYY-MM-DD strings (UTC math, no TZ traps). */
function daysBetween(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

function buildRows(
  due: DueTaskResult[],
  upcoming: DueTaskResult[],
  dateStr: string,
): ProposalRow[] {
  const tomorrowStr = addDays(dateStr, 1);
  const carried: ProposalRow[] = [];
  const today: ProposalRow[] = [];
  for (const t of due) {
    const day = t.dueAt.slice(0, 10);
    if (day < dateStr) {
      carried.push({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt,
        kind: "carried",
        remindAt: t.remindAt,
        recurring: t.recurring,
        carriedDays: daysBetween(day, dateStr),
      });
    } else if (day === dateStr) {
      today.push({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt,
        kind: "today",
        remindAt: t.remindAt,
        recurring: t.recurring,
        carriedDays: 0,
      });
    }
  }
  const tomorrow: ProposalRow[] = upcoming
    .filter((t) => t.dueAt.slice(0, 10) === tomorrowStr)
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt,
      kind: "tomorrow" as const,
      remindAt: t.remindAt,
      recurring: t.recurring,
      carriedDays: 0,
    }));
  return [...carried, ...today, ...tomorrow].slice(0, MAX_ROWS);
}

function RowChip({ row }: { row: ProposalRow }) {
  if (row.kind === "carried") {
    return (
      <span className="flex-none rounded-[0.25rem] bg-[#D9938A]/10 px-1.5 py-[0.1875rem] text-[0.59375rem] font-medium text-[#D9938A]">
        carried {row.carriedDays} day{row.carriedDays === 1 ? "" : "s"}
      </span>
    );
  }
  if (row.kind === "today") {
    if (row.recurring) {
      return (
        <span className="flex flex-none items-center gap-1 rounded-[0.25rem] bg-sage/10 px-1.5 py-[0.1875rem] text-[0.59375rem] font-medium text-sage">
          <Repeat className="h-2.5 w-2.5" />
          {recurrenceChipLabel(row.recurring)}
        </span>
      );
    }
    if (row.remindAt) {
      return (
        <span className="flex flex-none items-center gap-1 rounded-[0.25rem] bg-[#D9B78A]/10 px-1.5 py-[0.1875rem] text-[0.59375rem] font-medium text-[#D9B78A]">
          <Bell className="h-2.5 w-2.5" />
          {formatTimeShort(row.remindAt)}
        </span>
      );
    }
    return null;
  }
  return (
    <span className="flex-none rounded-[0.25rem] bg-white/6 px-1.5 py-[0.1875rem] text-[0.59375rem] font-medium text-ink-400">
      due tomorrow
    </span>
  );
}

export function DailyPlanCard({
  dateStr,
  editorRef,
  onInserted,
}: {
  /** The viewed day; guaranteed to be today by the parent. */
  dateStr: string;
  editorRef: RefObject<LexicalEditor | null>;
  onInserted?: () => void;
}) {
  // null = loading; [] = nothing to propose (renders nothing either way).
  const [allRows, setAllRows] = useState<ProposalRow[] | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => {
    setAllRows(null);
    setRemovedIds(new Set());
    const fetchRows = () =>
      Promise.all([
        listTasksDueAction(dateStr),
        listTasksUpcomingAction(dateStr),
      ]);
    // One retry: this fires at page load alongside every other home widget's
    // action call, exactly when a dropped fetch is most likely — and a silent
    // failure here means the morning card never appears at all.
    fetchRows()
      .catch(
        () => new Promise((r) => setTimeout(r, 1500)).then(fetchRows),
      )
      .then(([due, upcoming]) => {
        setAllRows(buildRows(due, upcoming, dateStr));
      })
      .catch((err) => {
        console.error("[daily-plan] load failed:", err);
        setAllRows([]);
      });
  }, [dateStr]);

  useEffect(() => {
    load();
  }, [load]);

  if (hidden || allRows === null || allRows.length === 0) return null;

  const visibleRows = allRows.filter((r) => !removedIds.has(r.id));
  const carriedCount = allRows.filter((r) => r.kind === "carried").length;
  const recurringCount = allRows.filter(
    (r) => r.kind === "today" && r.recurring,
  ).length;
  const tomorrowCount = allRows.filter((r) => r.kind === "tomorrow").length;

  const summaryParts: string[] = [];
  if (carriedCount > 0) {
    summaryParts.push(
      `${carriedCount} carried task${carriedCount === 1 ? "" : "s"}`,
    );
  }
  if (recurringCount > 0) summaryParts.push(`${recurringCount} recurring`);
  if (tomorrowCount > 0) summaryParts.push(`${tomorrowCount} due tomorrow`);
  const summary = summaryParts.length ? `from ${summaryParts.join(" · ")}` : "";

  const removeRow = (id: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const insert = () => {
    const editor = editorRef.current;
    if (!editor || visibleRows.length === 0) return;
    editor.update(() => {
      const root = $getRoot();
      const lead = $createTimedParagraphNode();
      root.append(lead);
      for (const row of visibleRows) {
        root.append(
          $createTaskNode({
            taskId: row.id,
            title: row.title,
            completed: false,
            dueAt: row.dueAt,
          }),
        );
      }
      const trailing = $createTimedParagraphNode();
      root.append(trailing);
      trailing.select();
    });
    onInserted?.();
    setHidden(true);
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, dateStr);
    } catch {
      // localStorage unavailable — the card just won't stay dismissed.
    }
    setHidden(true);
  };

  return (
    <div className="overflow-hidden rounded-[0.875rem] border border-sage/28 bg-sage/5">
      <div className="flex items-center gap-2 border-b border-sage/15 px-4 py-3">
        <Sparkles className="h-3.5 w-3.5 flex-none text-sage" />
        <span className="text-[0.8125rem] font-semibold text-ink-100">
          Today&rsquo;s plan, drafted
        </span>
        {summary && (
          <span className="truncate text-[0.6875rem] text-ink-600">{summary}</span>
        )}
        <button
          type="button"
          onClick={load}
          className="ml-auto flex-none text-[0.65625rem] font-medium text-ink-400 hover:text-ink-300"
        >
          Regenerate
        </button>
      </div>

      <div className="flex flex-col p-2">
        {visibleRows.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/4"
          >
            <span className="h-[0.9375rem] w-[0.9375rem] flex-none rounded-[0.25rem] border-[1.5px] border-ink-700" />
            <span className="min-w-0 flex-1 truncate text-[0.84375rem] text-ink-200">
              {row.title}
            </span>
            <RowChip row={row} />
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              aria-label="Remove from plan"
              className="flex-none text-ink-600 hover:text-ink-300"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-sage/15 px-4 py-2.5">
        <button
          type="button"
          onClick={insert}
          disabled={visibleRows.length === 0}
          className="flex flex-none items-center gap-1.5 rounded-lg bg-sage px-3.5 py-2 text-[0.75rem] font-semibold text-sage-ink disabled:opacity-50"
        >
          <Check className="h-3 w-3 text-sage-ink" />
          Insert into today
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="flex-none rounded-lg px-3 py-2 text-[0.75rem] font-medium text-ink-400 hover:bg-white/5"
        >
          Dismiss
        </button>
        <span className="ml-auto truncate text-[0.65625rem] text-ink-600">
          nothing is added to your note until you accept
        </span>
      </div>
    </div>
  );
}

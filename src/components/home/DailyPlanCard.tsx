"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import Link from "next/link";
import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import { Bell, Check, CornerLeftUp, Repeat, Sparkles, X } from "lucide-react";

import { listTasksDueAction, type DueTaskResult } from "@/app/app/actions";
import { $createTaskNode } from "@/components/editor/nodes/TaskNode";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { recurrenceChipLabel, formatTimeShort } from "@/lib/recurrence";

/**
 * Deterministic "morning plan" proposal shown inside an empty today's daily
 * note (design Turn 11b): tasks DUE TODAY (including materialized recurring
 * occurrences) — pruned by the user, then inserted as real task checkboxes.
 * No AI, no writes until accept, and insert adds exactly what's listed.
 *
 * Carried tasks are deliberately NOT re-listed here — their one home is the
 * tasks widget's CARRIED OVER section (CONTEXT.md §product coherence); this
 * card only references the count with a deep link. Availability is reported
 * up to DailyStack (`onStatusChange`), which decides whether the card gets
 * the home's single full slot or a digest chip; `collapsed` keeps the card
 * mounted (fetching, reporting) while rendering nothing.
 */

const DISMISSED_KEY = "daily-plan-dismissed";
const MAX_ROWS = 6;

type ProposalRow = {
  id: string;
  title: string;
  dueAt: string;
  remindAt: string | null;
  recurring: DueTaskResult["recurring"];
};

/** Past-due counts, split by the star — the card's one line is toned by it. */
type CarriedCounts = { important: number; calm: number };

function buildRows(
  due: DueTaskResult[],
  dateStr: string,
): { rows: ProposalRow[]; carried: CarriedCounts } {
  const rows: ProposalRow[] = [];
  const carried: CarriedCounts = { important: 0, calm: 0 };
  for (const t of due) {
    const day = t.dueAt.slice(0, 10);
    if (day < dateStr) {
      if (t.important) carried.important += 1;
      else carried.calm += 1;
    } else if (day === dateStr) {
      rows.push({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt,
        remindAt: t.remindAt,
        recurring: t.recurring,
      });
    }
  }
  return { rows: rows.slice(0, MAX_ROWS), carried };
}

/** Quiet recurring/reminder chip for a proposed row — recurring wins. */
function RowChip({ row }: { row: ProposalRow }) {
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

export function DailyPlanCard({
  dateStr,
  editorRef,
  onInserted,
  collapsed = false,
  onStatusChange,
}: {
  /** The viewed day; guaranteed to be today by the parent. */
  dateStr: string;
  editorRef: RefObject<LexicalEditor | null>;
  onInserted?: () => void;
  /** Stay mounted (fetch + report) but render nothing. */
  collapsed?: boolean;
  /** null while loading; count = rows currently proposed (digest chip). */
  onStatusChange?: (available: boolean | null, count?: number) => void;
}) {
  // null = loading; [] = nothing to propose (renders nothing either way).
  const [allRows, setAllRows] = useState<ProposalRow[] | null>(null);
  const [carried, setCarried] = useState<CarriedCounts>({
    important: 0,
    calm: 0,
  });
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => {
    setAllRows(null);
    setRemovedIds(new Set());
    const fetchRows = () => listTasksDueAction(dateStr);
    // One retry: this fires at page load alongside every other home widget's
    // action call, exactly when a dropped fetch is most likely — and a silent
    // failure here means the morning card never appears at all.
    fetchRows()
      .catch(() => new Promise((r) => setTimeout(r, 1500)).then(fetchRows))
      .then((due) => {
        const { rows, carried: carriedCounts } = buildRows(due, dateStr);
        setAllRows(rows);
        setCarried(carriedCounts);
      })
      .catch((err) => {
        console.error("[daily-plan] load failed:", err);
        setAllRows([]);
      });
  }, [dateStr]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleRows = allRows
    ? allRows.filter((r) => !removedIds.has(r.id))
    : [];

  const available: boolean | null = hidden
    ? false
    : allRows === null
      ? null
      : allRows.length > 0;
  useEffect(() => {
    onStatusChange?.(available, visibleRows.length);
  }, [available, visibleRows.length, onStatusChange]);

  if (collapsed || hidden || allRows === null || allRows.length === 0) {
    return null;
  }

  const recurringCount = allRows.filter((r) => r.recurring).length;
  const summary =
    recurringCount > 0
      ? `${recurringCount} recurring · due today only`
      : "due today only";

  // One line, two tones. Red only appears when something the user actually
  // starred is past due; a pile of unstarred slippage stays calm blue, which
  // is the whole point of the split. Naming the starred half "overdue" and
  // the rest "carried" keeps the wording the same as the widget's headers.
  const carriedTone =
    carried.important > 0 ? "text-overdue" : "text-overdue-calm";
  const carriedLabel =
    carried.important > 0
      ? carried.calm > 0
        ? `${carried.important} overdue · ${carried.calm} carried →`
        : `${carried.important} overdue from earlier days →`
      : `${carried.calm} carried from earlier days →`;

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
    <div className="overflow-hidden rounded-[0.8125rem] border border-sage/28 bg-sage/5">
      <div className="flex items-center gap-2 border-b border-sage/15 px-4 py-3">
        <Sparkles className="h-3.5 w-3.5 flex-none text-sage" />
        <span className="text-[0.8125rem] font-semibold text-ink-100">
          Today&rsquo;s plan, drafted
        </span>
        <span className="truncate text-[0.6875rem] text-ink-600">{summary}</span>
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

      {/* Carried tasks live in the tasks widget's CARRIED OVER section —
          referenced here as a count only, never re-rendered as rows. Desktop
          anchors to the widget beside the note; phone links the tasks page. */}
      {carried.important + carried.calm > 0 && (
        <div className="flex items-center gap-1.5 px-4 pb-2.5">
          <CornerLeftUp className={`h-3 w-3 flex-none ${carriedTone}`} />
          <a
            href="#tasks-widget"
            className={`text-[0.6875rem] max-md:hidden ${
              carried.important > 0
                ? "text-ink-500 hover:text-ink-300"
                : "text-overdue-calm/85 hover:text-overdue-calm"
            }`}
          >
            {carriedLabel}
          </a>
          <Link
            href="/app/tasks"
            className={`text-[0.6875rem] md:hidden ${
              carried.important > 0 ? "text-ink-500" : "text-overdue-calm/85"
            }`}
          >
            {carriedLabel}
          </Link>
        </div>
      )}

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

"use client";

import { Check, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";

import type { UnscheduledTaskResult } from "@/app/app/actions";
import { SIDEBAR_FOCUS, SidebarIconButton } from "@/components/layout/sidebar";
import { monthCells, stepAnchor } from "@/lib/calendar-grid";
import { parseLocalDate } from "@/lib/dates";

import { TASK_DRAG_TYPE } from "./calendar-items";

/**
 * Sidebar 1 pieces of the desktop/tablet Calendar (design §5c): the mini
 * month, the CALENDARS layer toggles, and the UNSCHEDULED task chips (also
 * reused as the tablet's horizontal chip row above the grid, §6c).
 */

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export function MiniMonth({
  month,
  onMonth,
  today,
  rangeDays,
  onPick,
}: {
  /** Any day inside the shown month. */
  month: string;
  onMonth: (month: string) => void;
  today: string | null;
  /** Days of the main view's visible range (tinted). */
  rangeDays: Set<string>;
  onPick: (date: string) => void;
}) {
  const cells = monthCells(month);
  const title = parseLocalDate(month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return (
    <div className="flex-none px-3 pt-3 pb-2">
      <div className="mb-1.5 flex items-center gap-1 pl-1">
        <h3 className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-ink-100">
          {title}
        </h3>
        <SidebarIconButton
          icon={ChevronLeft}
          label="Previous month"
          onClick={() => onMonth(stepAnchor(month, "month", -1))}
        />
        <SidebarIconButton
          icon={ChevronRight}
          label="Next month"
          onClick={() => onMonth(stepAnchor(month, "month", 1))}
        />
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center" role="grid">
        {LETTERS.map((l, i) => (
          <span
            key={i}
            className="py-1 font-mono text-[0.6875rem] text-ink-600"
            aria-hidden
          >
            {l}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <span key={`p-${i}`} />
          ) : (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-label={parseLocalDate(d).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              aria-current={d === today ? "date" : undefined}
              className={`mx-auto flex h-[2rem] w-full max-w-[2.25rem] items-center justify-center rounded-md text-[0.8125rem] tabular-nums transition-colors touch:h-[2.75rem] ${SIDEBAR_FOCUS} ${
                d === today
                  ? "bg-sage font-semibold text-sage-ink"
                  : rangeDays.has(d)
                    ? "bg-white/8 text-ink-100 hover:bg-white/12"
                    : "text-ink-400 hover:bg-white/6 hover:text-ink-100"
              }`}
            >
              {Number(d.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/** A checkbox row in CALENDARS: colored box, label, optional indent. */
export function LayerRow({
  label,
  color,
  checked,
  onChange,
  indent = false,
  dashed = false,
  disabled = false,
}: {
  label: string;
  color: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  indent?: boolean;
  dashed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex min-h-[2.3rem] w-full items-center gap-2.5 pr-3 text-left text-[0.875rem] transition-colors touch:min-h-[3.4rem] disabled:opacity-50 ${SIDEBAR_FOCUS} ${
        checked ? "text-ink-200" : "text-ink-500"
      } hover:bg-white/4`}
      style={{ paddingLeft: indent ? "2.5rem" : "1rem" }}
    >
      <span
        aria-hidden
        className={`flex h-[0.9375rem] w-[0.9375rem] flex-none items-center justify-center rounded-[0.25rem] border ${
          dashed ? "border-dashed" : ""
        }`}
        style={{
          borderColor: color,
          backgroundColor: checked
            ? `color-mix(in srgb, ${color} ${dashed ? 25 : 70}%, transparent)`
            : "transparent",
        }}
      >
        {checked && (
          <Check
            className={`h-2.5 w-2.5 ${dashed ? "text-ink-100" : "text-sage-ink"}`}
            strokeWidth={3}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/** A draggable unscheduled task. Click arms it for tap-to-place. */
export function UnscheduledChip({
  task,
  armed,
  onArm,
  onDragState,
  inline = false,
}: {
  task: UnscheduledTaskResult;
  armed: boolean;
  onArm: () => void;
  onDragState: (dragging: boolean) => void;
  /** Tablet chip row: auto width, single line. */
  inline?: boolean;
}) {
  return (
    <button
      type="button"
      draggable
      aria-pressed={armed}
      title={`${task.title} — drag onto the calendar, or click then pick a time`}
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragState(true);
      }}
      onDragEnd={() => onDragState(false)}
      onClick={onArm}
      className={`flex min-w-0 cursor-grab items-center gap-1.5 rounded-md border pr-2.5 pl-1.5 text-left text-[0.8125rem] transition-colors active:cursor-grabbing ${SIDEBAR_FOCUS} ${
        inline
          ? "h-[2.3rem] max-w-[16rem] flex-none touch:h-11"
          : "min-h-[2.3rem] w-full py-1 touch:min-h-11"
      } ${
        armed
          ? "border-sage/60 bg-sage/14 text-ink-100"
          : "border-white/8 bg-white/[0.03] text-ink-250 hover:border-white/14 hover:text-ink-100"
      }`}
    >
      <GripVertical className="h-3.5 w-3.5 flex-none text-ink-600" />
      <span className="min-w-0 truncate">{task.title}</span>
    </button>
  );
}

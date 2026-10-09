"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef } from "react";

import { DOW_SHORT, dayOfMonth, formatClock, weekdayIndex, weekdayLong } from "@/lib/agenda-today";
import {
  buildSpread,
  spreadSubjects,
  type SpreadColumn,
  type SpreadEntry,
  type SpreadSubject,
} from "@/lib/agenda-spread";
import { subjectColor } from "@/lib/subjects";

import { CheckGlyph, NotesMark } from "./atoms";
import { WeekTitle, type WeekDay } from "./WeekViews";

/**
 * The week SPREAD — the phone's Week screen, and the page a school agenda
 * opens to: the whole week at once, ruled into days by subjects, every cell
 * blank or holding a few short entries. You read the week here and tap a
 * day or a cell to zoom into the day page.
 *
 * A phone is tall, not wide, so the spread is rotated from the paper one:
 * days run DOWN as rows (all seven share one screen; a busy row grows) and
 * the subjects run ACROSS as columns that scroll sideways, two visible at a
 * time and the next one peeking in to invite the scroll. The day labels stay
 * pinned on the left and the subject labels pinned on top, so the eye never
 * loses the row or the column; the scroll snaps per column so a cell is
 * never half-read. Which columns, and what lands where, is
 * `src/lib/agenda-spread.ts`.
 *
 * Today's row carries the ribbon (a sage bar on its edge, the sage date);
 * past rows read dimmer with their done entries struck, the record quieter
 * than the plan; a late entry reads in the overdue tone on the day it was
 * missed and on today.
 */

/** Width of the pinned day-label column. Keep in sync with `scroll-pl-14`. */
const DAY_COL = "3.5rem";

/** Entries a cell prints before folding the rest into "+N". */
const CELL_LIMIT = 3;

/** Sticky surfaces need an opaque background or the cells scroll through. */
const STICKY_BG = "bg-canvas";

const RULE = "border-b border-r border-white/7";

export function WeekSpread({
  weekStart,
  days,
  today,
  lines,
  subjects,
  loading,
  onPrevWeek,
  onNextWeek,
  onOpenDay,
}: {
  weekStart: string;
  /** Exactly 7 days, Monday first. */
  days: WeekDay[];
  today: string;
  /** The agenda's pinned lines, in print order. */
  lines: SpreadSubject[];
  /** Every subject (tag) the owner has. */
  subjects: SpreadSubject[];
  /** True until the week has loaded once — draws placeholder columns. */
  loading: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onOpenDay: (date: string) => void;
}) {
  const { columns, rows } = useMemo(() => {
    const spreadDays = days.map((d) => ({
      date: d.date,
      events: d.view?.events ?? [],
      tasks: d.view?.tasks ?? [],
    }));
    return buildSpread(spreadDays, spreadSubjects(lines, subjects, spreadDays));
  }, [days, lines, subjects]);

  // Seven rows normally fit; when they don't, today's row is the one to land
  // on. `nearest` keeps it a no-op whenever the row is already on screen.
  const todayRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [weekStart]);

  const placeholder = loading && rows.every((r) => r.cells.every((c) => c.length === 0));
  const colCount = placeholder ? 2 : columns.length;
  const hasSubjects = columns.some((c) => c.kind === "subject");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WeekTitle weekStart={weekStart} onPrev={onPrevWeek} onNext={onNextWeek} wide={false} />
      {!loading && !hasSubjects && (
        <div className="flex flex-none items-center gap-1.5 px-4 pb-2 text-[0.75rem] leading-none text-ink-500">
          No subjects this week.
          <Link href="/app/settings#agenda-lines" className="font-medium text-sage">
            Pin some
          </Link>
          to print them every week.
        </div>
      )}
      {/* @container sizes the columns against the scroller itself (cqw), not
          the viewport. scroll-pl-14 is the day column's width: a snapped
          column lands right after the pinned labels, not underneath them. */}
      <div className="@container min-h-0 flex-1 snap-x snap-mandatory overflow-auto overscroll-x-contain scroll-pl-14 border-t border-white/7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          className="grid min-h-full"
          style={{
            // Two subjects on screen, a sliver of the third as the cue to
            // scroll; never narrower than a readable entry.
            gridTemplateColumns: `${DAY_COL} repeat(${colCount}, max(8.5rem, calc((100cqw - ${DAY_COL} - 2.25rem) / 2)))`,
            // The seven rows share the page: a quiet week still fills it
            // (min-h-full + 1fr), a busy row grows past its share.
            gridTemplateRows: "auto repeat(7, minmax(3.75rem, 1fr))",
          }}
        >
          {/* Header row: the corner, then one label per column. */}
          <div aria-hidden className={`sticky left-0 top-0 z-30 ${STICKY_BG} ${RULE}`} />
          {placeholder
            ? Array.from({ length: colCount }).map((_, i) => (
                <div key={i} className={`sticky top-0 z-20 ${STICKY_BG} ${RULE} px-2.5 py-2.5`}>
                  <span className="block h-2 w-12 animate-pulse rounded bg-white/8" />
                </div>
              ))
            : columns.map((col) => <ColumnHeader key={col.id} column={col} />)}

          {rows.map((row, i) => {
            const isToday = row.date === today;
            const isPast = row.date < today;
            const rowBg = isToday ? "bg-sage/4" : "";
            const hasNote = (days[i]?.noteText ?? "").trim() !== "";
            return (
              <Fragment key={row.date}>
                <button
                  ref={isToday ? todayRef : undefined}
                  type="button"
                  onClick={() => onOpenDay(row.date)}
                  aria-label={`Open ${weekdayLong(row.date)} ${dayOfMonth(row.date)}`}
                  aria-current={isToday ? "date" : undefined}
                  className={`relative sticky left-0 z-20 flex flex-col items-center justify-center gap-[0.3125rem] ${STICKY_BG} ${RULE} px-1 py-2 hover:bg-white/4`}
                >
                  {/* The ribbon: today's row hangs from a sage bar on the
                      page edge, so "now" is findable before reading a date.
                      Its background is painted here too, or the highlight
                      would stop at the label. */}
                  {isToday && (
                    <span aria-hidden className="pointer-events-none absolute inset-0 bg-sage/4" />
                  )}
                  {isToday && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-sage"
                    />
                  )}
                  <span
                    className={`font-mono text-[0.59375rem] font-medium leading-none ${
                      isToday ? "text-sage" : isPast ? "text-ink-700" : "text-ink-500"
                    }`}
                  >
                    {DOW_SHORT[weekdayIndex(row.date)].toUpperCase()}
                  </span>
                  <span
                    className={`text-base font-semibold leading-none ${
                      isToday ? "text-sage" : isPast ? "text-ink-600" : "text-ink-200"
                    }`}
                  >
                    {dayOfMonth(row.date)}
                  </span>
                  {hasNote && <NotesMark className="absolute bottom-1.5 right-1.5" />}
                </button>
                {placeholder
                  ? Array.from({ length: colCount }).map((_, j) => (
                      <div key={j} className={`${RULE} ${rowBg} px-2.5 py-2.5`}>
                        <span className="block h-2 w-4/5 animate-pulse rounded bg-white/6" />
                      </div>
                    ))
                  : columns.map((col, j) => (
                      <SpreadCell
                        key={col.id}
                        entries={row.cells[j] ?? []}
                        column={col}
                        isPast={isPast}
                        rowClass={rowBg}
                        label={`${weekdayLong(row.date)} ${dayOfMonth(row.date)}, ${col.name}`}
                        onClick={() => onOpenDay(row.date)}
                      />
                    ))}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ColumnHeader({ column }: { column: SpreadColumn }) {
  const subject = column.kind === "subject";
  return (
    <div
      className={`sticky top-0 z-20 ${STICKY_BG} ${RULE} flex snap-start items-center gap-1.5 px-2.5 py-2.5`}
      title={column.name}
    >
      {subject && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: subjectColor(column.color) }}
        />
      )}
      <span
        className={`truncate font-mono text-[0.625rem] font-medium uppercase leading-none tracking-[0.075rem] ${
          subject ? "text-ink-300" : "text-ink-500"
        }`}
      >
        {column.name}
      </span>
    </div>
  );
}

/**
 * One cell: a few entries in small ink, then "+N". The whole cell is the
 * button — entries aren't separately tappable here; they're a preview of
 * the page, and the page is one tap away.
 */
function SpreadCell({
  entries,
  column,
  isPast,
  rowClass,
  label,
  onClick,
}: {
  entries: SpreadEntry[];
  column: SpreadColumn;
  isPast: boolean;
  rowClass: string;
  label: string;
  onClick: () => void;
}) {
  const shown = entries.slice(0, CELL_LIMIT);
  const hidden = entries.length - shown.length;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex snap-start flex-col overflow-hidden ${RULE} ${rowClass} px-2.5 py-2 text-left hover:bg-white/4`}
    >
      {entries.length === 0 ? (
        // A blank line, not a missing one.
        <span aria-hidden className="mt-2.5 block border-t border-dashed border-white/8" />
      ) : (
        <span className="flex min-w-0 flex-col gap-[0.3125rem]">
          {shown.map((entry) => (
            <Entry key={entry.key} entry={entry} column={column} isPast={isPast} />
          ))}
          {hidden > 0 && (
            <span className="pl-[1.125rem] text-[0.6875rem] font-medium leading-none text-steel">
              +{hidden} more
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function Entry({
  entry,
  column,
  isPast,
}: {
  entry: SpreadEntry;
  column: SpreadColumn;
  isPast: boolean;
}) {
  const tone = entry.done
    ? "text-ink-600 line-through"
    : entry.late
      ? "text-overdue"
      : isPast
        ? "text-ink-500"
        : "text-ink-200";
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={entry.title}>
      {entry.kind === "event" ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{
            background: subjectColor(
              entry.color ?? (column.kind === "subject" ? column.color : null),
            ),
            opacity: isPast ? 0.6 : 1,
          }}
        />
      ) : (
        <span
          aria-hidden
          className={`flex h-3 w-3 flex-none items-center justify-center rounded-[0.1875rem] ${
            entry.done
              ? "bg-sage"
              : entry.late
                ? "border-[1.5px] border-solid border-overdue"
                : "border-[1.5px] border-solid border-ink-700"
          }`}
        >
          {entry.done && <CheckGlyph size="sm" />}
        </span>
      )}
      {entry.time !== null && (
        <span className="flex-none font-mono text-[0.625rem] leading-none text-ink-400">
          {formatClock(entry.time)}
        </span>
      )}
      <span className={`min-w-0 flex-1 truncate text-[0.8125rem] leading-[1.3] ${tone}`}>
        {entry.title}
      </span>
    </span>
  );
}

"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  Plus,
  Repeat2,
  X,
} from "lucide-react";

import { createStandaloneTaskAction } from "@/app/app/actions";
import {
  createEventAction,
  getCalendarDayDetailAction,
  type CalendarDayDetail,
} from "@/app/app/calendar/actions";
import { localDayBounds, parseLocalDate } from "@/lib/dates";
import { lexicalToPlainText } from "@/lib/lexical-text";

function selectedDateLabel(dateStr: string) {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function minutesLabel(minutes: number | null) {
  if (minutes === null) return "All day";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: minute === 0 ? undefined : "2-digit",
  });
}

function isoTimeLabel(iso: string | null) {
  if (!iso) return "All day";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CalendarDayDetailPanel({
  dateStr,
  today,
}: {
  dateStr: string;
  today: string;
}) {
  const [detail, setDetail] = useState<CalendarDayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [composer, setComposer] = useState<"task" | "event" | null>(null);
  const [draft, setDraft] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { start, end } = localDayBounds(dateStr);
    setLoading(true);
    getCalendarDayDetailAction(
      dateStr,
      today,
      start.toISOString(),
      end.toISOString(),
    )
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((error) => {
        console.error("[calendar] selected day failed:", error);
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateStr, today, reloadKey]);

  useEffect(() => {
    setComposer(null);
    setDraft("");
    setEventTime("");
  }, [dateStr]);

  const isPast = dateStr < today;
  const isFuture = dateStr > today;
  const notePreview = useMemo(
    () => lexicalToPlainText(detail?.note?.content, 220),
    [detail?.note?.content],
  );

  const submit = async () => {
    const title = draft.trim();
    if (!title || !composer || saving) return;
    setSaving(true);
    try {
      if (composer === "task") {
        await createStandaloneTaskAction(title, dateStr);
      } else {
        const startMin = eventTime
          ? Number(eventTime.slice(0, 2)) * 60 + Number(eventTime.slice(3, 5))
          : null;
        await createEventAction({
          title,
          date: dateStr,
          startMin,
          endMin: null,
        });
      }
      setDraft("");
      setEventTime("");
      setComposer(null);
      setReloadKey((key) => key + 1);
    } catch (error) {
      console.error(`[calendar] create ${composer} failed:`, error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto border-t border-white/8 px-3 pb-5 pt-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-sage">
            {isPast ? "Looking back" : isFuture ? "Planning ahead" : "Today"}
          </p>
          <h3 className="truncate text-[0.9375rem] font-semibold text-ink-100">
            {selectedDateLabel(dateStr)}
          </h3>
        </div>
        {isFuture && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setComposer(composer === "task" ? null : "task")}
              className="flex h-8 items-center gap-1 rounded-lg bg-sage/12 px-2.5 text-[0.6875rem] font-medium text-sage"
            >
              <Plus className="h-3 w-3" /> Task
            </button>
            <button
              type="button"
              onClick={() => setComposer(composer === "event" ? null : "event")}
              className="flex h-8 items-center gap-1 rounded-lg bg-event/12 px-2.5 text-[0.6875rem] font-medium text-event"
            >
              <CalendarPlus className="h-3 w-3" /> Event
            </button>
          </div>
        )}
      </div>

      {composer && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/5 p-2">
          <input
            autoFocus
            value={draft}
            disabled={saving}
            placeholder={composer === "task" ? "Task title" : "Event title"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            className="min-w-0 flex-1 bg-transparent px-1 text-[0.8125rem] text-ink-100 outline-none placeholder:text-ink-600"
          />
          {composer === "event" && (
            <input
              type="time"
              aria-label="Event time"
              value={eventTime}
              onChange={(event) => setEventTime(event.target.value)}
              className="w-[5.75rem] rounded-md border border-white/8 bg-input px-1.5 py-1 text-[0.6875rem] text-ink-300"
            />
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!draft.trim() || saving}
            aria-label={`Add ${composer}`}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-sage text-sage-ink disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setComposer(null)}
            aria-label="Cancel"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-xl bg-white/5" />
          <div className="h-20 animate-pulse rounded-xl bg-white/4" />
        </div>
      ) : detail ? (
        <div className="mt-4 flex flex-col gap-4">
          <DaySection
            title={isPast ? "Tasks completed" : "Tasks scheduled"}
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            {(isPast ? detail.completedTasks : detail.tasks).length === 0 &&
            (!isFuture || detail.recurringPlans.length === 0) ? (
              <Empty
                text={isPast ? "No tasks completed" : "No tasks scheduled"}
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {(isPast ? detail.completedTasks : detail.tasks).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 text-[0.78125rem] text-ink-200"
                  >
                    {isPast || ("completed" in task && task.completed) ? (
                      <CheckCircle2 className="h-3.5 w-3.5 flex-none text-sage" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 flex-none text-ink-600" />
                    )}
                    <span className="min-w-0 flex-1 break-words">
                      {task.title}
                    </span>
                  </div>
                ))}
                {isFuture &&
                  detail.recurringPlans.map((plan) => (
                    <div
                      key={plan.ruleId}
                      className="flex items-center gap-2 text-[0.78125rem] text-ink-200"
                    >
                      <Repeat2 className="h-3.5 w-3.5 flex-none text-sage" />
                      <span className="min-w-0 flex-1 break-words">
                        {plan.title}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </DaySection>

          <DaySection
            title="Daily note"
            icon={<FileText className="h-3.5 w-3.5" />}
          >
            <p className="line-clamp-3 text-[0.75rem] leading-relaxed text-ink-400">
              {detail.note
                ? notePreview || "This daily note is empty."
                : "No daily note yet."}
            </p>
            <Link
              href={`/app?d=${dateStr}`}
              className="mt-2 inline-flex text-[0.6875rem] font-medium text-sage"
            >
              {detail.note ? "Open note to edit" : "Open this day’s note"}
            </Link>
          </DaySection>

          <DaySection title="Events" icon={<Clock3 className="h-3.5 w-3.5" />}>
            {detail.events.length === 0 && detail.ics.events.length === 0 ? (
              <Empty text="No events" />
            ) : (
              <div className="flex flex-col gap-1.5">
                {detail.events.map((event) => (
                  <EventRow
                    key={event.id}
                    title={event.title}
                    time={minutesLabel(event.startMin)}
                  />
                ))}
                {detail.ics.events.map((event) => (
                  <EventRow
                    key={`${event.uid}:${event.date}`}
                    title={event.title}
                    time={isoTimeLabel(event.startIso)}
                  />
                ))}
              </div>
            )}
          </DaySection>

          <DaySection title="Habits" icon={<Repeat2 className="h-3.5 w-3.5" />}>
            {detail.habits.length === 0 ? (
              <Empty text="No habits scheduled" />
            ) : (
              <div className="flex flex-col gap-1.5">
                {detail.habits.map((habit) => (
                  <div
                    key={habit.id}
                    className="flex items-center gap-2 text-[0.78125rem]"
                  >
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${
                        habit.state === "completed"
                          ? "bg-sage"
                          : habit.state === "missed"
                            ? "bg-[#D9938A]"
                            : "border border-sage/60"
                      }`}
                    />
                    <span className="min-w-0 flex-1 text-ink-200">
                      {habit.title}
                    </span>
                    <span className="text-[0.65625rem] capitalize text-ink-500">
                      {habit.state}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </DaySection>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-500">Couldn’t load this day.</p>
      )}
    </section>
  );
}

function DaySection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function EventRow({ title, time }: { title: string; time: string }) {
  return (
    <div className="flex items-center gap-2 text-[0.78125rem] text-ink-200">
      <span className="h-5 w-0.5 flex-none rounded-full bg-event" />
      <span className="min-w-0 flex-1 break-words">{title}</span>
      <span className="flex-none text-[0.65625rem] text-ink-500">{time}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[0.75rem] text-ink-600">{text}</p>;
}

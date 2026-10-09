"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createAgendaTaskAction,
  createSubjectAction,
  deleteTaskAction,
  listTagsAction,
  renameTaskAction,
  setTaskDescriptionAction,
  setTaskDueAction,
  setTaskTagsAction,
  toggleTaskAction,
  type AgendaTaskResult,
  type TagResult,
} from "@/app/app/actions";
import {
  createEventAction,
  deleteEventAction,
  updateEventAction,
} from "@/app/app/calendar/actions";
import {
  listHabitsForDayAction,
  logHabitAction,
} from "@/app/app/habits/actions";
import { TASKS_CHANGED_EVENT } from "@/components/layout/CreateMenu";
import {
  dayRel,
  eventPhases,
  sortEvents,
  type DayRel,
  type EventPhase,
} from "@/lib/agenda-today";
import { localDateString, startOfWeek } from "@/lib/dates";
import { useAgendaWeek } from "@/lib/hooks/use-agenda-week";
import { nextSubjectColor } from "@/lib/subjects";
import type { RangeCalendarEvent } from "@/server/calendar";
import type { EventPatch, UserEvent } from "@/server/events";
import type { HabitForDay } from "@/server/habits";

/**
 * The Today agenda's state: the week payload from `useAgendaWeek`, a local
 * copy of its events and tasks that every write lands in first, the owner's
 * subjects (tags), and today's habits.
 *
 * Writes are optimistic: the local copy changes, the action runs, and once
 * NO write is in flight the week refetches (TASKS_CHANGED_EVENT). While any
 * write is pending, refetched weeks don't overwrite the local copy — an older
 * payload landing mid-edit would snap a just-renamed title back.
 */

export type DayEvent = {
  /** Stable React key: the row id, or uid+date for a feed occurrence. */
  key: string;
  id: string;
  /** "ics" = the read-only calendar feed; no panel, no subject. */
  source: "user" | "ics";
  title: string;
  date: string;
  startMin: number | null;
  endMin: number | null;
  tagId: string | null;
  notes: string | null;
};

export type DayTask = AgendaTaskResult & {
  done: boolean;
  /** On today: due on an earlier day and shown here as LATE. */
  late: boolean;
  /** On a past day: due that day and not done on it (carried forward). */
  carried: boolean;
};

export type DayView = {
  date: string;
  rel: DayRel;
  events: DayEvent[];
  phases: EventPhase[];
  tasks: DayTask[];
};

export type HabitView = { id: string; title: string; done: boolean; streak: number };

function dueDay(t: AgendaTaskResult): string {
  return t.dueAt.slice(0, 10);
}

/** Local day an instant falls on. */
function localDayOf(iso: string): string {
  return localDateString(new Date(iso));
}

function localMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

function icsToDayEvent(e: RangeCalendarEvent): DayEvent {
  const start = e.allDay ? null : localMinutes(e.startIso);
  const end = e.allDay ? null : localMinutes(e.endIso);
  return {
    key: `ics:${e.uid}:${e.date}`,
    id: e.uid,
    source: "ics",
    title: e.title,
    date: e.date,
    startMin: start,
    endMin: start !== null && end !== null && end > start ? end : null,
    tagId: null,
    notes: null,
  };
}

function userToDayEvent(e: UserEvent, date: string): DayEvent {
  // A multi-day event shows on each day it covers, timed only on its first.
  const first = e.localDate === date;
  return {
    key: `${e.id}:${date}`,
    id: e.id,
    source: "user",
    title: e.title,
    date,
    startMin: first ? e.startMin : null,
    endMin: first ? e.endMin : null,
    tagId: e.tagId,
    notes: e.notes,
  };
}

/** Minutes since local midnight, ticking every minute. */
export function useNowMinutes(): number {
  const read = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setNow(read()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

type Local = {
  weekStart: string;
  events: UserEvent[];
  tasks: AgendaTaskResult[];
  carried: AgendaTaskResult[];
};

export function useTodayAgenda(viewed: string | null, today: string | null) {
  const agenda = useAgendaWeek(viewed, today);
  const { week, ics, weekStart } = agenda;

  // ---- local copy ---------------------------------------------------------
  const [local, setLocal] = useState<Local | null>(null);
  const pending = useRef(0);
  useEffect(() => {
    if (!week || pending.current > 0) return;
    setLocal({
      weekStart: week.start,
      events: week.events,
      tasks: week.tasks,
      carried: week.carried,
    });
  }, [week]);
  // The local copy only counts while it is the viewed week's.
  const current = local && local.weekStart === weekStart ? local : null;

  // Late tasks ticked off on today stay on today's list (struck, grey pill)
  // for the session — the refetched carried pile no longer includes them.
  const [doneLate, setDoneLate] = useState<Map<string, AgendaTaskResult>>(
    () => new Map(),
  );

  const write = useCallback(
    async (run: () => Promise<unknown>) => {
      pending.current += 1;
      let failed = false;
      try {
        await run();
      } catch (err) {
        failed = true;
        console.error("[today] write failed:", err);
      } finally {
        pending.current -= 1;
      }
      if (pending.current === 0) {
        if (failed) agenda.refresh();
        else window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
      }
    },
    [agenda],
  );

  const patchTasks = useCallback(
    (fn: (t: AgendaTaskResult) => AgendaTaskResult | null) => {
      const apply = (list: AgendaTaskResult[]) =>
        list.flatMap((t) => {
          const next = fn(t);
          return next ? [next] : [];
        });
      setLocal((l) =>
        l ? { ...l, tasks: apply(l.tasks), carried: apply(l.carried) } : l,
      );
      setDoneLate((m) => {
        if (m.size === 0) return m;
        const next = new Map<string, AgendaTaskResult>();
        for (const [id, t] of m) {
          const p = fn(t);
          if (p) next.set(id, p);
        }
        return next;
      });
    },
    [],
  );

  const patchEvents = useCallback(
    (fn: (e: UserEvent) => UserEvent | null) => {
      setLocal((l) =>
        l
          ? {
              ...l,
              events: l.events.flatMap((e) => {
                const next = fn(e);
                return next ? [next] : [];
              }),
            }
          : l,
      );
    },
    [],
  );

  // ---- subjects -----------------------------------------------------------
  const [subjects, setSubjects] = useState<TagResult[]>([]);
  useEffect(() => {
    listTagsAction()
      .then((tags) =>
        setSubjects(tags.map(({ id, name, color }) => ({ id, name, color }))),
      )
      .catch((err) => console.error("[today] subjects load failed:", err));
  }, []);
  const subjectById = useMemo(
    () => new Map(subjects.map((s) => [s.id, s])),
    [subjects],
  );

  const createSubject = useCallback(
    async (name: string): Promise<TagResult | null> => {
      const color = nextSubjectColor(subjects.map((s) => s.color));
      try {
        const tag = await createSubjectAction(name, color);
        if (tag) {
          setSubjects((list) =>
            list.some((s) => s.id === tag.id)
              ? list.map((s) => (s.id === tag.id ? tag : s))
              : [...list, tag],
          );
        }
        return tag;
      } catch (err) {
        console.error("[today] create subject failed:", err);
        return null;
      }
    },
    [subjects],
  );

  // ---- habits (today only; past days of this week read their dots) --------
  const [habits, setHabits] = useState<HabitForDay[] | null>(null);
  useEffect(() => {
    if (!today) return;
    listHabitsForDayAction(today)
      .then(setHabits)
      .catch((err) => {
        console.error("[today] habits load failed:", err);
        setHabits([]);
      });
  }, [today]);

  const habitsFor = useCallback(
    (date: string): HabitView[] => {
      if (!today || !habits || habits.length === 0) return [];
      // This week's past days and today; never ahead, never older weeks.
      if (date > today || startOfWeek(date) !== startOfWeek(today)) return [];
      return habits
        .filter((h) => !h.paused)
        .flatMap((h) => {
          if (date === today) {
            if (!h.scheduledToday && !h.todayCompleted) return [];
            return [
              { id: h.id, title: h.title, done: h.todayCompleted, streak: h.runDays },
            ];
          }
          const dot = h.dots.find((d) => d.date === date);
          if (!dot) return [];
          return [
            { id: h.id, title: h.title, done: dot.state === "done", streak: 0 },
          ];
        });
    },
    [habits, today],
  );

  const toggleHabit = useCallback(
    (id: string) => {
      if (!today) return;
      setHabits((list) =>
        list
          ? list.map((h) =>
              h.id === id
                ? {
                    ...h,
                    todayCompleted: !h.todayCompleted,
                    runDays: Math.max(0, h.runDays + (h.todayCompleted ? -1 : 1)),
                  }
                : h,
            )
          : list,
      );
      logHabitAction(id, today).catch((err) => {
        console.error("[today] habit log failed:", err);
        listHabitsForDayAction(today).then(setHabits).catch(() => {});
      });
    },
    [today],
  );

  // ---- days ---------------------------------------------------------------
  const nowMin = useNowMinutes();

  const dayView = useCallback(
    (date: string): DayView | null => {
      if (!today || !current) return null;
      const rel = dayRel(date, today);
      const userEvents = current.events
        .filter((e) => e.localDate <= date && date <= (e.endLocalDate ?? e.localDate))
        .map((e) => userToDayEvent(e, date));
      const feed = ics.filter((e) => e.date === date).map(icsToDayEvent);
      const events = sortEvents([...userEvents, ...feed]);
      const phases = eventPhases(events, rel, nowMin);

      const tasks: DayTask[] = [];
      if (rel === "today") {
        const seen = new Set<string>();
        for (const t of [...current.carried, ...doneLate.values()]) {
          if (seen.has(t.id) || dueDay(t) >= today) continue;
          seen.add(t.id);
          tasks.push({ ...t, done: t.completedAt !== null, late: true, carried: false });
        }
      }
      for (const t of current.tasks) {
        if (dueDay(t) !== date) continue;
        const done = t.completedAt !== null;
        const carried =
          rel === "past" &&
          (!done || localDayOf(t.completedAt as string) > date);
        tasks.push({ ...t, done, late: false, carried });
      }
      return { date, rel, events, phases, tasks };
    },
    [current, ics, today, nowMin, doneLate],
  );

  // ---- task writes --------------------------------------------------------
  const findTask = useCallback(
    (id: string): AgendaTaskResult | null =>
      current?.tasks.find((t) => t.id === id) ??
      current?.carried.find((t) => t.id === id) ??
      doneLate.get(id) ??
      null,
    [current, doneLate],
  );

  const toggleTask = useCallback(
    (id: string) => {
      const task = findTask(id);
      if (!task || !today) return;
      const done = task.completedAt === null;
      const completedAt = done ? new Date().toISOString() : null;
      if (dueDay(task) < today) {
        setDoneLate((m) => {
          const next = new Map(m);
          if (done) next.set(id, { ...task, completedAt });
          else next.delete(id);
          return next;
        });
      }
      patchTasks((t) => (t.id === id ? { ...t, completedAt } : t));
      void write(() => toggleTaskAction(id, done));
    },
    [findTask, patchTasks, today, write],
  );

  const renameTask = useCallback(
    (id: string, title: string) => {
      patchTasks((t) => (t.id === id ? { ...t, title } : t));
      void write(() => renameTaskAction(id, title));
    },
    [patchTasks, write],
  );

  const setTaskNotes = useCallback(
    (id: string, notes: string) => {
      patchTasks((t) => (t.id === id ? { ...t, description: notes } : t));
      void write(() => setTaskDescriptionAction(id, notes));
    },
    [patchTasks, write],
  );

  /** The subject is the task's first tag; other tags ride along behind it. */
  const setTaskSubject = useCallback(
    (id: string, subjectId: string | null) => {
      const task = findTask(id);
      if (!task) return;
      const subject = subjectId ? subjectById.get(subjectId) : undefined;
      if (subjectId && !subject) return;
      const rest = task.tags.slice(1).filter((t) => t.id !== subjectId);
      const tags = subject ? [subject, ...rest] : rest;
      patchTasks((t) => (t.id === id ? { ...t, tags } : t));
      void write(() => setTaskTagsAction(id, tags.map((t) => t.id)));
    },
    [findTask, patchTasks, subjectById, write],
  );

  const moveTask = useCallback(
    (id: string, date: string) => {
      patchTasks((t) => (t.id === id ? { ...t, dueAt: `${date}T00:00:00.000Z` } : t));
      setDoneLate((m) => {
        if (!m.has(id)) return m;
        const next = new Map(m);
        next.delete(id);
        return next;
      });
      void write(() => setTaskDueAction(id, date));
    },
    [patchTasks, write],
  );

  const deleteTask = useCallback(
    (id: string) => {
      patchTasks((t) => (t.id === id ? null : t));
      void write(() => deleteTaskAction(id));
    },
    [patchTasks, write],
  );

  const addTask = useCallback(
    (title: string, date: string, subjectId: string | null) => {
      const tempId = `temp-${Date.now()}`;
      const subject = subjectId ? subjectById.get(subjectId) : undefined;
      const draft: AgendaTaskResult = {
        id: tempId,
        title,
        description: null,
        dueAt: `${date}T00:00:00.000Z`,
        important: false,
        noteId: null,
        remindAt: null,
        boardTitle: null,
        boardColor: null,
        recurring: null,
        tags: subject ? [subject] : [],
        completedAt: null,
      };
      setLocal((l) => (l ? { ...l, tasks: [...l.tasks, draft] } : l));
      void write(async () => {
        try {
          const saved = await createAgendaTaskAction(title, date, subjectId);
          patchTasks((t) => (t.id === tempId ? saved : t));
        } catch (err) {
          patchTasks((t) => (t.id === tempId ? null : t));
          throw err;
        }
      });
    },
    [patchTasks, subjectById, write],
  );

  // ---- event writes -------------------------------------------------------
  const updateEvent = useCallback(
    (id: string, patch: EventPatch) => {
      patchEvents((e) => {
        if (e.id !== id) return e;
        const next = { ...e };
        if (patch.title !== undefined) next.title = patch.title;
        if (patch.tagId !== undefined) next.tagId = patch.tagId;
        if (patch.notes !== undefined) next.notes = patch.notes;
        if (patch.times !== undefined) {
          next.startMin = patch.times.startMin;
          next.endMin = patch.times.endMin;
        }
        if (patch.localDate !== undefined && e.endLocalDate !== null) {
          const span =
            (Date.parse(`${e.endLocalDate}T00:00:00Z`) -
              Date.parse(`${e.localDate}T00:00:00Z`)) /
            86_400_000;
          const end = new Date(`${patch.localDate}T00:00:00Z`);
          end.setUTCDate(end.getUTCDate() + span);
          next.endLocalDate = end.toISOString().slice(0, 10);
        }
        if (patch.localDate !== undefined) next.localDate = patch.localDate;
        return next;
      });
      void write(() => updateEventAction(id, patch));
    },
    [patchEvents, write],
  );

  const deleteEvent = useCallback(
    (id: string) => {
      patchEvents((e) => (e.id === id ? null : e));
      void write(() => deleteEventAction(id));
    },
    [patchEvents, write],
  );

  const addEvent = useCallback(
    (title: string, date: string, startMin: number | null, tagId: string | null) => {
      const tempId = `temp-${Date.now()}`;
      const draft: UserEvent = {
        id: tempId,
        title,
        localDate: date,
        endLocalDate: null,
        startMin,
        endMin: null,
        tagId,
        notes: null,
      };
      setLocal((l) => (l ? { ...l, events: [...l.events, draft] } : l));
      void write(async () => {
        try {
          const saved = await createEventAction({
            title,
            date,
            startMin,
            endMin: null,
            tagId,
          });
          patchEvents((e) => (e.id === tempId ? saved : e));
        } catch (err) {
          patchEvents((e) => (e.id === tempId ? null : e));
          throw err;
        }
      });
    },
    [patchEvents, write],
  );

  const findEvent = useCallback(
    (id: string): UserEvent | null =>
      current?.events.find((e) => e.id === id) ?? null,
    [current],
  );

  return {
    agenda,
    weekStart,
    ready: current !== null,
    loadFailed: !agenda.loading && week === null,
    noteDates: week?.noteDates ?? [],
    /** The agenda's pinned lines (subjects printed on every week's spread). */
    lines: week?.lines ?? [],
    nowMin,
    dayView,
    subjects,
    subjectById,
    createSubject,
    habitsFor,
    toggleHabit,
    findTask,
    toggleTask,
    renameTask,
    setTaskNotes,
    setTaskSubject,
    moveTask,
    deleteTask,
    addTask,
    findEvent,
    updateEvent,
    deleteEvent,
    addEvent,
  };
}

export type TodayAgenda = ReturnType<typeof useTodayAgenda>;

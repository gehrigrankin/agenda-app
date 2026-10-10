"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createSubjectAction,
  deleteTaskAction,
  listTagsAction,
  renameTaskAction,
  setTaskDescriptionAction,
  setTaskDueAction,
  setTaskImportantAction,
  setTaskTagsAction,
  toggleTaskAction,
  type TagResult,
  type TagWithCountResult,
} from "@/app/app/actions";
import {
  createTaskInListAction,
  getTaskListsAction,
  listLogbookAction,
  setTaskSomedayAction,
  setTaskTimeAction,
  type ListTaskResult,
} from "@/app/app/tasks/actions";
import { TASKS_CHANGED_EVENT } from "@/components/layout/CreateMenu";
import { addDays, localDateString } from "@/lib/dates";
import { loadCachedThenRefresh, viewCacheKey } from "@/lib/indexeddb-cache";
import { nextSubjectColor } from "@/lib/subjects";
import { isSubjectTag } from "@/lib/task-lists";

/**
 * State for the desktop Tasks page: one payload of every open top-level task
 * (lists are client-side cuts — `src/lib/task-lists.ts`), the tag catalog,
 * and the Logbook (loaded when shown).
 *
 * Writes are optimistic with rollback, like the old page: the local copy
 * changes, the action runs, a failure restores the previous row. Once no
 * write is in flight the page announces TASKS_CHANGED_EVENT so Today, the
 * calendar tray etc. refetch; it ignores its own announcement but refetches
 * on anyone else's (a task created from the Create menu, voice capture…)
 * unless a write of its own is still pending.
 *
 * Completing a task keeps it on screen (struck) for the session, so a stray
 * click can be undone where it happened; it leaves the lists on the next
 * refetch.
 */

export type TaskPatch = Partial<
  Pick<
    ListTaskResult,
    | "title"
    | "description"
    | "due"
    | "time"
    | "important"
    | "someday"
    | "tags"
    | "noteId"
    | "noteTitle"
    | "completedAt"
    | "subtaskCount"
    | "subtaskDone"
  >
>;

export function useTaskLists(cacheScope: string) {
  const [today, setToday] = useState("");
  const [tasks, setTasks] = useState<ListTaskResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [allTags, setAllTags] = useState<TagWithCountResult[]>([]);
  const [logbook, setLogbook] = useState<ListTaskResult[] | null>(null);
  const [logbookLimit, setLogbookLimit] = useState(100);

  const pending = useRef(0);
  const selfEvent = useRef(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const logbookRef = useRef(logbook);
  logbookRef.current = logbook;

  // ---- loading -------------------------------------------------------------
  const refetch = useCallback((day: string) => {
    if (!day) return;
    getTaskListsAction(day)
      .then((rows) => {
        if (pending.current > 0) return;
        // Rows completed this session stay visible (struck) until the view
        // changes — re-append the ones the fresh payload no longer carries.
        setTasks((prev) => {
          const fresh = new Set(rows.map((r) => r.id));
          const kept = prev.filter(
            (t) => t.completedAt !== null && !fresh.has(t.id),
          );
          return [...rows, ...kept];
        });
      })
      .catch((err) => console.error("[tasks] refetch failed:", err));
    listTagsAction()
      .then(setAllTags)
      .catch((err) => console.error("[tasks] tags load failed:", err));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const day = localDateString();
    setToday(day);
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "tasks", `lists:${day}`),
      refresh: () => getTaskListsAction(day),
      onValue: (rows) => {
        if (pending.current > 0) return;
        setTasks(rows);
        setLoading(false);
      },
      onError: (err) => {
        console.error("[tasks] page load failed:", err);
        setLoading(false);
      },
      cancelled: () => cancelled,
    });
    listTagsAction()
      .then((rows) => {
        if (!cancelled) setAllTags(rows);
      })
      .catch((err) => console.error("[tasks] tags load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [cacheScope]);

  const loadLogbook = useCallback((limit: number) => {
    listLogbookAction(limit)
      .then((rows) => {
        if (pending.current === 0) setLogbook(rows);
      })
      .catch((err) => console.error("[tasks] logbook load failed:", err));
  }, []);

  useEffect(() => {
    const onChanged = () => {
      if (selfEvent.current || pending.current > 0) return;
      refetch(today);
      if (logbookRef.current !== null) loadLogbook(logbookLimit);
    };
    window.addEventListener(TASKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChanged);
  }, [today, refetch, loadLogbook, logbookLimit]);

  // ---- write plumbing -----------------------------------------------------
  const announce = () => {
    selfEvent.current = true;
    try {
      window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
    } finally {
      selfEvent.current = false;
    }
  };

  /** Run a write; on failure call `rollback`. Announces once all settle. */
  const write = useCallback(
    async (run: () => Promise<unknown>, rollback: () => void) => {
      pending.current += 1;
      let failed = false;
      try {
        await run();
      } catch (err) {
        failed = true;
        console.error("[tasks] write failed:", err);
        rollback();
      } finally {
        pending.current -= 1;
      }
      if (pending.current === 0) {
        if (failed) refetch(today);
        else announce();
      }
    },
    [refetch, today],
  );

  const find = (id: string) =>
    tasksRef.current.find((t) => t.id === id) ??
    logbookRef.current?.find((t) => t.id === id);

  /** Patch a row wherever it is (open lists and/or the Logbook). */
  const patchLocal = useCallback((id: string, patch: TaskPatch) => {
    const apply = (list: ListTaskResult[]) =>
      list.map((t) => (t.id === id ? { ...t, ...patch } : t));
    setTasks(apply);
    setLogbook((prev) => (prev ? apply(prev) : prev));
  }, []);

  /** Optimistic patch + action; the previous values come back on failure. */
  const update = (
    id: string,
    patch: TaskPatch,
    run: () => Promise<unknown>,
  ) => {
    const before = find(id);
    if (!before) return;
    const previous: TaskPatch = {};
    for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
      (previous as Record<string, unknown>)[key] = before[key];
    }
    patchLocal(id, patch);
    void write(run, () => patchLocal(id, previous));
  };

  // ---- tag counts (the picker's numbers) ----------------------------------
  const bumpTagCounts = (ids: string[], delta: number) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    setAllTags((prev) =>
      prev.map((t) =>
        set.has(t.id)
          ? { ...t, taskCount: Math.max(0, t.taskCount + delta) }
          : t,
      ),
    );
  };
  const registerTags = (tags: TagResult[]) =>
    setAllTags((prev) => {
      const known = new Set(prev.map((t) => t.id));
      const fresh = tags.filter((t) => !known.has(t.id));
      if (fresh.length === 0) return prev;
      return [
        ...prev,
        ...fresh.map((t) => ({
          ...t,
          taskCount: 0,
          pinned: false,
          sortOrder: 0,
        })),
      ].sort((a, b) => a.name.localeCompare(b.name));
    });
  const recountTags = (before: TagResult[], after: TagResult[]) => {
    const b = new Set(before.map((t) => t.id));
    const a = new Set(after.map((t) => t.id));
    bumpTagCounts(
      after.filter((t) => !b.has(t.id)).map((t) => t.id),
      1,
    );
    bumpTagCounts(
      before.filter((t) => !a.has(t.id)).map((t) => t.id),
      -1,
    );
  };

  // ---- mutations -----------------------------------------------------------
  const toggle = (id: string) => {
    const t = find(id);
    if (!t) return;
    const done = t.completedAt === null;
    const completedAt = done ? new Date().toISOString() : null;
    if (!done && logbookRef.current?.some((r) => r.id === id)) {
      // Reopened from the Logbook: it rejoins the open lists right away.
      setTasks((prev) =>
        prev.some((r) => r.id === id)
          ? prev
          : [...prev, { ...t, completedAt: null }],
      );
    }
    update(id, { completedAt }, () => toggleTaskAction(id, done));
  };

  const setImportant = (id: string, important: boolean) =>
    update(id, { important }, () => setTaskImportantAction(id, important));

  const rename = (id: string, title: string) => {
    const next = title.trim();
    const t = find(id);
    if (!t || !next || next === t.title) return;
    update(id, { title: next }, () => renameTaskAction(id, next));
  };

  const setDescription = (id: string, description: string) => {
    const t = find(id);
    const next = description.trim() ? description : null;
    if (!t || (t.description ?? "") === (next ?? "")) return;
    update(id, { description: next }, () => setTaskDescriptionAction(id, next));
  };

  const setDue = (id: string, due: string | null) => {
    const t = find(id);
    if (!t) return;
    // Clearing the date clears the time too: a time with no day is noise.
    if (due === null && t.time !== null) {
      update(id, { due: null, time: null }, async () => {
        await setTaskDueAction(id, null);
        await setTaskTimeAction(id, null);
      });
      return;
    }
    update(id, { due }, () => setTaskDueAction(id, due));
  };

  const setTime = (id: string, time: string | null) =>
    update(id, { time }, () => setTaskTimeAction(id, time));

  const setSomeday = (id: string, someday: boolean) =>
    update(id, { someday }, () => setTaskSomedayAction(id, someday));

  const moveToTomorrow = (id: string) => {
    if (!today) return;
    setDue(id, addDays(today, 1));
  };

  /** The picker already wrote the tags (and rolls back through here). */
  const applyTags = (id: string, tags: TagResult[]) => {
    const t = find(id);
    if (t) recountTags(t.tags, tags);
    patchLocal(id, { tags });
  };

  /** Swap the task's subject; plain tags and other colors ride along. */
  const setSubject = (id: string, subject: TagResult | null) => {
    const t = find(id);
    if (!t) return;
    const rest = t.tags.filter((tag) => !isSubjectTag(tag));
    const tags = (subject ? [subject, ...rest] : rest).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    recountTags(t.tags, tags);
    update(id, { tags }, () =>
      setTaskTagsAction(
        id,
        tags.map((tag) => tag.id),
      ),
    );
  };

  const createSubject = async (name: string): Promise<TagResult | null> => {
    const color = nextSubjectColor(allTags.map((t) => t.color));
    try {
      const tag = await createSubjectAction(name, color);
      if (tag) {
        // createTag recolors an existing tag of that name — reflect it.
        setAllTags((prev) =>
          prev.some((t) => t.id === tag.id)
            ? prev.map((t) =>
                t.id === tag.id ? { ...t, color: tag.color } : t,
              )
            : [
                ...prev,
                { ...tag, taskCount: 0, pinned: false, sortOrder: 0 },
              ].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      return tag;
    } catch (err) {
      console.error("[tasks] create subject failed:", err);
      return null;
    }
  };

  const remove = (id: string) => {
    const t = find(id);
    if (!t) return;
    const tasksBefore = tasksRef.current;
    const logbookBefore = logbookRef.current;
    setTasks((prev) => prev.filter((r) => r.id !== id));
    setLogbook((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    if (t.completedAt === null)
      bumpTagCounts(
        t.tags.map((tag) => tag.id),
        -1,
      );
    void write(
      () => deleteTaskAction(id),
      () => {
        setTasks(tasksBefore);
        setLogbook(logbookBefore);
        if (t.completedAt === null)
          bumpTagCounts(
            t.tags.map((tag) => tag.id),
            1,
          );
      },
    );
  };

  /** Quick-add. Resolves the new row (or null) so the caller can select it. */
  const create = async (
    title: string,
    defaults: { due: string | null; someday: boolean; tagId: string | null },
  ): Promise<ListTaskResult | null> => {
    pending.current += 1;
    try {
      const row = await createTaskInListAction(title, defaults);
      registerTags(row.tags);
      bumpTagCounts(
        row.tags.map((t) => t.id),
        1,
      );
      setTasks((prev) => [row, ...prev]);
      return row;
    } catch (err) {
      console.error("[tasks] create failed:", err);
      return null;
    } finally {
      pending.current -= 1;
      if (pending.current === 0) announce();
    }
  };

  const noteRemoved = (id: string, noteId: string) => {
    const t = find(id);
    if (t?.noteId === noteId) patchLocal(id, { noteId: null, noteTitle: null });
  };

  const showMoreLogbook = () => {
    const next = logbookLimit + 100;
    setLogbookLimit(next);
    loadLogbook(next);
  };

  return {
    today,
    tasks,
    loading,
    allTags,
    logbook,
    logbookLimit,
    loadLogbook: () => loadLogbook(logbookLimit),
    showMoreLogbook,
    /** Rules materialize occurrences — the Repeating view asks for this. */
    refetch: () => refetch(today),
    toggle,
    setImportant,
    rename,
    setDescription,
    setDue,
    setTime,
    setSomeday,
    moveToTomorrow,
    applyTags,
    registerTag: (tag: TagResult) => registerTags([tag]),
    setSubject,
    createSubject,
    remove,
    create,
    noteRemoved,
    patchLocal,
  };
}

export type TaskListsApi = ReturnType<typeof useTaskLists>;

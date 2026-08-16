"use client";

import {
  listNotesForTasksAction,
  type TaskNoteLink,
} from "@/app/app/actions";

/**
 * Coalescing loader for "which notes is this task on?".
 *
 * `TaskNotesPicker` mounts once per task row — every checkbox in an open note,
 * every row on the Tasks page — and each one needs its link list to draw the
 * shared-on-N-notes badge. Asking per task meant one server-action round trip
 * per checkbox on note open, which is the worst place in the app to add N
 * requests. Callers here queue their id, and every id queued within one
 * batch window goes out as a single `listNotesForTasksAction` call.
 *
 * The window is a timeout rather than a microtask on purpose: task rows mount
 * across several React commits (Lexical decorators in particular), so a
 * microtask would still fan out into a handful of requests.
 */

/** Wide enough to catch a whole page/note's rows, short enough to feel instant. */
const BATCH_WINDOW_MS = 20;

/** Matches the server action's own cap, so a batch is never silently truncated. */
const MAX_BATCH_SIZE = 200;

type Pending = {
  resolve: (links: TaskNoteLink[]) => void;
  reject: (err: unknown) => void;
};

/** Ids waiting for the next flush, each with everyone awaiting that id. */
let queue = new Map<string, Pending[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = queue;
  queue = new Map();
  if (batch.size === 0) return;

  const ids = [...batch.keys()];
  // Chunk rather than drop: the cap is a request-size guard, not a limit on
  // how many rows a page may have.
  for (let i = 0; i < ids.length; i += MAX_BATCH_SIZE) {
    const chunk = ids.slice(i, i + MAX_BATCH_SIZE);
    void listNotesForTasksAction(chunk)
      .then((byTask) => {
        for (const id of chunk) {
          for (const waiter of batch.get(id) ?? []) {
            waiter.resolve(byTask[id] ?? []);
          }
        }
      })
      .catch((err) => {
        for (const id of chunk) {
          for (const waiter of batch.get(id) ?? []) waiter.reject(err);
        }
      });
  }
}

/**
 * The notes `taskId` is on. Batched with every other call in the same window;
 * two callers asking for the same id share one entry and both get the answer.
 */
export function loadNotesForTask(taskId: string): Promise<TaskNoteLink[]> {
  return new Promise((resolve, reject) => {
    const waiters = queue.get(taskId);
    if (waiters) waiters.push({ resolve, reject });
    else queue.set(taskId, [{ resolve, reject }]);
    if (timer === null) timer = setTimeout(flush, BATCH_WINDOW_MS);
  });
}

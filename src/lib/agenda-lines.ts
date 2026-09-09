/**
 * Pure helpers behind the agenda's ruled lines.
 *
 * A paper school agenda prints the same few "subjects" on every day, and you
 * write under the one you mean. Here a subject is a PINNED TAG, and this
 * module does the bucketing: every line gets a group even when nothing lands
 * on it (the empty ruled line, waiting to be written on, is the whole point),
 * and anything matching no line falls to a trailing unlabeled group.
 *
 * A task carrying several pinned tags belongs to the FIRST line in line order
 * — a task must appear exactly once on a day, and "first line wins" is the
 * rule the user can see and predict from the line order they chose.
 */

/** One ruled line's worth of tasks; `lineId` null is the trailing catch-all. */
export type LineGroup<T> = { lineId: string | null; tasks: T[] };

/**
 * Bucket `tasks` into `lines` (pinned tags, in line order). Order inside a
 * group follows the input order, so the caller's due/created sort survives.
 */
export function groupIntoLines<T extends { id: string; tags: { id: string }[] }>(
  tasks: T[],
  lines: { id: string }[],
): LineGroup<T>[] {
  const groups: LineGroup<T>[] = lines.map((line) => ({
    lineId: line.id,
    tasks: [],
  }));
  const untagged: LineGroup<T> = { lineId: null, tasks: [] };
  // Line id -> its position, so a task with many tags costs one lookup per tag
  // rather than a scan of every line.
  const indexOf = new Map(lines.map((line, i) => [line.id, i]));

  for (const task of tasks) {
    let best = -1;
    for (const tag of task.tags) {
      const i = indexOf.get(tag.id);
      if (i !== undefined && (best === -1 || i < best)) best = i;
    }
    (best === -1 ? untagged : groups[best]).tasks.push(task);
  }

  groups.push(untagged);
  return groups;
}

/** "HH:MM" (24h) from minutes since local midnight, e.g. 540 -> "09:00". */
export function minutesToHHMM(min: number): string {
  const total = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
  const h = Math.floor(total / 60);
  return `${String(h).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

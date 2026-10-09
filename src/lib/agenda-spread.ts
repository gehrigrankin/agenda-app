/**
 * Pure rules behind the week SPREAD — the phone's week screen, and the page a
 * school agenda opens to: the week ruled into days by subjects, every cell
 * blank or holding a few short entries.
 *
 * Columns are subjects (tags). The agenda's pinned lines come first, in line
 * order, so the subjects the user curated sit leftmost and in the same place
 * every week; any other subject that has an item this week follows, so no
 * task or event hides because its tag isn't pinned. Then Schedule, for events
 * with no subject (and the read-only calendar feed), and Other, only when
 * some task this week has no subject at all — a column blank all week is
 * noise, not a ruled line.
 *
 * An item sits in exactly one cell: an event in its subject's column, a task
 * in the column of its first tag that has one (a single-subject task on the
 * Today page; "first wins" when a task carries several).
 */

export type SpreadSubject = { id: string; name: string; color: string | null };

export type SpreadColumn = SpreadSubject & {
  kind: "subject" | "schedule" | "other";
};

export type SpreadEntry = {
  key: string;
  title: string;
  kind: "task" | "event";
  done: boolean;
  /** Open past its day: struck "→ today" on the past day, LATE on today. */
  late: boolean;
  /** Minutes since local midnight for a timed event; null otherwise. */
  time: number | null;
  /** The subject's color (events only — tasks take the column's). */
  color: string | null;
};

export type SpreadRow = {
  date: string;
  /** One list per column, in column order. */
  cells: SpreadEntry[][];
};

export type SpreadTask = {
  id: string;
  title: string;
  done: boolean;
  late: boolean;
  carried: boolean;
  tags: { id: string }[];
};

export type SpreadEvent = {
  key: string;
  title: string;
  startMin: number | null;
  tagId: string | null;
};

export type SpreadDay = {
  date: string;
  events: SpreadEvent[];
  tasks: SpreadTask[];
};

export const SCHEDULE_COLUMN_ID = "schedule";
export const OTHER_COLUMN_ID = "other";

/**
 * The subject columns for a week: pinned lines first (line order), then every
 * other subject with an item in the week, in `subjects` order.
 */
export function spreadSubjects(
  lines: SpreadSubject[],
  subjects: SpreadSubject[],
  days: SpreadDay[],
): SpreadSubject[] {
  const pinned = new Set(lines.map((l) => l.id));
  const used = new Set<string>();
  for (const day of days) {
    for (const t of day.tasks) for (const tag of t.tags) used.add(tag.id);
    for (const e of day.events) if (e.tagId !== null) used.add(e.tagId);
  }
  return [
    ...lines,
    ...subjects.filter((s) => !pinned.has(s.id) && used.has(s.id)),
  ];
}

function taskEntry(t: SpreadTask): SpreadEntry {
  return {
    key: `task:${t.id}`,
    title: t.title,
    kind: "task",
    done: t.done,
    late: !t.done && (t.late || t.carried),
    time: null,
    color: null,
  };
}

function eventEntry(e: SpreadEvent, color: string | null): SpreadEntry {
  return {
    key: `event:${e.key}`,
    title: e.title,
    kind: "event",
    done: false,
    late: false,
    time: e.startMin,
    color,
  };
}

/** Events by start (untimed first), then open tasks, then done — the order a
 * planner reads a cell in, and the order it truncates from. */
function orderCell(entries: SpreadEntry[]): SpreadEntry[] {
  const rank = (x: SpreadEntry) => (x.kind === "event" ? 0 : x.done ? 2 : 1);
  return [...entries].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.kind === "event" && b.kind === "event") {
      return (a.time ?? -1) - (b.time ?? -1);
    }
    return 0;
  });
}

export function buildSpread(
  days: SpreadDay[],
  subjects: SpreadSubject[],
): { columns: SpreadColumn[]; rows: SpreadRow[] } {
  const colorOf = new Map(subjects.map((s) => [s.id, s.color]));
  const index = new Map(subjects.map((s, i) => [s.id, i]));
  const scheduleAt = subjects.length;
  const otherAt = subjects.length + 1;

  const rows: SpreadRow[] = days.map((day) => {
    const cells: SpreadEntry[][] = Array.from(
      { length: subjects.length + 2 },
      () => [],
    );
    for (const e of day.events) {
      const at = e.tagId === null ? undefined : index.get(e.tagId);
      if (at === undefined) cells[scheduleAt].push(eventEntry(e, null));
      else cells[at].push(eventEntry(e, colorOf.get(e.tagId as string) ?? null));
    }
    for (const t of day.tasks) {
      let at: number | undefined;
      for (const tag of t.tags) {
        at = index.get(tag.id);
        if (at !== undefined) break;
      }
      cells[at ?? otherAt].push(taskEntry(t));
    }
    return { date: day.date, cells: cells.map(orderCell) };
  });

  const hasOther = rows.some((r) => r.cells[otherAt].length > 0);
  if (!hasOther) for (const r of rows) r.cells.pop();

  const columns: SpreadColumn[] = [
    ...subjects.map((s) => ({ ...s, kind: "subject" as const })),
    { id: SCHEDULE_COLUMN_ID, name: "Schedule", color: null, kind: "schedule" },
    ...(hasOther
      ? [{ id: OTHER_COLUMN_ID, name: "Other", color: null, kind: "other" as const }]
      : []),
  ];
  return { columns, rows };
}

import { addDays, formatTodayElseDate, formatUtcDate } from "@/lib/dates";
import type { ThreadMentionItem } from "@/app/app/ai/actions";

/**
 * Pure helpers shared by the Threads page's phone and desktop trees:
 * timeline grouping (quiet runs collapse), labels, and the stable per-thread
 * color. No React, no I/O.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** "7 mentions over 8 weeks" (or just "7 mentions" for a same-week thread). */
export function mentionSpanLabel(
  count: number,
  firstMentionAt: string | null,
  lastMentionAt: string | null,
): string {
  const noun = count === 1 ? "mention" : "mentions";
  if (!firstMentionAt || !lastMentionAt) return `${count} ${noun}`;
  const weeks = Math.max(
    1,
    Math.round(
      (new Date(lastMentionAt).getTime() - new Date(firstMentionAt).getTime()) /
        MS_PER_WEEK,
    ),
  );
  if (weeks <= 1) return `${count} ${noun}`;
  return `${count} ${noun} over ${weeks} weeks`;
}

/** "Today" for the local calendar day, else "May 12" (+ year if not current). */
export function formatMentionDate(
  iso: string,
  todayStr: string | null,
): string {
  return formatTodayElseDate(iso, todayStr);
}

export function sourceLabel(mention: ThreadMentionItem): string {
  return mention.noteDailyDate ? "daily note" : mention.noteTitle || "Untitled";
}

/** Compact relative time for list rows: "now", "5m", "2h", "3d", else "Sep 21". */
export function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, nowMs - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date(nowMs).getFullYear()) opts.year = "2-digit";
  return d.toLocaleDateString("en-US", opts);
}

/** Due label for a context task: "today", "tomorrow", "Mon", "Oct 14". `dueAt`
 * is the stored instant (date-only dues are midnight UTC). */
export function dueLabel(dueAt: string | null, todayStr: string | null) {
  if (!dueAt) return { text: "", overdue: false };
  const dateStr = dueAt.slice(0, 10);
  if (!todayStr)
    return {
      text: formatUtcDate(dateStr, { month: "short", day: "numeric" }),
      overdue: false,
    };
  if (dateStr < todayStr) {
    return {
      text: formatUtcDate(dateStr, { month: "short", day: "numeric" }),
      overdue: true,
    };
  }
  if (dateStr === todayStr) return { text: "today", overdue: false };
  if (dateStr === addDays(todayStr, 1))
    return { text: "tomorrow", overdue: false };
  if (dateStr < addDays(todayStr, 7)) {
    return {
      text: formatUtcDate(dateStr, { weekday: "short" }),
      overdue: false,
    };
  }
  return {
    text: formatUtcDate(dateStr, { month: "short", day: "numeric" }),
    overdue: false,
  };
}

/** Stable color per thread (design: each thread's branch icon is tinted). */
const THREAD_COLORS = [
  "text-area-blue",
  "text-area-amber",
  "text-area-green",
  "text-area-violet",
  "text-area-coral",
] as const;
export function threadColorClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return THREAD_COLORS[h % THREAD_COLORS.length];
}

// ---------------------------------------------------------------------------
// timeline grouping — consecutive quiet mentions collapse into one row
// ---------------------------------------------------------------------------

export type TimelineItem =
  | { kind: "mention"; mention: ThreadMentionItem; newest: boolean }
  | { kind: "group"; key: string; mentions: ThreadMentionItem[] };

/** Mentions arrive oldest-first; the last one is always shown (never
 * collapsed) so the timeline always ends on an explicit "newest" row. */
export function buildTimeline(mentions: ThreadMentionItem[]): TimelineItem[] {
  if (mentions.length === 0) return [];
  const items: TimelineItem[] = [];
  const body = mentions.slice(0, -1);
  const newest = mentions[mentions.length - 1];
  let buffer: ThreadMentionItem[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      items.push({ kind: "mention", mention: buffer[0], newest: false });
    } else {
      items.push({ kind: "group", key: buffer[0].id, mentions: buffer });
    }
    buffer = [];
  };
  for (const m of body) {
    if (m.quiet) {
      buffer.push(m);
    } else {
      flush();
      items.push({ kind: "mention", mention: m, newest: false });
    }
  }
  flush();
  items.push({ kind: "mention", mention: newest, newest: true });
  return items;
}

export type FlatRow =
  | { type: "mention"; mention: ThreadMentionItem; newest: boolean }
  | { type: "group"; key: string; mentions: ThreadMentionItem[] };

export function flattenTimeline(
  items: TimelineItem[],
  expanded: Set<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const item of items) {
    if (item.kind === "mention") {
      rows.push({
        type: "mention",
        mention: item.mention,
        newest: item.newest,
      });
    } else if (expanded.has(item.key)) {
      for (const m of item.mentions) {
        rows.push({ type: "mention", mention: m, newest: false });
      }
    } else {
      rows.push({ type: "group", key: item.key, mentions: item.mentions });
    }
  }
  return rows;
}

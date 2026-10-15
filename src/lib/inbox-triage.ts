/**
 * Pure rules for the Inbox triage page (Notes Sidebars design §5f): which
 * source view an item belongs to, the snooze presets, "from X · time" labels
 * and the name match behind the "a person you know" chip. Kept free of React
 * and the DB so they are unit-tested.
 */

export type InboxSource = "email" | "link" | "photo" | "text" | "voice";

/** Sidebar views: the queue's source filters, then the DONE section. */
export type InboxView =
  | "all"
  | "email"
  | "voice"
  | "clips"
  | "shared"
  | "filed"
  | "snoozed";

/** Whether a triage item shows under a source view (the DONE views are not sources). */
export function inSourceView(source: InboxSource, view: InboxView): boolean {
  switch (view) {
    case "all":
      return true;
    case "email":
      return source === "email";
    case "voice":
      return source === "voice";
    case "clips":
      return source === "link";
    case "shared":
      return source === "photo" || source === "text";
    default:
      return false;
  }
}

/** "jazzadvice.com" from a URL; null when it isn't one. */
export function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function clock(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * When an item arrived: the time today, "Yesterday · 8:12 AM", else
 * "Oct 8 · 8:12 AM". `now` is passed in (the page keeps it in state).
 */
export function receivedLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return clock(d);
  if (days === 1) return `Yesterday · ${clock(d)}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${clock(d)}`;
}

export interface SnoozePreset {
  id: "later" | "tomorrow" | "week";
  label: string;
  /** Local time hint shown beside the label. */
  hint: string;
  until: Date;
}

/** "Later today" (+3h), "Tomorrow" (8:00 local), "Next week" (Monday 8:00). */
export function snoozePresets(now: Date): SnoozePreset[] {
  const later = new Date(now.getTime() + 3 * 3_600_000);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const week = new Date(now);
  week.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  week.setHours(8, 0, 0, 0);
  return [
    { id: "later", label: "Later today", hint: clock(later), until: later },
    { id: "tomorrow", label: "Tomorrow", hint: "8:00 AM", until: tomorrow },
    { id: "week", label: "Next week", hint: "Mon 8:00 AM", until: week },
  ];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The first person whose name appears in the text as a whole word
 * (case-insensitive, Unicode-aware) — the same rule the People page uses for
 * mentions, so "Sam" never matches "same".
 */
export function matchPerson<T extends { name: string }>(
  text: string,
  people: readonly T[],
): T | null {
  for (const p of people) {
    const name = p.name.trim();
    if (!name) continue;
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=[^\\p{L}\\p{N}]|$)`,
      "iu",
    );
    if (re.test(text)) return p;
  }
  return null;
}

/** "File to Reading list" → "Reading list" (the legacy suggestion wording). */
export function folderLabel(
  bubbleTitle: string | null,
  suggestionLabel: string | null,
): string | null {
  if (bubbleTitle) return bubbleTitle;
  if (!suggestionLabel) return null;
  return (
    suggestionLabel.replace(/^file (as a note )?to\s+/i, "").trim() || null
  );
}

/**
 * Relative-time ("how long ago") formatting shared by three surfaces that
 * each want different wording/granularity for the same underlying
 * calculation:
 *
 *  - "long"   — Trash's "deleted 3 days ago": seconds → minutes → hours →
 *               days → months → years, full words, singular/plural.
 *  - "short"  — Inbox's "22 min ago": minutes → hours → days, abbreviated
 *               units, no month/year tier (always falls back to days once
 *               past 24h). Callers pass `nowMs` explicitly (rather than
 *               relying on the default `Date.now()`) so a client component
 *               can compute "now" once into state for hydration safety.
 *  - "coarse" — Gardener's lost & found "3 weeks ago": days → weeks →
 *               months only, no singular handling.
 *
 * Each style's thresholds and wording are preserved exactly from the three
 * pre-consolidation copies — see relative-time.test.ts for coverage of each.
 */

export type RelativeTimeStyle = "long" | "short" | "coarse";

export function relativeTime(
  date: Date | string,
  style: RelativeTimeStyle,
  nowMs: number = Date.now(),
): string {
  const then = typeof date === "string" ? new Date(date).getTime() : date.getTime();

  if (style === "long") {
    const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    const months = Math.floor(days / 30);
    if (days < 365) return `${months} month${months === 1 ? "" : "s"} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }

  if (style === "short") {
    const ms = Math.max(0, nowMs - then);
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  // "coarse"
  const days = Math.floor((nowMs - then) / 86_400_000);
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

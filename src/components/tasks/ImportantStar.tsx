"use client";

import { Star } from "lucide-react";

/**
 * Importance, and the overdue colour it drives.
 *
 * Red used to mean "overdue", which stopped meaning anything once the overdue
 * pile stopped being empty — a page of red is a page of noise. Red now means
 * "overdue AND you said this one matters"; everything else that slipped reads
 * calm blue, and the two sit in separate groups.
 *
 * The button is presentational on purpose: each page writes the flag through
 * its own state and calls `setTaskImportantAction` itself, because what has to
 * be rolled back on failure differs (the Tasks page holds a task in up to four
 * lists; the home widget also has to patch the snapshot a completed row
 * restores from).
 */

/**
 * The tone class for a task's due chip, or null when the task isn't overdue —
 * importance on its own never recolours a row, it only lights the star.
 */
export function overdueTone(overdue: boolean, important: boolean): string | null {
  if (!overdue) return null;
  return important ? "text-overdue" : "text-overdue-calm";
}

export function ImportantStar({
  important,
  overdue = false,
  onToggle,
}: {
  important: boolean;
  /** Past due — decides whether the lit star is red or plain ink. */
  overdue?: boolean;
  onToggle: (next: boolean) => void;
}) {
  const label = important ? "Unmark important" : "Mark important";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={important}
      title={label}
      onClick={() => onToggle(!important)}
      className={`flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md hover:bg-white/8 ${
        important
          ? overdue
            ? "text-overdue"
            : "text-ink-300"
          : "text-ink-600 hover:text-ink-300"
      }`}
    >
      <Star className={`h-3 w-3 ${important ? "fill-current" : ""}`} />
    </button>
  );
}

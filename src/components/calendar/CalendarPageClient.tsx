"use client";

import { useEffect, useState } from "react";

import { CalendarDesktop } from "./CalendarDesktop";
import { PhoneCalendar } from "./PhoneCalendar";

/**
 * Calendar page — THE merged time view (product coherence decisions in
 * CONTEXT.md). md+ renders CalendarDesktop (Notes Sidebars design §5c/§6c:
 * mini month + layers sidebar, Day/Week/Month time grid, event details on
 * the right). Below md it renders PhoneCalendar (design 6j: a day agenda
 * under a swipeable week strip, the month name opening a mini month sheet,
 * unscheduled tasks waiting at the bottom; the old full month grid is one
 * tap away from that sheet).
 *
 * Quick-add events (calendar redesign): one free-text input, parsed locally
 * by lib/quick-event ("coffee w/ Sam fri 3pm") with a live preview — no
 * picker. ICS layer (merged-calendar phase): the subscribed feed's events
 * overlay everything read-only on both trees.
 */
export function CalendarPageClient({ cacheScope }: { cacheScope: string }) {
  // The CSS switches at md (768px); data loading follows the same breakpoint
  // so each tree only fetches while it is the visible one, never both.
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <>
      <CalendarDesktop cacheScope={cacheScope} active={desktop === true} />
      <PhoneCalendar cacheScope={cacheScope} active={desktop === false} />
    </>
  );
}

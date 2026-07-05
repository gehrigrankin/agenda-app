import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { CalendarDays } from "lucide-react";

import { DailyJot } from "@/components/notes/DailyJot";
import { listRecentDailyNotes, type DailyNoteSummary } from "@/server/notes";

/** "Fri, Jul 4" from the stored midnight-UTC dailyDate (explicit locale + UTC). */
function formatDailyDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Today page: the daily jot. Recent dailies are fetched server-side; the note
 * for "today" itself is resolved client-side (only the browser knows the
 * user's local date), then edited inline with the standard NoteEditor.
 */
export default async function AppHomePage() {
  const { userId } = await auth();
  let recentDailies: DailyNoteSummary[] = [];
  let dbUnavailable = false;
  if (userId) {
    try {
      recentDailies = await listRecentDailyNotes(userId);
    } catch (err) {
      console.error("[app] failed to load recent dailies:", err);
      dbUnavailable = true;
    }
  }

  if (dbUnavailable) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-8 text-center">
        <CalendarDays className="h-10 w-10 text-neutral-300" />
        <h1 className="text-lg font-medium">Today</h1>
        <p className="max-w-sm text-balance text-sm text-neutral-500">
          We couldn&rsquo;t reach the database. Check back in a moment.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800 md:px-4">
        <h1 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="h-4 w-4 text-neutral-400" />
          Today
        </h1>
        {recentDailies.length > 0 && (
          <nav
            aria-label="Recent dailies"
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
          >
            {recentDailies.map((d) => (
              <Link
                key={d.id}
                href={`/app/notes/${d.id}`}
                className="shrink-0 rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:border-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                {d.dailyDate ? formatDailyDate(d.dailyDate) : d.title}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <DailyJot />
    </div>
  );
}
